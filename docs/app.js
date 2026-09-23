"use strict";

const $ = (id) => document.getElementById(id);
const state = { data: null, sector: "All", period: "all", query: "", visible: 12, selected: null };
const number = new Intl.NumberFormat("en-CA");
const dateLabel = (value) => value ? new Date(`${value}T12:00:00Z`).toLocaleDateString("en-CA", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "Not supplied";
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const append = (parent, ...children) => children.forEach((child) => parent.append(child));

function daysBetween(a, b) {
  return Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

function sectorRows() {
  const rows = state.data.records;
  return state.sector === "All" ? rows : rows.filter((row) => row.sector === state.sector);
}

function filteredRows() {
  const query = state.query.trim().toLowerCase();
  return sectorRows().filter((row) => {
    if (state.period !== "all" && daysBetween(row.updated, state.data.metadata.as_of) >= Number(state.period)) return false;
    if (!query) return true;
    return [row.title, row.product, row.issue, row.category, row.organization].some((value) => value.toLowerCase().includes(query));
  });
}

function renderKpis() {
  const rows = sectorRows();
  const recent = rows.filter((row) => daysBetween(row.updated, state.data.metadata.as_of) < 7).length;
  const sectors = new Set(rows.map((row) => row.sector)).size;
  const stats = [
    ["Notices in snapshot", number.format(rows.length), state.sector === "All" ? "Across all sectors" : state.sector],
    ["Updated past 7 days", number.format(recent), "Source last-updated date"],
    ["Sectors represented", number.format(sectors), "From source organizations"],
    ["Source records checked", number.format(state.data.metadata.source_records), "Before date and scope filtering"],
  ];
  $("kpis").replaceChildren(...stats.map(([label, value, note]) => {
    const card = element("div", "kpi");
    append(card, element("span", "", label), element("strong", "", value), element("small", "", note));
    return card;
  }));
}

function renderSectors() {
  const sectors = ["All", ...new Set(state.data.records.map((row) => row.sector))];
  const counts = new Map(sectors.map((sector) => [sector, sector === "All" ? state.data.records.length : state.data.records.filter((row) => row.sector === sector).length]));
  $("sector-filters").replaceChildren(...sectors.map((sector) => {
    const button = element("button", `sector-btn${state.sector === sector ? " active" : ""}`, `${sector}  ${number.format(counts.get(sector))}`);
    button.type = "button";
    button.setAttribute("aria-pressed", String(state.sector === sector));
    button.addEventListener("click", () => { state.sector = sector; state.visible = 12; state.selected = null; render(); });
    return button;
  }));
}

function selectRecord(row) {
  state.selected = row.id;
  if (filteredRows().slice(0, state.visible).some((item) => item.id === row.id)) {
    renderResults();
  } else {
    document.querySelectorAll("#results .result").forEach((button) => button.classList.remove("selected"));
  }
  renderDetail(row);
  if (window.innerWidth < 900) $("detail-title").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderResults() {
  const rows = filteredRows();
  $("result-count").textContent = number.format(rows.length);
  $("results-caption").textContent = rows.length ? `Sorted by source last-updated date · ${state.period === "all" ? "full snapshot" : `past ${state.period} days`}` : "No notices match these filters.";
  const items = rows.slice(0, state.visible).map((row) => {
    const button = element("button", `result${state.selected === row.id ? " selected" : ""}`);
    button.type = "button";
    const top = element("span", "result-top");
    append(top, element("span", "tag", row.sector), element("span", "result-date", dateLabel(row.updated)));
    append(button, top, element("span", "result-title", row.title), element("span", "result-meta", [row.category, row.issue].filter(Boolean).join(" · ") || "Issue not supplied"));
    button.addEventListener("click", () => selectRecord(row));
    return button;
  });
  $("results").replaceChildren(...(items.length ? items : [element("div", "empty-state", "Try a broader search, another sector, or a longer date range.")]));
  $("load-more").hidden = rows.length <= state.visible;
  if (!rows.length) {
    state.selected = null;
    $("detail").replaceChildren(element("div", "empty-detail", "No notice selected in this view."));
  } else if (!state.selected || !rows.some((row) => row.id === state.selected)) {
    state.selected = rows[0].id;
    renderDetail(rows[0]);
    items[0]?.classList.add("selected");
  }
}

function renderDetail(row) {
  const root = $("detail");
  const body = element("div", "detail-content");
  const title = element("h4", "", row.title);
  const date = element("div", "detail-date", `Last updated ${dateLabel(row.updated)} · ${row.archived ? "Archived in source" : "Not archived in source"}`);
  append(body, element("span", "tag", row.sector), title, date);
  const list = element("dl");
  for (const [label, value] of [
    ["Product", row.product || "Not supplied"],
    ["Issue", row.issue || "Not supplied"],
    ["Category", row.category || "Not supplied"],
    ["Source unit", row.organization || "Not supplied"],
    ["Recall class", row.recall_class || "Not supplied"],
    ["Notice ID", row.id],
  ]) {
    const line = element("div"); append(line, element("dt", "", label), element("dd", "", value)); list.append(line);
  }
  body.append(list);
  const link = element("a", "source-button", "Open official notice ↗");
  link.href = row.url; link.target = "_blank"; link.rel = "noopener noreferrer";
  append(body, link, element("p", "detail-note", "For instructions or safety decisions, read the complete official notice."));
  const related = element("div", "related");
  related.append(element("h5", "", "Related notices by text similarity"));
  const byId = new Map(state.data.records.map((item) => [item.id, item]));
  const matches = row.similar_ids.map((id) => byId.get(id)).filter(Boolean);
  if (!matches.length) related.append(element("p", "detail-note", "No strong text match within this sector."));
  for (const match of matches) {
    const button = element("button", "", match.title);
    button.type = "button";
    button.addEventListener("click", () => selectRecord(match));
    related.append(button);
  }
  body.append(related);
  root.replaceChildren(body);
}

function svg(tag, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function renderTrend() {
  const asOf = state.data.metadata.as_of;
  const [year, month] = asOf.split("-").map(Number);
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1 - (12 - i), 1));
    return d.toISOString().slice(0, 7);
  });
  const counts = new Map(months.map((key) => [key, 0]));
  sectorRows().forEach((row) => { const key = row.updated.slice(0, 7); if (counts.has(key)) counts.set(key, counts.get(key) + 1); });
  const values = [...counts.values()];
  const max = Math.max(1, ...values);
  const monthValues = months.map((month, i) => `${month}: ${number.format(values[i])}`).join("; ");
  const chart = svg("svg", { viewBox: "0 0 560 220", role: "img", "aria-label": `Monthly notices updated over 12 complete months. ${monthValues}` });
  const x = (i) => 32 + i * 45;
  const y = (v) => 178 - (v / max) * 147;
  for (let i = 0; i <= 3; i++) {
    const yy = 178 - i * 49;
    chart.append(svg("line", { x1: 32, x2: 532, y1: yy, y2: yy, class: "gridline" }));
    const label = svg("text", { x: 0, y: yy + 3, class: "chart-label" }); label.textContent = String(Math.round(max * i / 3)); chart.append(label);
  }
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  chart.append(svg("polygon", { points: `32,178 ${points} ${x(11)},178`, class: "area" }));
  chart.append(svg("polyline", { points, class: "line" }));
  values.forEach((value, i) => {
    const dot = svg("circle", { cx: x(i), cy: y(value), r: 4, class: "chart-dot" });
    const tip = svg("title"); tip.textContent = `${months[i]}: ${number.format(value)} notices updated`; dot.append(tip); chart.append(dot);
    if (i % 2 === 0 || i === 11) {
      const label = svg("text", { x: x(i), y: 205, "text-anchor": "middle", class: "chart-label" });
      label.textContent = new Date(`${months[i]}-01T00:00:00Z`).toLocaleDateString("en-CA", { month: "short", timeZone: "UTC" }); chart.append(label);
    }
  });
  $("trend").replaceChildren(chart);
}

