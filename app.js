"use strict";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en");
const PAGE_SIZE = 50;

let D, byYear, byPage, titleIndex, partial;
let browseLimit = PAGE_SIZE;

function kindLabel(t) {
  if (t === "human") return "Person";
  if (t === "Wikimedia list article") return "List";
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}
const page = (pid) => D.pages[pid];
const isPerson = (pid) => page(pid)[2] === "human";
const wikiUrl = (pid) => `https://en.wikipedia.org/?curid=${pid}`;
const yearLabel = (y) => (partial[y] ? `${y}*` : String(y));

async function init() {
  D = await (await fetch("data/top500.json")).json();
  partial = D.partial_years || {};
  byYear = new Map(D.years.map((y) => [y, []]));
  byPage = new Map();
  for (const [year, rank, pid, M, editors] of D.rows) {
    const r = { year, rank, pid: String(pid), M, editors };
    byYear.get(year).push(r);
    if (!byPage.has(r.pid)) byPage.set(r.pid, []);
    byPage.get(r.pid).push(r);
  }
  titleIndex = Object.entries(D.pages).map(([pid, [title]]) => ({ pid, title, key: title.toLowerCase() }));

  $("#snap").textContent = D.snapshot;
  const p = Object.entries(partial).map(([y, m]) => `${y} covers only its first ${m} months, so its scores are lower and not directly comparable with full years.`);
  $("#partial-note").textContent = p.join(" ") || "All years are complete.";

  renderStrip();
  setupBrowse();
  setupSearch();
  window.addEventListener("hashchange", route);
  route();
}

