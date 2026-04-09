"""In-memory repository used for local API scaffolding."""

from __future__ import annotations

from dataclasses import dataclass, field
from threading import Lock

from app.schemas.scan import FeedbackRequest, PipelineExchangeResponse, ScanResultResponse


@dataclass
class InMemoryStore:
    """Hold scan results, feedback, and pipeline traces in process memory."""

    scans: dict[str, ScanResultResponse] = field(default_factory=dict)
    feedback: dict[str, list[FeedbackRequest]] = field(default_factory=dict)
    pipeline_exchanges: dict[str, PipelineExchangeResponse] = field(default_factory=dict)
    lock: Lock = field(default_factory=Lock)

    def save_scan(self, scan: ScanResultResponse) -> None:
        """Persist the current state of a scan."""
        with self.lock:
            self.scans[scan.scan_id] = scan

    def get_scan(self, scan_id: str) -> ScanResultResponse | None:
        """Return a scan if it exists in memory."""
        with self.lock:
            return self.scans.get(scan_id)

    def save_feedback(self, scan_id: str, payload: FeedbackRequest) -> None:
        """Append feedback so it can be reviewed later."""
        with self.lock:
            self.feedback.setdefault(scan_id, []).append(payload)

    def save_pipeline_exchange(self, exchange: PipelineExchangeResponse) -> None:
        """Persist the request and response exchanged with the dummy pipeline."""
        with self.lock:
            self.pipeline_exchanges[exchange.scan_id] = exchange

    def get_pipeline_exchange(self, scan_id: str) -> PipelineExchangeResponse | None:
        """Return the stored pipeline trace for a scan."""
        with self.lock:
            return self.pipeline_exchanges.get(scan_id)


# A module-level singleton is enough for this local scaffold.
store = InMemoryStore()
