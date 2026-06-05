from pgvector.sqlalchemy import VECTOR

from app.db.models import Base


def test_metadata_contains_documented_tables() -> None:
    expected_tables = {
        "cases",
        "case_chunks",
        "case_entities",
        "scans",
        "scan_blocks",
        "scan_evidence_items",
        "scan_similar_cases",
        "pipeline_exchanges",
        "seller_observations",
    }

    assert expected_tables.issubset(Base.metadata.tables.keys())


def test_case_chunks_uses_pgvector_embedding() -> None:
    case_chunks = Base.metadata.tables["case_chunks"]

    assert isinstance(case_chunks.c.embedding.type, VECTOR)


def test_cases_include_umap_risk_metadata() -> None:
    cases = Base.metadata.tables["cases"]

    assert {"risk_level", "risk_score", "risk_flags_json"}.issubset(cases.c.keys())


def test_child_tables_reference_expected_parents() -> None:
    table_foreign_keys = {
        "case_chunks": {"cases"},
        "case_entities": {"cases"},
        "scan_blocks": {"scans"},
        "scan_evidence_items": {"scans"},
        "scan_similar_cases": {"scans", "cases", "case_chunks"},
        "pipeline_exchanges": {"scans"},
    }

    for table_name, expected_targets in table_foreign_keys.items():
        table = Base.metadata.tables[table_name]
        target_tables = {fk.column.table.name for fk in table.foreign_keys}
        assert expected_targets.issubset(target_tables)
