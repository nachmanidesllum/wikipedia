"use strict";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en");
const PAGE_SIZE = 10;

let META, partial;
let browseLimit = PAGE_SIZE;
const yearCache = new Map();
const shardCache = new Map();
let pagesIndex = null;

const getJSON = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
};
const once = (cache, key, url) => {
  if (!cache.has(key)) cache.set(key, getJSON(url).catch((e) => { cache.delete(key); throw e; }));
  return cache.get(key);
};
const loadYear = (y) => once(yearCache, y, `data/years/${y}.json`);
const loadShard = (k) => once(shardCache, k, `data/hist/${k}.json`);
function loadPagesIndex() {
  if (!pagesIndex) pagesIndex = getJSON("data/pages.json").then((rows) =>
    rows.map(([pid, title, t, n, best]) => ({ pid: String(pid), title, key: title.toLowerCase(), t, n, best })));
  return pagesIndex;
}

const typeName = (i) => META.types[i] || "";
function kindLabel(t) {
  if (t === "human") return "Person";
  if (t === "Wikimedia list article") return "List";
  if (t === "Wikimedia disambiguation page") return "Disambiguation page";
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}
const wikiUrl = (pid) => `https://en.wikipedia.org/?curid=${pid}`;
const yearLabel = (y) => (partial[y] ? `${y}*` : String(y));
function topShare(rank, year) {
  const pct = (100 * rank) / META.pages_edited[year];
  if (pct < 0.001) return "0.001%";
  return `${pct < 1 ? Number(pct.toPrecision(1)) : Math.ceil(pct)}%`;
}

async function init() {
  META = await getJSON("data/meta.json");
  partial = META.partial_years || {};

  const total = Object.values(META.pages_scored).reduce((a, b) => a + b, 0);
  $("#lede-n").textContent = whole.format(META.n_pages);
  $("#lookup-sub").textContent = `${whole.format(META.n_pages)} pages had at least one edit war between ${META.years[0]} and ${META.years[META.years.length - 1]}. Pages that never did aren't listed.`;
  $("#snap").textContent = META.snapshot;
  $("#n-page-years").textContent = whole.format(total);
  const p = Object.entries(partial).map(([y, m]) => `${y} covers only its first ${m} months, so its scores run lower and aren't directly comparable with full years.`);
  $("#partial-note").textContent = p.join(" ") || "All years are complete.";

  renderStrip();
  setupBrowse();
  setupSearch();
  window.addEventListener("hashchange", route);
  route();
}

