"""Service layer that coordinates API requests and real pipeline processing."""

from __future__ import annotations

from uuid import uuid4

from app.core.config import get_settings
from app.repositories.db_store import db_store
from app.schemas.external_lookup import ExternalLookupProvider, ExternalLookupResponse
from app.schemas.scan import (
    ContentBlock,
    EvidenceItem,
    PipelineErrorInfo,
    PipelineExchangeResponse,
    ScanCreateRequest,
    ScanCreateResponse,
    ScanListResponse,
    ScanResultResponse,
    UserProfile,
    UserRiskContext,
)
from app.services.external_lookup import (
    POLICE_PAGE_URL,
    THECHEAT_SEARCH_URL,
    ExternalLookupError,
    external_lookup_service,
)
from app.services.case_retrieval import search_similar_cases_for_text
from app.services.llm_scan_analysis import (
    LLMScanAnalysisError,
    llm_scan_analysis_service,
    validate_llm_highlights,
)
from app.services.pipeline_client import PipelineClientError, pipeline_client
from app.services.rag.context import build_rag_context
from app.services.rag.scoring import RAGScore, score_rag_context
from app.services.rules.external_lookup_candidates import ExternalLookupCandidate, extract_external_lookup_candidates


EXTERNAL_LOOKUP_PROVIDERS: tuple[ExternalLookupProvider, ...] = ("police", "thecheat")


