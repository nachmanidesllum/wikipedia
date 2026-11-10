"""Export the annual top-500 edit-war rankings to one small JSON file for the site.

Usage:
    python scripts/export_site_data.py <input_dir> data/top500.json

<input_dir> must hold:
    top500_contested_pages_by_year.parquet  (year, rank, page_id, article_title, M, ...)
    all_pages_categories_types.parquet      (page_id, wikidata_id, instance_of, ...)
"""
import json
import sys
from collections import Counter
from pathlib import Path

import pyarrow.compute as pc
import pyarrow.parquet as pq

HUMAN = "Q5"
N_TYPE_GROUPS = 14  # most common Wikidata types get their own filter option


def main(input_dir, out_path):
    input_dir = Path(input_dir)
    top = pq.read_table(input_dir / "top500_contested_pages_by_year.parquet").to_pandas()
    ids = sorted(top.page_id.unique().tolist())

    meta = pq.read_table(
        input_dir / "all_pages_categories_types.parquet",
        columns=["page_id", "wikidata_id", "instance_of"],
        filters=[("page_id", "in", ids)],
    ).to_pylist()
    meta = {m["page_id"]: m for m in meta}

    def first_type(pid):
        inst = (meta.get(pid) or {}).get("instance_of") or []
        if any(t["id"] == HUMAN for t in inst):
            return "human"
        return inst[0]["label"] if inst and inst[0]["label"] else ""

    titles = top.sort_values("year").groupby("page_id").article_title.last().to_dict()
    raw_type = {pid: first_type(pid) for pid in ids}
    common = [t for t, _ in Counter(v for v in raw_type.values() if v).most_common(N_TYPE_GROUPS)]

    pages = {}
    for pid in ids:
        qid = (meta.get(pid) or {}).get("wikidata_id") or ""
        pages[str(pid)] = [titles[pid], qid, raw_type[pid]]

    partial = (top[top.is_partial_year][["year", "months_covered"]]
               .drop_duplicates().set_index("year").months_covered.to_dict())
    rows = (top.sort_values(["year", "rank"])
            [["year", "rank", "page_id", "M", "mutual_editors"]].values.tolist())

    out = {
        "snapshot": str(top.snapshot.iloc[0]),
        "years": sorted(top.year.unique().tolist()),
        "partial_years": {str(int(y)): int(m) for y, m in partial.items()},
        "type_groups": common,
        "fields": ["year", "rank", "page_id", "M", "editors"],
        "rows": [[int(v) for v in r] for r in rows],
        "pages": pages,
    }
    Path(out_path).write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False),
                              encoding="utf-8")
    print(f"{len(rows)} rows, {len(pages)} pages, types: {common}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
