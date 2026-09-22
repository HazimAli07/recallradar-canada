import json
from datetime import date
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
from build_data import build, normalize  # noqa: E402


def raw(nid, updated="2026-09-20", organization="CFIA", title="Sample food recall"):
    return {
        "NID": str(nid), "Title": title,
        "URL": f"https://recalls-rappels.canada.ca/en/alert-recall/{nid}",
        "Organization": organization, "Product": "Sample product", "Issue": "Allergen",
        "Category": "Food", "Recall class": "Class 1", "Last updated": updated,
        "Archived": "0",
    }


class PipelineTests(unittest.TestCase):
    def test_rejects_nonofficial_source_url(self):
        row = raw(1)
        row["URL"] = "https://example.com/fake-recall"
        self.assertIsNone(normalize(row))

    def test_date_scope_and_quality_counts(self):
        source = [raw(1), raw(2, updated=""), raw(3, updated="2020-01-01"), raw(1)]
        snapshot = build(source, date(2026, 9, 22))
        self.assertEqual(snapshot["metadata"]["source_records"], 4)
        self.assertEqual(snapshot["metadata"]["duplicate_ids"], 1)
        self.assertEqual(snapshot["metadata"]["records_without_valid_date"], 1)
        self.assertEqual([row["id"] for row in snapshot["records"]], ["1"])

    def test_snapshot_has_unique_official_records_and_valid_dates(self):
        path = Path(__file__).resolve().parents[1] / "docs" / "data.json"
        if not path.exists():
            self.skipTest("Built snapshot not present")
        payload = json.loads(path.read_text(encoding="utf-8"))
        rows = payload["records"]
        self.assertEqual(len(rows), payload["metadata"]["included_records"])
        self.assertEqual(len(rows), len({row["id"] for row in rows}))
        self.assertTrue(all(row["url"].startswith("https://recalls-rappels.canada.ca/") for row in rows))
        self.assertTrue(all(payload["metadata"]["cutoff"] <= row["updated"] <= payload["metadata"]["as_of"] for row in rows))
        self.assertTrue(all(set(row["similar_ids"]).isdisjoint({row["id"]}) for row in rows))


if __name__ == "__main__":
    unittest.main()
