# Where Wikipedia fights

The 500 most fought-over pages on English Wikipedia in every year from 2005 to 2026, ranked by an edit-war score. The site lets you look up any page that made a year's top 500, or browse a year.

## The score

For each page and year, the score counts pairs of editors who reverted each other. Each pair is weighted by the smaller of the two editors' edit counts on the page. The heaviest pair is dropped, and the total is multiplied by the number of editors involved in mutual reverts. Bots are excluded.

This is the M measure from Sumi, Yasseri, Rung, Kornai and Kertész, "Edit wars in Wikipedia" (2011), also used in Yasseri et al., "The most controversial topics in Wikipedia" (2014).

It measures back-and-forth reverting. It does not measure bias, who was right, or readership.

## Data

- `data/top500.json`: for each year, the top 500 pages with rank, score and the number of editors in mutual reverts, plus each page's current title and Wikidata type.
- Source: the Wikimedia `mediawiki_history` dump (snapshot 2026-09) and Wikidata. 2026 covers only part of the year.
- Pages are identified by page ID, so renamed pages keep one history.

`scripts/export_site_data.py` builds `data/top500.json` from the full rankings.
