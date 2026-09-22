"""Build a small, auditable public-data snapshot for RecallRadar Canada.

Only the Government of Canada feed is used. The date means "last updated" in
the source; it is never treated as a first-publication date or incident date.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
import html
import json
import math
from pathlib import Path
import re
from urllib.parse import urlparse
from urllib.request import urlopen


SOURCE = "https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json"
SOURCE_PAGE = "https://open.canada.ca/data/en/dataset/d38de914-c94c-429b-8ab1-8776c31643e3"
STOPWORDS = frozenset("a an and are as at be by canada due for from in is it of on or recall recalled recalls safety the to with product products issue alert notice transport".split())
TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9'-]{2,}")


def clean(value: object) -> str:
    value = html.unescape(str(value or ""))
    value = re.sub(r"<[^>]*>", " ", value)
    value = value.replace("\u200b", "").replace("\ufeff", "")
    return " ".join(value.split())


def sector(organization: str) -> str:
    return {
        "TC": "Vehicles",
        "CFIA": "Food",
        "Medical devices": "Medical devices",
        "Consumer product safety": "Consumer products",
        "Drugs and health products": "Health products",
        "Marketed health products": "Health products",
        "Controlled substances and cannabis": "Cannabis",
    }.get(organization, "Other")


def normalize(row: dict) -> dict | None:
    nid = clean(row.get("NID"))
    url = clean(row.get("URL"))
    host = urlparse(url).hostname
    if not nid.isdigit() or host != "recalls-rappels.canada.ca":
        return None
    updated = clean(row.get("Last updated"))
    try:
        date.fromisoformat(updated)
    except ValueError:
        updated = ""
    organization = clean(row.get("Organization"))
    return {
        "id": nid,
        "title": clean(row.get("Title")),
        "url": url,
        "organization": organization,
        "sector": sector(organization),
        "product": clean(row.get("Product")),
        "issue": clean(row.get("Issue")),
        "category": clean(row.get("Category")),
        "recall_class": clean(row.get("Recall class")),
        "updated": updated,
        "archived": clean(row.get("Archived")) == "1",
    }


def tokens(row: dict) -> Counter:
    counts = Counter()
    for field, multiplier in (("title", 1), ("product", 2), ("issue", 3), ("category", 1)):
        counts.update({term: multiplier for term in set(TOKEN_RE.findall(row[field].lower())) if term not in STOPWORDS})
    return counts


def add_similar(rows: list[dict], limit: int = 3) -> None:
    """Calculate transparent TF-IDF cosine neighbours within each sector."""
    documents = [tokens(row) for row in rows]
    n = len(rows)
    document_frequency = Counter(term for doc in documents for term in doc)
    vectors = []
    postings = defaultdict(list)
    for index, doc in enumerate(documents):
        weights = {term: count * (math.log((n + 1) / (document_frequency[term] + 1)) + 1)
                   for term, count in doc.items()}
        magnitude = math.sqrt(sum(value * value for value in weights.values())) or 1.0
        normalized = {term: value / magnitude for term, value in weights.items()}
        vectors.append(normalized)
        for term, weight in normalized.items():
            postings[term].append((index, weight))
    for index, row in enumerate(rows):
        scores = defaultdict(float)
        for term, weight in vectors[index].items():
            for other, other_weight in postings[term]:
                if other != index and rows[other]["sector"] == row["sector"]:
                    scores[other] += weight * other_weight
        ranked = sorted(scores, key=lambda other: (-scores[other], -int(rows[other]["updated"].replace("-", "") or 0)))
        row["similar_ids"] = [rows[other]["id"] for other in ranked if scores[other] >= 0.30][:limit]


def build(raw: list[dict], as_of: date, months: int = 36) -> dict:
    normalized = [item for row in raw if (item := normalize(row))]
    duplicate_ids = len(normalized) - len({row["id"] for row in normalized})
    unique = {row["id"]: row for row in normalized}
    cutoff = as_of - timedelta(days=months * 31)
    rows = [row for row in unique.values() if row["updated"] and cutoff <= date.fromisoformat(row["updated"]) <= as_of]
    rows.sort(key=lambda row: (row["updated"], int(row["id"])), reverse=True)
    add_similar(rows)
    return {
        "metadata": {
            "as_of": as_of.isoformat(),
            "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source_url": SOURCE,
            "source_page": SOURCE_PAGE,
            "date_field": "Last updated",
            "cutoff": cutoff.isoformat(),
            "source_records": len(raw),
            "records_without_valid_date": sum(not row["updated"] for row in normalized),
            "duplicate_ids": duplicate_ids,
            "included_records": len(rows),
            "scope": "Dated source notices in an approximate 36-month lookback, through the snapshot date.",
            "method": "Related notices use TF-IDF cosine similarity within a sector; matches are leads for review, not a safety assessment.",
        },
        "records": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, help="Use a previously downloaded source file")
    parser.add_argument("--output", type=Path, default=Path("docs/data.json"))
    parser.add_argument("--as-of", type=date.fromisoformat, default=datetime.now(timezone.utc).date())
    args = parser.parse_args()
    if args.input:
        raw = json.loads(args.input.read_text(encoding="utf-8"))
    else:
        with urlopen(SOURCE, timeout=60) as response:
            raw = json.load(response)
    if not isinstance(raw, list):
        raise ValueError("Expected a list of source notices")
    snapshot = build(raw, args.as_of)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(snapshot["metadata"], indent=2))


if __name__ == "__main__":
    main()