/* ---------- #1 strip ---------- */
function renderStrip() {
  const cards = META.years.map((y) => {
    const { page, person } = META.winners[y];
    const pick = ([pid, title, rank], cls) => `
      <div class="${cls}">
        <div class="lbl">${cls === "person" ? "Top person" : "Top page"}</div>
        <button data-pid="${pid}">${esc(title)}</button>
        ${cls === "person" && rank > 1 ? `<div class="rk">#${rank} overall</div>` : ""}
      </div>`;
    const same = person && person[0] === page[0];
    return `<div class="card" role="listitem">
      <div class="yr">${y}${partial[y] ? ` <small>partial</small>` : ""}</div>
      ${pick(page, "top")}
      ${same ? `<div class="rk">Also the top person</div>` : person ? pick(person, "person") : ""}
    </div>`;
  });
  const strip = $("#strip");
  strip.innerHTML = cards.join("");
  strip.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-pid]");
    if (b) openPage(b.dataset.pid);
  });
  strip.scrollLeft = strip.scrollWidth;
}

/* ---------- search ---------- */
function setupSearch() {
  const q = $("#q"), list = $("#suggest");
  let items = [], active = -1, seq = 0;

  const close = () => { list.hidden = true; q.setAttribute("aria-expanded", "false"); active = -1; };
  const highlight = () => [...list.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
  const show = (html) => { list.innerHTML = html; list.hidden = false; q.setAttribute("aria-expanded", "true"); };

  q.addEventListener("focus", () => loadPagesIndex().catch(() => {}), { once: true });
  q.addEventListener("input", async () => {
    const s = q.value.trim().toLowerCase();
    const mine = ++seq;
    if (s.length < 2) return close();
    if (!(pagesIndex && pagesIndex.done)) show(`<li class="none">Loading ${whole.format(META.n_pages)} titles…</li>`);
    const index = await loadPagesIndex();
    pagesIndex.done = true;
    if (mine !== seq) return;
    // index is sorted by best rank, so the first matches are the most fought-over
    const starts = [], has = [];
    for (const t of index) {
      if (t.key.startsWith(s)) { if (starts.length < 12) starts.push(t); }
      else if (has.length < 12 && t.key.includes(s)) has.push(t);
      if (starts.length >= 12) break;
    }
    items = [...starts, ...has].slice(0, 12);
    active = -1;
    show(items.length
      ? items.map((t, i) => `<li role="option" id="opt${i}" data-pid="${t.pid}"><span>${esc(t.title)}</span><span class="meta">best #${whole.format(t.best)} · ${t.n} yr${t.n > 1 ? "s" : ""}</span></li>`).join("")
      : `<li class="none">No edit war recorded for a page with that title</li>`);
  });
  q.addEventListener("keydown", (e) => {
    if (list.hidden || !items.length) return;
    if (e.key === "ArrowDown") { active = (active + 1) % items.length; highlight(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = (active - 1 + items.length) % items.length; highlight(); e.preventDefault(); }
    else if (e.key === "Enter") { openPage(items[Math.max(active, 0)].pid); close(); e.preventDefault(); }
    else if (e.key === "Escape") close();
  });
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-pid]");
    if (li) { e.preventDefault(); openPage(li.dataset.pid); close(); }
  });
  q.addEventListener("blur", () => setTimeout(close, 100));
}

function openPage(pid) {
  if (location.hash !== `#page=${pid}`) location.hash = `page=${pid}`;
  else renderPage(pid);
}

