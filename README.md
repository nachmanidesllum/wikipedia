# Where Wikipedia fights

Every English Wikipedia page that saw an edit war between 2005 and 2026, ranked year by year by an edit-war score. The site lets you look up any of these pages, or browse a year.

## The score

For each page and year, the score counts pairs of editors who reverted each other. Each pair is weighted by the smaller of the two editors' edit counts on the page. The heaviest pair is dropped, and the total is multiplied by the number of editors involved in mutual reverts. Bots are excluded.

This is the M measure from Sumi, Yasseri, Rung, Kornai and Kertész, "Edit wars in Wikipedia" (2011), also used in Yasseri et al., "The most controversial topics in Wikipedia" (2014).

It measures back-and-forth reverting. It does not measure bias, who was right, or readership.

## Data

Every page-year with a score above zero is included: 387,110 page-years across 207,102 pages. Page-years scoring zero (over 99% of all page-years) are left out.

- `data/meta.json`: years, pages edited per year, Wikidata type labels, and the #1 page and #1 person for each year.
- `data/years/<year>.json`: every page with a score that year, as `[rank, page_id, score, editors, title, type]`.
- `data/hist/<k>.json`: each page's history, split into 64 files by `page_id % 64`.
- `data/pages.json`: the search index.
- `data/talk-summaries.json`: short AI-assisted summaries and Talk revision links, keyed by page ID and year. These cover sampled discussions around the ten largest daily score increases, using merged seven-day windows.

Ranks are among all pages that year. Ties share the best rank.

Source: the Wikimedia `mediawiki_history` dump (snapshot 2026-09) and Wikidata. 2026 covers only part of the year. Pages are identified by page ID, so renamed pages keep one history. Titles and Wikidata types are current, not historical.

`scripts/export_site_data.py` builds `data/` from the full annual scores.
