"""Export yearly edit-war scores for every page with a nonzero score, split for a static site.

Usage:
    python scripts/export_site_data.py <input_dir> <out_dir>

<input_dir> must hold:
    all_pages_annual_m.parquet          (year, page_id, article_title, M, mutual_editors, ...)
    all_pages_annual_m.json             (per-year totals, incl. eligible_pages_with_edits)
    all_pages_categories_types.parquet  (page_id, instance_of, ...)

Writes to <out_dir>:
    meta.json          years, totals, Wikidata type labels, #1 page and #1 person per year
    pages.json         search index: [page_id, title, type, years with a score, best rank]
    years/<year>.json  every page with a score that year: [rank, page_id, M, editors, title, type]
    hist/<k>.json      per-page history for page_id % N_SHARDS == k:
                       {page_id: [title, type, [[year, rank, M, editors], ...]]}

Page-years with a score of zero are left out; a page absent from a year had no edit war that year.
Rank is the competition rank among all pages that year (ties share the best rank).
"""
import json
import sys
from collections import Counter
from pathlib import Path

import polars as pl

HUMAN = "Q5"
N_SHARDS = 64
N_TYPE_GROUPS = 16


def dump(obj, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")


def main(input_dir, out_dir):
    src, out = Path(input_dir), Path(out_dir)

    scores = (
        pl.scan_parquet(src / "all_pages_annual_m.parquet")
        .filter(pl.col("M") > 0)
        .select("year", "page_id", "article_title", "M", "mutual_editors",
                "is_partial_year", "months_covered", "snapshot")
        .collect()
        .with_columns(pl.col("M").rank("min", descending=True).over("year").cast(pl.Int64).alias("rank"))
        .sort("year", "rank", "page_id")
    )
    ids = scores["page_id"].unique()

    types = (
        pl.scan_parquet(src / "all_pages_categories_types.parquet")
        .select("page_id", "instance_of")
        .filter(pl.col("page_id").is_in(ids.implode()))
        .collect()
    )

    def label(inst):
        inst = inst or []
        if any(t["id"] == HUMAN for t in inst):
            return "human"
        return next((t["label"] for t in inst if t["label"]), "")

    type_of = {pid: label(inst) for pid, inst in types.iter_rows()}
    title_of = dict(scores.sort("year").group_by("page_id").agg(pl.col("article_title").last()).iter_rows())

    labels = [""] + [t for t, _ in Counter(v for v in type_of.values() if v).most_common()]
    tix = {t: i for i, t in enumerate(labels)}
    t_index = lambda pid: tix[type_of.get(pid, "")]

    totals = {y["year"]: y for y in json.loads((src / "all_pages_annual_m.json").read_text(encoding="utf-8"))["years"]}
    years = sorted(scores["year"].unique().to_list())
    partial = {str(y): int(m) for y, m in
               scores.filter(pl.col("is_partial_year")).select("year", "months_covered").unique().iter_rows()}

    winners = {}
    for y in years:
        rows = scores.filter(pl.col("year") == y)
        top = rows.row(0, named=True)
        person = next((r for r in rows.iter_rows(named=True) if type_of.get(r["page_id"]) == "human"), None)
        pick = lambda r: r and [r["page_id"], title_of[r["page_id"]], r["rank"]]
        winners[str(y)] = {"page": pick(top), "person": pick(person)}
        dump([[r, p, m, e, title_of[p], t_index(p)]
              for r, p, m, e in rows.select("rank", "page_id", "M", "mutual_editors").iter_rows()],
             out / "years" / f"{y}.json")

    per_page = (scores.group_by("page_id")
                .agg(pl.len().alias("n"), pl.col("rank").min().alias("best"))
                .sort("best", "page_id"))
    dump([[p, title_of[p], t_index(p), n, b] for p, n, b in per_page.iter_rows()], out / "pages.json")

    shards = [dict() for _ in range(N_SHARDS)]
    for p, y, r, m, e in scores.select("page_id", "year", "rank", "M", "mutual_editors").iter_rows():
        entry = shards[p % N_SHARDS].setdefault(str(p), [title_of[p], t_index(p), []])
        entry[2].append([y, r, m, e])
    for k, shard in enumerate(shards):
        dump(shard, out / "hist" / f"{k}.json")

    group_counts = Counter(type_of.get(p, "") for p in ids.to_list())
    dump({
        "snapshot": scores["snapshot"][0],
        "years": years,
        "partial_years": partial,
        "pages_edited": {str(y): totals[y]["eligible_pages_with_edits"] for y in years},
        "pages_scored": {str(y): scores.filter(pl.col("year") == y).height for y in years},
        "n_pages": len(ids),
        "n_shards": N_SHARDS,
        "types": labels,
        "type_groups": [t for t, _ in group_counts.most_common() if t][:N_TYPE_GROUPS],
        "winners": winners,
    }, out / "meta.json")
    print(f"{scores.height} page-years, {len(ids)} pages, {len(labels)} type labels")


if __name__ == "__main__":
    main(*sys.argv[1:3])