/* ---------- #1 strip ---------- */
function renderStrip() {
  const cards = D.years.map((y) => {
    const rows = byYear.get(y);
    const top = rows[0];
    const person = rows.find((r) => isPerson(r.pid));
    const pick = (r, cls) => r ? `
      <div class="${cls}">
        <div class="lbl">${cls === "person" ? "Top person" : "Top page"}</div>
        <button data-pid="${r.pid}">${esc(page(r.pid)[0])}</button>
        ${cls === "person" && r.rank > 1 ? `<div class="rk">#${r.rank} overall</div>` : ""}
      </div>` : "";
    const samePerson = person && person.pid === top.pid;
    return `<div class="card" role="listitem">
      <div class="yr">${y}${partial[y] ? ` <small>partial</small>` : ""}</div>
      ${pick(top, "top")}
      ${samePerson ? `<div class="rk">Also the top person</div>` : pick(person, "person")}
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
  let items = [], active = -1;

  const close = () => { list.hidden = true; q.setAttribute("aria-expanded", "false"); active = -1; };
  const highlight = () => [...list.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));

  q.addEventListener("input", () => {
    const s = q.value.trim().toLowerCase();
    if (s.length < 2) return close();
    const starts = [], has = [];
    for (const t of titleIndex) {
      if (t.key.startsWith(s)) starts.push(t);
      else if (t.key.includes(s)) has.push(t);
    }
    const best = (t) => Math.min(...byPage.get(t.pid).map((r) => r.rank));
    const sorter = (a, b) => best(a) - best(b);
    items = [...starts.sort(sorter), ...has.sort(sorter)].slice(0, 12);
    if (!items.length) {
      list.innerHTML = `<li class="none">No page with that title made a top 500</li>`;
    } else {
      list.innerHTML = items.map((t, i) => {
        const n = byPage.get(t.pid).length;
        return `<li role="option" id="opt${i}" data-pid="${t.pid}"><span>${esc(t.title)}</span><span class="meta">best #${best(t)} · ${n} yr${n > 1 ? "s" : ""}</span></li>`;
      }).join("");
    }
    active = -1;
    list.hidden = false;
    q.setAttribute("aria-expanded", "true");
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
function renderPage(pid) {
  const view = $("#page-view");
  const info = page(pid);
  if (!info) { view.hidden = true; return; }
  const [title, , type] = info;
  const rows = byPage.get(pid);
  const best = rows.reduce((a, b) => (b.rank < a.rank ? b : a));
  const peak = rows.reduce((a, b) => (b.M > a.M ? b : a));
  $("#q").value = title;

  view.innerHTML = `
    <div class="pv-head">
      <h3>${esc(title)}</h3>
      ${type ? `<span class="chip">${esc(kindLabel(type))}</span>` : ""}
      <a href="${wikiUrl(pid)}" target="_blank" rel="noopener">Open on Wikipedia ↗</a>
    </div>
    <div class="pv-stats">
      <div><b>#${best.rank}</b>best rank (${yearLabel(best.year)})</div>
      <div><b>${rows.length}</b>of ${D.years.length} years in the top 500</div>
      <div><b>${compact.format(peak.M)}</b>peak score (${yearLabel(peak.year)})</div>
    </div>
    ${chart(rows)}
    <p class="chart-note">Rank among all English Wikipedia pages that year (log scale). Grey marks: not in that year's top 500.${Object.keys(partial).length ? " * Partial year." : ""}</p>
    <details>
      <summary>Year by year</summary>
      <div class="table-wrap" style="margin-top:10px">
        <table><thead><tr><th>Year</th><th class="num">Rank</th><th class="num">Score</th><th class="num">Editors in mutual reverts</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${yearLabel(r.year)}</td><td class="num">#${r.rank}</td><td class="num">${whole.format(r.M)}</td><td class="num">${whole.format(r.editors)}</td></tr>`).join("")}</tbody></table>
      </div>
    </details>`;
  view.hidden = false;
}

function chart(rows) {
  const W = 680, H = 230, L = 40, R = 14, T = 16, B = 30;
  const years = D.years, n = years.length;
  const x = (y) => L + ((y - years[0]) / (years[n - 1] - years[0])) * (W - L - R);
  const y = (rank) => T + (Math.log10(rank) / Math.log10(500)) * (H - T - B);
  const at = new Map(rows.map((r) => [r.year, r]));
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Rank by year">`;
  for (const t of [1, 10, 100, 500]) {
    svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">#${t}</text>`;
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
  for (const yr of years) {
    const r = at.get(yr);
    if (!r) { svg += `<rect class="miss" x="${x(yr) - 3}" y="${H - B + 4}" width="6" height="3" rx="1"><title>${yr}: not in top 500</title></rect>`; continue; }
    svg += `<circle class="dot${partial[yr] ? " partial" : ""}" cx="${x(yr)}" cy="${y(r.rank)}" r="4"><title>${yearLabel(yr)}: #${r.rank}, score ${whole.format(r.M)}</title></circle>`;
  }
  const bx = x(best.year), anchor = bx > W - 80 ? "end" : bx < L + 40 ? "start" : "middle";
  svg += `<text class="val" x="${bx}" y="${Math.max(y(best.rank) - 9, 11)}" text-anchor="${anchor}">#${best.rank}</text>`;
  return svg + "</svg>";
}

/* ---------- browse ---------- */
function setupBrowse() {
  const yearSel = $("#year"), kindSel = $("#kind"), filt = $("#filter");
  yearSel.innerHTML = [...D.years].reverse().map((y) => `<option value="${y}">${y}${partial[y] ? " (partial)" : ""}</option>`).join("");
  const full = D.years.filter((y) => !partial[y]);
  yearSel.value = String(full[full.length - 1]);
  kindSel.innerHTML = `<option value="">All</option>` +
    D.type_groups.map((t) => `<option value="${esc(t)}">${esc(kindLabel(t))}</option>`).join("") +
    `<option value="__other">Everything else</option>`;
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

function renderBrowse() {
  const year = +$("#year").value, kind = $("#kind").value, f = $("#filter").value.trim().toLowerCase();
  const groups = new Set(D.type_groups);
  const rows = byYear.get(year).filter((r) => {
    const [title, , t] = page(r.pid);
    if (kind === "__other" ? groups.has(t) : kind && t !== kind) return false;
    return !f || title.toLowerCase().includes(f);
  });
  $("#browse-sub").textContent = `${rows.length} of the top 500 pages of ${year}${partial[year] ? ` (first ${partial[year]} months only)` : ""}. Click a title to see its history.`;
  const body = $("#table tbody");
  body.innerHTML = rows.length ? rows.slice(0, browseLimit).map((r) => {
    const [title, , t] = page(r.pid);
    return `<tr><td class="num">${r.rank}</td><td><button data-pid="${r.pid}"${t === "human" ? ' class="p"' : ""}>${esc(title)}</button></td><td class="kind hide-sm">${esc(kindLabel(t))}</td><td class="num">${compact.format(r.M)}</td><td class="num hide-sm">${whole.format(r.editors)}</td></tr>`;
  }).join("") : `<tr><td colspan="5" class="empty">No pages match.</td></tr>`;
  $("#more").hidden = rows.length <= browseLimit;
}

/* ---------- routing ---------- */
function route() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get("page")) {
    renderPage(h.get("page"));
    $("#lookup").scrollIntoView();
  }
  if (h.get("year") && byYear.has(+h.get("year"))) {
    $("#year").value = h.get("year");
    browseLimit = PAGE_SIZE;
    renderBrowse();
    if (!h.get("page")) $("#browse").scrollIntoView();
  }
}

init().catch((err) => {
  document.querySelector("main").insertAdjacentHTML("afterbegin", `<p class="empty">Could not load the data (${esc(err.message)}).</p>`);
});