function renderIssues() {
  const counts = new Map();
  filteredRows().forEach((row) => {
    if (row.issue) counts.set(row.issue, (counts.get(row.issue) || 0) + 1);
  });
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 7);
  if (!ranked.length) { $("issues").replaceChildren(element("div", "empty-state", "No issue labels in this view.")); return; }
  const max = ranked[0][1];
  $("issues").replaceChildren(...ranked.map(([issue, count]) => {
    const row = element("div", "issue-row");
    const name = element("span", "issue-name", issue); name.title = issue;
    const track = element("div", "issue-track");
    const fill = element("div", "issue-fill"); fill.style.width = `${100 * count / max}%`;
    track.append(fill);
    append(row, name, track, element("span", "issue-value", number.format(count)));
    return row;
  }));
}

function render() {
  renderSectors(); renderKpis(); renderResults(); renderTrend(); renderIssues();
}

async function init() {
  try {
    const response = await fetch("./data.json");
    if (!response.ok) throw new Error(`Data request returned ${response.status}`);
    state.data = await response.json();
    const metadata = state.data.metadata;
    $("snapshot-status").textContent = `Snapshot ${dateLabel(metadata.as_of)} · Government of Canada open data`;
    $("coverage").textContent = `${number.format(metadata.included_records)} dated notices · ${number.format(metadata.records_without_valid_date)} undated source records excluded`;
    render();
    $("search").addEventListener("input", (event) => { state.query = event.target.value; state.visible = 12; state.selected = null; renderResults(); renderIssues(); });
    $("period").addEventListener("change", (event) => { state.period = event.target.value; state.visible = 12; state.selected = null; renderResults(); renderIssues(); });
    $("load-more").addEventListener("click", () => { state.visible += 12; renderResults(); });
    document.addEventListener("keydown", (event) => { if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) { event.preventDefault(); $("search").focus(); } });
  } catch (error) {
    $("snapshot-status").textContent = `Unable to load the data snapshot: ${error.message}`;
    $("results").replaceChildren(element("div", "empty-state", "Reload this page, or check the source and code links below."));
  }
}

init();