class ScanService:
    """Encapsulate scan lifecycle logic so routes stay thin and readable."""

    def create_scan(self, payload: ScanCreateRequest) -> ScanCreateResponse:
        """Create a queued scan record that the client can start polling."""
        scan_id = f"scan_{uuid4().hex[:8]}"
        settings = get_settings()

        db_store.create_scan(scan_id=scan_id, payload=payload)

        return ScanCreateResponse(
            scan_id=scan_id,
            status="queued",
            poll_after_ms=settings.scan_poll_interval_ms,
        )

    def enqueue_scan(self, payload: ScanCreateRequest) -> ScanCreateResponse:
        """Create the scan and record the outbound pipeline request in one safe step."""
        created_scan = self.create_scan(payload)
        self.attach_pipeline_request(created_scan.scan_id, payload)
        return created_scan

    def run_scan_sync(self, payload: ScanCreateRequest) -> ScanResultResponse:
        """Create, process, and return a scan result in one request for local frontend testing."""
        created_scan = self.enqueue_scan(payload)
        settings = get_settings()
        self.process_scan(
            created_scan.scan_id,
            run_external_lookups=settings.sync_external_lookup_enabled,
        )
        scan = self.get_scan(created_scan.scan_id)
        if scan is None:
            raise RuntimeError("scan not found after synchronous processing")
        return scan

    def process_scan(self, scan_id: str, run_external_lookups: bool = True) -> None:
        """Send the saved payload to the pipeline and translate the outcome into scan status."""
        if db_store.get_scan(scan_id) is None:
            return

        # Move the job into processing so polling clients can observe progress.
        db_store.update_scan_status(scan_id=scan_id, status="processing")

        exchange = db_store.get_pipeline_exchange(scan_id)
        if exchange is None:
            self._mark_scan_failed(
                scan_id=scan_id,
                error_info=PipelineErrorInfo(
                    error_type="pipeline_request_missing",
                    message="No outbound pipeline payload was recorded for this scan.",
                    retryable=False,
                ),
            )
            return

        try:
            inbound_payload = pipeline_client.analyze(exchange.outbound_payload)
        except PipelineClientError as exc:
            error_info = PipelineErrorInfo(
                error_type=exc.error_type,
                message=exc.message,
                retryable=exc.retryable,
                status_code=exc.status_code,
            )
            db_store.save_pipeline_exchange(
                PipelineExchangeResponse(
                    scan_id=scan_id,
                    outbound_payload=exchange.outbound_payload,
                    inbound_payload=None,
                    pipeline_error=error_info,
                )
            )
            self._mark_scan_failed(scan_id=scan_id, error_info=error_info)
            return

        settings = get_settings()
        external_lookup_results: list[ExternalLookupResponse] = []
        if settings.external_lookup_enabled and run_external_lookups:
            external_lookup_results = self._run_external_lookups(exchange.outbound_payload.content_blocks)

        rag_context = build_rag_context(
            scan_payload=exchange.outbound_payload,
            external_lookup_results=external_lookup_results,
            user_context=self._build_user_risk_context(exchange.outbound_payload.user_profile),
        )
        rag_score = score_rag_context(rag_context)
        similar_cases = [item.to_similar_case() for item in rag_context.similar_cases_top3]
        if not similar_cases:
            similar_cases = search_similar_cases_for_text(rag_context.listing_text)
        summary = self._fallback_summary(rag_score)
        llm_reasoning: str | None = None
        recommended_actions = inbound_payload.recommended_actions
        highlight_targets = self._dedupe_evidence_items(
            inbound_payload.highlight_targets + rag_context.savings_account_signals
        )
        evidence_items = self._dedupe_evidence_items(inbound_payload.evidence_items + highlight_targets)
        degraded = inbound_payload.degraded

        try:
            llm_result = llm_scan_analysis_service.generate(rag_context, rag_score)
            validated_llm_highlights = validate_llm_highlights(
                llm_result.highlight_targets,
                exchange.outbound_payload.content_blocks,
            )
            summary = llm_result.summary
            llm_reasoning = llm_result.llm_reasoning
            if validated_llm_highlights:
                highlight_targets = validated_llm_highlights
                evidence_items = validated_llm_highlights
            if llm_result.recommended_actions:
                recommended_actions = llm_result.recommended_actions
        except LLMScanAnalysisError:
            degraded = True

        # Save the final completed scan in the format consumed by the frontend.
        final_scan = ScanResultResponse(
            scan_id=scan_id,
            status="completed",
            risk_level=rag_score.risk_level,
            risk_score=rag_score.risk_score,
            risk_points=rag_score.risk_points,
            risk_score_breakdown=rag_score.breakdown,
            embedding_risk_score=rag_score.embedding_risk_score,
            risk_space_model_version=rag_score.risk_space_model_version,
            projection_type="embedding_pls1_primary_pls7_cosine_v1",
            summary=summary,
            llm_reasoning=llm_reasoning,
            risk_tags=self._build_risk_tags(inbound_payload.risk_tags, rag_context.scoring_signals, rag_score),
            evidence_items=evidence_items,
            highlight_targets=highlight_targets,
            similar_cases=similar_cases or inbound_payload.similar_cases,
            recommended_actions=recommended_actions,
            external_lookup_results=external_lookup_results,
            degraded=degraded,
            report_url=self._build_report_url(scan_id),
        )
        db_store.save_scan(final_scan)
        db_store.save_pipeline_exchange(
            PipelineExchangeResponse(
                scan_id=scan_id,
                outbound_payload=exchange.outbound_payload,
                inbound_payload=inbound_payload,
                pipeline_error=None,
            )
        )

    def get_scan(self, scan_id: str) -> ScanResultResponse | None:
        """Return the current scan state."""
        return db_store.get_scan(scan_id)

    def list_scans(self, limit: int, offset: int) -> ScanListResponse:
        """Return recent scans for backend checks and future frontend list views."""
        return db_store.list_scans(limit=limit, offset=offset)

    def get_pipeline_exchange(self, scan_id: str) -> PipelineExchangeResponse | None:
        """Return the recorded backend-to-pipeline exchange."""
        return db_store.get_pipeline_exchange(scan_id)

    def attach_pipeline_request(self, scan_id: str, payload: ScanCreateRequest) -> None:
        """Capture the outbound payload before the background task runs."""
        outbound_payload = pipeline_client.build_outbound_payload(scan_id=scan_id, payload=payload)
        db_store.save_pipeline_exchange(
            PipelineExchangeResponse(
                scan_id=scan_id,
                outbound_payload=outbound_payload,
                inbound_payload=None,
                pipeline_error=None,
            )
        )

    def _mark_scan_failed(self, scan_id: str, error_info: PipelineErrorInfo) -> None:
        """Persist a stable failed scan result without leaking transport-layer details."""
        db_store.update_scan_status(scan_id=scan_id, status="failed", summary=error_info.message)

    def _run_external_lookups(self, content_blocks: list[ContentBlock]) -> list[ExternalLookupResponse]:
        """Run police and TheCheat lookups for parsed phone/account candidates."""
        lookup_results: list[ExternalLookupResponse] = []

        for candidate in extract_external_lookup_candidates(content_blocks):
            for provider in EXTERNAL_LOOKUP_PROVIDERS:
                try:
                    lookup_results.append(external_lookup_service.lookup(candidate.to_request(provider)))
                except Exception as exc:
                    lookup_results.append(self._build_failed_external_lookup(provider, candidate, exc))

        return lookup_results

    def _build_failed_external_lookup(
        self,
        provider: ExternalLookupProvider,
        candidate: ExternalLookupCandidate,
        exc: Exception,
    ) -> ExternalLookupResponse:
        """Convert an external-provider failure into scan metadata instead of failing the scan."""
        message = str(exc) if isinstance(exc, ExternalLookupError) else f"External lookup failed: {exc}"
        source_url = POLICE_PAGE_URL if provider == "police" else THECHEAT_SEARCH_URL

        return ExternalLookupResponse(
            provider=provider,
            kind=candidate.kind,
            keyword=candidate.keyword,
            status="failed",
            message=message,
            source_url=source_url,
        )

    def _build_user_risk_context(self, user_profile: UserProfile | None) -> UserRiskContext:
        """Convert the public user profile API shape into internal scoring buckets."""
        if user_profile is None:
            return UserRiskContext()

        if user_profile.age is None:
            age_group = "unknown"
        elif user_profile.age >= 70:
            age_group = "70_plus"
        elif user_profile.age >= 50:
            age_group = "50_69"
        elif user_profile.age >= 30:
            age_group = "30_49"
        else:
            age_group = "under_30"

        experience_map = {
            "beginner": "low",
            "intermediate": "medium",
            "advanced": "high",
            None: "unknown",
        }

        return UserRiskContext(
            age_group=age_group,
            trade_experience=experience_map.get(user_profile.trade_experience_level, "unknown"),
        )

    def _fallback_summary(self, score: RAGScore) -> str:
        """Build a minimal deterministic summary when LLM generation is unavailable."""
        if score.risk_score >= 1.0 and any(item.component == "external_lookup_positive" for item in score.breakdown):
            return "외부 신고 이력이 확인되어 즉시 거래를 중단하고 상세 내용을 확인해야 합니다."
        if score.risk_level == "high":
            return "유사 사례, 계좌 패턴, 사용자 거래 맥락을 종합하면 추가 확인이 필요한 거래입니다."
        if score.risk_level == "medium":
            return "일부 위험 신호가 감지되어 송금 전 추가 확인이 필요합니다."
        return "현재 탐지된 위험 신호는 낮지만, 안전결제와 판매자 확인은 계속 권장됩니다."

    def _build_risk_tags(
        self,
        pipeline_tags: list[str],
        scoring_signals: dict[str, object],
        score: RAGScore,
    ) -> list[str]:
        """Expose stable tags from pipeline and deterministic RAG scoring."""
        tags = list(dict.fromkeys(pipeline_tags))
        if bool(scoring_signals.get("external_lookup_positive")):
            tags.append("external_lookup_positive")
        if bool(scoring_signals.get("has_savings_account_pattern")):
            tags.append("savings_account_pattern")
        if score.embedding_risk_score is not None:
            tags.append("risk_space_similarity")
        return list(dict.fromkeys(tags))

    def _dedupe_evidence_items(self, items: list[EvidenceItem]) -> list[EvidenceItem]:
        """Remove repeated highlights while preserving order."""
        deduped: list[EvidenceItem] = []
        seen: set[tuple[str, int, int, str]] = set()
        for item in items:
            key = (item.block_id, item.start, item.end, item.reason_code)
            if key in seen:
                continue
            seen.add(key)
            deduped.append(item)
        return deduped

    def _build_report_url(self, scan_id: str) -> str:
        """Build the frontend report URL stored with completed scan results."""
        base_url = get_settings().frontend_report_base_url.rstrip("/")
        return f"{base_url}/{scan_id}"


# A module-level service instance keeps route imports small.
scan_service = ScanService()