/* ---------- page view ---------- */
async function renderPage(pid) {
  const view = $("#page-view");
  const shard = await loadShard(Number(pid) % META.n_shards);
  const entry = shard[pid];
  if (!entry) {
    view.innerHTML = `<p class="empty">No edit war recorded for this page.</p>`;
    view.hidden = false;
    return;
  }
  const [title, t, hist] = entry;
  const rows = hist.map(([year, rank, M, editors]) => ({ year, rank, M, editors }));
  const best = rows.reduce((a, b) => (b.rank < a.rank ? b : a));
  const peak = rows.reduce((a, b) => (b.M > a.M ? b : a));
  const type = typeName(t);
  $("#q").value = title;

  view.innerHTML = `
    <div class="pv-head">
      <h3>${esc(title)}</h3>
      ${type ? `<span class="chip">${esc(kindLabel(type))}</span>` : ""}
      <a href="${wikiUrl(pid)}" target="_blank" rel="noopener">Open on Wikipedia ↗</a>
    </div>
    <div class="pv-stats">
      <div><b>#${whole.format(best.rank)}</b>best rank (${yearLabel(best.year)})</div>
      <div><b>${rows.length}</b>of ${META.years.length} years with an edit war</div>
      <div><b>${compact.format(peak.M)}</b>peak score (${yearLabel(peak.year)})</div>
    </div>
    ${chart(rows)}
    <p class="chart-note">Rank among all English Wikipedia pages that year (log scale). Hover or tap for a year's rank. Grey marks: no edit war that year.${Object.keys(partial).length ? " * Partial year." : ""}</p>
    <details>
      <summary>Year by year</summary>
      <div class="table-wrap" style="margin-top:10px">
        <table><thead><tr><th>Year</th><th class="num">Rank</th><th class="num">Top % of pages edited</th><th class="num">Score</th><th class="num hide-sm">Editors in mutual reverts</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${yearLabel(r.year)}</td><td class="num">#${whole.format(r.rank)}</td><td class="num">${topShare(r.rank, r.year)}</td><td class="num">${whole.format(r.M)}</td><td class="num hide-sm">${whole.format(r.editors)}</td></tr>`).join("")}</tbody></table>
      </div>
    </details>`;
  view.hidden = false;
  attachChartHover(view.querySelector(".chart"));
}

function chart(rows) {
  const W = 680, H = 230, L = 50, R = 14, T = 16, B = 30;
  const years = META.years, n = years.length;
  const top = Math.max(...Object.values(META.pages_scored));
  const x = (y) => L + ((y - years[0]) / (years[n - 1] - years[0])) * (W - L - R);
  const y = (rank) => T + (Math.log10(rank) / Math.log10(top)) * (H - T - B);
  const at = new Map(rows.map((r) => [r.year, r]));
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Rank by year">`;
  for (let t = 1; t <= top; t *= 10) {
    svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">#${compact.format(t)}</text>`;
    for (const m of [2, 5]) {
      if (t * m <= top) svg += `<line class="grid minor" x1="${L}" x2="${W - R}" y1="${y(t * m)}" y2="${y(t * m)}"/>`;
    }
  }
  for (const yr of years) {
    if (yr % 5 === 0 || yr === years[0] || (yr === years[n - 1] && yr % 5 >= 3)) {
      svg += `<text x="${x(yr)}" y="${H - 8}" text-anchor="middle">${yr}</text>`;
    }
  }
  let path = "", prev = null;
  for (const yr of years) {
    const r = at.get(yr);
    if (r) { path += `${prev === yr - 1 ? "L" : "M"}${x(yr).toFixed(1)},${y(r.rank).toFixed(1)}`; prev = yr; }
  }
  svg += `<path class="line" d="${path}"/>`;
  const best = rows.reduce((a, b) => (b.rank < a.rank ? b : a));
  const bx = x(best.year), anchor = bx > W - 80 ? "end" : bx < L + 40 ? "start" : "middle";
  svg += `<text class="val best" x="${bx}" y="${Math.max(y(best.rank) - 9, 11)}" text-anchor="${anchor}">#${whole.format(best.rank)}</text>`;
  svg += `<line class="guide" y1="${T}" y2="${H - B}" visibility="hidden"/>`;
  for (const yr of years) {
    const r = at.get(yr);
    if (!r) { svg += `<rect class="miss" x="${x(yr) - 3}" y="${H - B + 4}" width="6" height="3" rx="1"/>`; continue; }
    svg += `<circle class="dot${partial[yr] ? " partial" : ""}" data-year="${yr}" cx="${x(yr)}" cy="${y(r.rank)}" r="4"/>`;
  }
  svg += `<g class="tip" visibility="hidden"><rect rx="6" height="24"/><text y="16"></text></g>`;
  // one invisible hit area per year column, so hovering anywhere in the column works
  const step = (W - L - R) / (n - 1);
  for (const yr of years) {
    const r = at.get(yr);
    const label = r ? `${yearLabel(yr)} · #${whole.format(r.rank)}` : `${yr} · no edit war`;
    const cy = r ? y(r.rank) : H - B;
    svg += `<rect class="hit" data-year="${yr}" data-x="${x(yr)}" data-y="${cy}" data-label="${esc(label)}" x="${x(yr) - step / 2}" y="${T - 10}" width="${step}" height="${H - T - B + 20}"/>`;
  }
  return svg + "</svg>";
}

function attachChartHover(svg) {
  const W = svg.viewBox.baseVal.width;
  const guide = svg.querySelector(".guide"), tip = svg.querySelector(".tip");
  const box = tip.querySelector("rect"), text = tip.querySelector("text");
  const best = svg.querySelector(".best");
  const hide = () => {
    guide.setAttribute("visibility", "hidden");
    tip.setAttribute("visibility", "hidden");
    best.removeAttribute("visibility");
    svg.querySelectorAll(".dot.on").forEach((d) => d.classList.remove("on"));
  };
  const show = (hit) => {
    hide();
    const cx = +hit.dataset.x, cy = +hit.dataset.y;
    guide.setAttribute("x1", cx); guide.setAttribute("x2", cx);
    guide.removeAttribute("visibility");
    svg.querySelector(`.dot[data-year="${hit.dataset.year}"]`)?.classList.add("on");
    text.textContent = hit.dataset.label;
    const w = text.getComputedTextLength() + 16;
    const tx = Math.min(Math.max(cx - w / 2, 2), W - w - 2);
    const ty = Math.max(cy - 36, 0);
    tip.setAttribute("transform", `translate(${tx},${ty})`);
    box.setAttribute("width", w);
    text.setAttribute("x", 8);
    tip.removeAttribute("visibility");
    best.setAttribute("visibility", "hidden");
  };
  svg.addEventListener("pointerover", (e) => { const h = e.target.closest(".hit"); if (h) show(h); });
  svg.addEventListener("pointerdown", (e) => { const h = e.target.closest(".hit"); if (h) show(h); });
  svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
}

/* ---------- browse ---------- */
function setupBrowse() {
  const yearSel = $("#year"), kindSel = $("#kind"), filt = $("#filter");
  yearSel.innerHTML = [...META.years].reverse().map((y) => `<option value="${y}">${y}${partial[y] ? " (partial)" : ""}</option>`).join("");
  const full = META.years.filter((y) => !partial[y]);
  yearSel.value = String(full[full.length - 1]);
  kindSel.innerHTML = `<option value="">All</option>` +
    META.type_groups.map((t) => `<option value="${META.types.indexOf(t)}">${esc(kindLabel(t))}</option>`).join("") +
    `<option value="other">Everything else</option>`;
  const reset = () => { browseLimit = PAGE_SIZE; renderBrowse(); };
  yearSel.addEventListener("change", () => { history.replaceState(null, "", `#year=${yearSel.value}`); reset(); });
  kindSel.addEventListener("change", reset);
  filt.addEventListener("input", reset);
  $("#more").addEventListener("click", () => { browseLimit += PAGE_SIZE; renderBrowse(); });
  $("#table tbody").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-pid]");
    if (b) { openPage(b.dataset.pid); $("#lookup").scrollIntoView({ behavior: "smooth" }); }
  });
  renderBrowse();
}

let browseSeq = 0;
async function renderBrowse() {
  const mine = ++browseSeq;
  const year = $("#year").value, kind = $("#kind").value, f = $("#filter").value.trim().toLowerCase();
  const data = await loadYear(year);
  if (mine !== browseSeq) return;
  const groups = new Set(META.type_groups.map((t) => META.types.indexOf(t)));
  const rows = data.filter(([, , , , title, t]) => {
    if (kind === "other" ? groups.has(t) : kind !== "" && t !== +kind) return false;
    return !f || title.toLowerCase().includes(f);
  });
  const all = data.length;
  $("#browse-sub").textContent = `${whole.format(all)} pages had an edit war in ${year}, out of ${whole.format(META.pages_edited[year])} pages edited${partial[year] ? ` (first ${partial[year]} months only)` : ""}.${rows.length !== all ? ` ${whole.format(rows.length)} match your filters.` : ""} Click a title to see its history.`;
  const body = $("#table tbody");
  body.innerHTML = rows.length ? rows.slice(0, browseLimit).map(([rank, pid, M, editors, title, t]) => {
    const type = typeName(t);
    return `<tr><td class="num">${whole.format(rank)}</td><td><button data-pid="${pid}"${type === "human" ? ' class="p"' : ""}>${esc(title)}</button></td><td class="kind hide-sm">${esc(kindLabel(type))}</td><td class="num">${compact.format(M)}</td><td class="num hide-sm">${whole.format(editors)}</td></tr>`;
  }).join("") : `<tr><td colspan="5" class="empty">No pages match.</td></tr>`;
  $("#more").hidden = rows.length <= browseLimit;
}

/* ---------- routing ---------- */
function route() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get("page")) {
    renderPage(h.get("page")).then(() => $("#lookup").scrollIntoView());
  }
  if (h.get("year") && META.years.includes(+h.get("year"))) {
    $("#year").value = h.get("year");
    browseLimit = PAGE_SIZE;
    renderBrowse();
    if (!h.get("page")) $("#browse").scrollIntoView();
  }
}

init().catch((err) => {
  document.querySelector("main").insertAdjacentHTML("afterbegin", `<p class="empty">Could not load the data (${esc(err.message)}).</p>`);
});
