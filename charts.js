/* Laurens App — SVG charts.
 *
 * Palette: slots 1-3 of the validated dark categorical set (blue / orange /
 * aqua), checked against this app's card surface (#191C21) for the lightness
 * band, chroma floor, all-pairs CVD separation, the normal-vision floor and
 * 3:1 contrast. Do not substitute colours without re-validating.
 *
 * Every chart is single-axis, ships a touch tooltip (the phone's equivalent of
 * hover) and a "Show data" table so nothing depends on colour alone.
 */

const W = 320;
const PAD = { l: 36, r: 10, t: 12, b: 24 };

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v) => Math.round(v * 10) / 10;

/* Nice round axis maximum, so the ticks read as numbers a human would pick. */
function niceMax(v) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const s = v / mag;
  const step = s <= 1 ? 1 : s <= 2 ? 2 : s <= 2.5 ? 2.5 : s <= 5 ? 5 : 10;
  return step * mag;
}

function shortNum(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return String(Math.round(v * 10) / 10);
}

function emptyBlock(msg) {
  return `<div class="viz-empty">${esc(msg)}</div>`;
}

/* Bar with a 4px rounded top, anchored square to the baseline. */
function barPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  if (h <= 0.5) return '';
  return `M${n(x)} ${n(y + h)} L${n(x)} ${n(y + r)} Q${n(x)} ${n(y)} ${n(x + r)} ${n(y)} `
    + `L${n(x + w - r)} ${n(y)} Q${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + r)} L${n(x + w)} ${n(y + h)} Z`;
}

/* Horizontal bar with a rounded right end. */
function hbarPath(x, y, w, h) {
  const r = Math.min(4, h / 2, w);
  if (w <= 0.5) return '';
  return `M${n(x)} ${n(y)} L${n(x + w - r)} ${n(y)} Q${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + r)} `
    + `L${n(x + w)} ${n(y + h - r)} Q${n(x + w)} ${n(y + h)} ${n(x + w - r)} ${n(y + h)} L${n(x)} ${n(y + h)} Z`;
}

/* Shared scaffolding: a chart figure with a caption and a data table. */
function figure(title, sub, svg, table, id) {
  return `<figure class="viz" id="${id}">
    <figcaption class="viz-head"><span class="viz-title">${esc(title)}</span>${sub ? `<span class="viz-sub">${esc(sub)}</span>` : ''}</figcaption>
    <div class="viz-plot">${svg}<div class="viz-tip" hidden></div></div>
    <details class="viz-data"><summary>Show data</summary>${table}</details>
  </figure>`;
}

function tableHTML(cols, rows) {
  return `<div class="viz-table-wrap"><table class="viz-table">
    <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

/* ── vertical bar chart ────────────────────────────────────────────── */

export function barChart({ title, sub, data, unit = '', color = 'var(--viz-1)', id = 'c' + Math.random().toString(36).slice(2, 7) }) {
  if (!data.length || data.every(d => !d.value)) return figure(title, sub, emptyBlock('No data yet'), '', id);

  const H = 168;
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const max = niceMax(Math.max(...data.map(d => d.value)));
  const step = iw / data.length;
  // 2-3px surface gap between bars, and never thicker than 24px — a wide bar
  // in a wide slot reads as a block, not a measurement.
  const bw = Math.min(24, Math.max(3, step - 3));
  const y = (v) => PAD.t + ih - (v / max) * ih;
  // Label about four ticks, whatever the bucket count, so they never collide.
  const every = Math.ceil(data.length / 4);

  let grid = '', ticks = '';
  for (let i = 0; i <= 2; i++) {
    const v = (max / 2) * i, yy = y(v);
    grid += `<path class="viz-grid" d="M${PAD.l} ${n(yy)} L${W - PAD.r} ${n(yy)}"/>`;
    ticks += `<text class="viz-tick" x="${PAD.l - 6}" y="${n(yy + 3.5)}" text-anchor="end">${shortNum(v)}</text>`;
  }

  let bars = '', labels = '';
  data.forEach((d, i) => {
    const x = PAD.l + i * step + (step - bw) / 2;
    const h = (d.value / max) * ih;
    bars += `<path class="viz-mark" fill="${color}" d="${barPath(x, y(d.value), bw, h)}"
      data-i="${i}" data-label="${esc(d.label)}" data-value="${esc(shortNum(d.value) + unit)}"/>`;
    if ((data.length - 1 - i) % every === 0) {
      labels += `<text class="viz-tick" x="${n(x + bw / 2)}" y="${H - 8}" text-anchor="middle">${esc(d.tick || d.label)}</text>`;
    }
  });

  const svg = `<svg viewBox="0 0 ${W} ${H}" class="viz-svg" role="img" aria-label="${esc(title)}">
    ${grid}${ticks}
    <path class="viz-axis" d="M${PAD.l} ${PAD.t + ih} L${W - PAD.r} ${PAD.t + ih}"/>
    ${bars}${labels}
  </svg>`;

  return figure(title, sub, svg,
    tableHTML(['Period', title], data.map(d => [d.label, shortNum(d.value) + unit])), id);
}

/* ── horizontal bar chart ──────────────────────────────────────────── */

export function hBarChart({ title, sub, data, unit = '', color = 'var(--viz-1)', id = 'c' + Math.random().toString(36).slice(2, 7) }) {
  if (!data.length) return figure(title, sub, emptyBlock('No data yet'), '', id);

  const rowH = 26, labelW = 74;
  const H = data.length * rowH + 10;
  const max = Math.max(...data.map(d => d.value)) || 1;
  const iw = W - labelW - 42;

  let rows = '';
  data.forEach((d, i) => {
    const y = 6 + i * rowH;
    const w = (d.value / max) * iw;
    rows += `<text class="viz-rowlabel" x="${labelW - 8}" y="${y + 13}" text-anchor="end">${esc(d.label)}</text>`;
    rows += `<path class="viz-mark" fill="${color}" d="${hbarPath(labelW, y + 3, w, 14)}"
      data-label="${esc(d.label)}" data-value="${esc(d.value + unit)}"/>`;
    rows += `<text class="viz-value" x="${n(labelW + w + 7)}" y="${y + 14}">${esc(String(d.value))}</text>`;
  });

  const svg = `<svg viewBox="0 0 ${W} ${H}" class="viz-svg" role="img" aria-label="${esc(title)}">${rows}</svg>`;
  return figure(title, sub, svg,
    tableHTML([title, 'Sets'], data.map(d => [d.label, String(d.value)])), id);
}

/* ── line chart ────────────────────────────────────────────────────── */

/* series: [{ name, color, points: [{x: ISO date, y: number}] }]
 *
 * zeroBase defaults to true. Set it false when the *change* is the story and
 * the values sit far from zero (bodyweight, a strength curve) — a zero-anchored
 * axis flattens a 4 kg swing into a straight line. Bars always keep their zero
 * baseline; only lines get this. */
export function lineChart({ title, sub, series, unit = '', zeroBase = true, id = 'c' + Math.random().toString(36).slice(2, 7) }) {
  const live = series.filter(s => s.points.length);
  if (!live.length) return figure(title, sub, emptyBlock('Log this a few times to see a trend'), '', id);

  const H = 176;
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const all = live.flatMap(s => s.points);
  const xs = [...new Set(all.map(p => p.x))].sort();

  let minY = 0, maxY;
  const hi = Math.max(...all.map(p => p.y)), lo = Math.min(...all.map(p => p.y));
  if (zeroBase || lo <= 0) {
    maxY = niceMax(hi);
  } else {
    const span = (hi - lo) || Math.max(hi * 0.08, 1);
    const step = niceMax(span) / 2;
    minY = Math.max(0, Math.floor((lo - span * 0.3) / step) * step);
    maxY = Math.ceil((hi + span * 0.3) / step) * step;
    if (maxY <= minY) maxY = minY + step;
  }

  const tx = (iso) => xs.length === 1 ? PAD.l + iw / 2 : PAD.l + (xs.indexOf(iso) / (xs.length - 1)) * iw;
  const ty = (v) => PAD.t + ih - ((v - minY) / (maxY - minY)) * ih;

  let grid = '', ticks = '';
  for (let i = 0; i <= 2; i++) {
    const v = minY + ((maxY - minY) / 2) * i, yy = ty(v);
    grid += `<path class="viz-grid" d="M${PAD.l} ${n(yy)} L${W - PAD.r} ${n(yy)}"/>`;
    ticks += `<text class="viz-tick" x="${PAD.l - 6}" y="${n(yy + 3.5)}" text-anchor="end">${shortNum(v)}</text>`;
  }

  let paths = '', dots = '';
  live.forEach((s) => {
    const pts = [...s.points].sort((a, b) => a.x.localeCompare(b.x));
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${n(tx(p.x))} ${n(ty(p.y))}`).join(' ');
    paths += `<path class="viz-line" stroke="${s.color}" d="${d}"/>`;
    // Markers only when the series is short enough that they stay legible.
    if (pts.length <= 14) {
      for (const p of pts) {
        dots += `<circle class="viz-dot" fill="${s.color}" cx="${n(tx(p.x))}" cy="${n(ty(p.y))}" r="4"/>`;
      }
    }
  });

  // One invisible hit column per date drives the touch tooltip.
  let hits = '';
  const colW = xs.length === 1 ? iw : iw / (xs.length - 1);
  xs.forEach((iso) => {
    const payload = live.map(s => {
      const p = s.points.find(q => q.x === iso);
      return p ? `${s.name}: ${shortNum(p.y)}${unit}` : null;
    }).filter(Boolean).join(' · ');
    hits += `<rect class="viz-hit" x="${n(tx(iso) - colW / 2)}" y="${PAD.t}" width="${n(colW)}" height="${ih}"
      data-label="${esc(fmtShortDate(iso))}" data-value="${esc(payload)}" data-x="${n(tx(iso))}"/>`;
  });

  const first = fmtShortDate(xs[0]), last = fmtShortDate(xs[xs.length - 1]);
  const axisLabels = `<text class="viz-tick" x="${PAD.l}" y="${H - 7}">${esc(first)}</text>`
    + (xs.length > 1 ? `<text class="viz-tick" x="${W - PAD.r}" y="${H - 7}" text-anchor="end">${esc(last)}</text>` : '');

  const svg = `<svg viewBox="0 0 ${W} ${H}" class="viz-svg" role="img" aria-label="${esc(title)}">
    ${grid}${ticks}
    <path class="viz-axis" d="M${PAD.l} ${PAD.t + ih} L${W - PAD.r} ${PAD.t + ih}"/>
    <path class="viz-crosshair" d="" hidden/>
    ${paths}${dots}${axisLabels}${hits}
  </svg>`;

  // A legend is mandatory from two series up; one series is named by the title.
  const legend = live.length > 1
    ? `<div class="viz-legend">${live.map(s => `<span class="viz-key"><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`
    : '';

  const rows = xs.map(iso => [fmtShortDate(iso), ...live.map(s => {
    const p = s.points.find(q => q.x === iso);
    return p ? shortNum(p.y) + unit : '—';
  })]);

  return figure(title, sub, svg + legend, tableHTML(['Date', ...live.map(s => s.name)], rows), id);
}

export function fmtShortDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/* ── touch tooltips ────────────────────────────────────────────────── */

/* Delegated once for the whole app: a tap on any mark or hit area shows the
 * tooltip for that mark, and a tap anywhere else dismisses it. */
export function initVizTooltips(root) {
  const show = (fig, target, clientX) => {
    const tip = fig.querySelector('.viz-tip');
    if (!tip) return;
    const label = target.getAttribute('data-label') || '';
    const value = target.getAttribute('data-value') || '';
    tip.innerHTML = `<b>${esc(label)}</b>${value ? `<span>${esc(value)}</span>` : ''}`;
    tip.hidden = false;
    const box = fig.querySelector('.viz-plot').getBoundingClientRect();
    const x = Math.min(Math.max(clientX - box.left, 46), box.width - 46);
    tip.style.left = x + 'px';
  };

  const hideAll = () => root.querySelectorAll('.viz-tip').forEach(t => { t.hidden = true; });

  root.addEventListener('pointerdown', (e) => {
    const mark = e.target.closest('.viz-mark, .viz-hit');
    if (!mark) { hideAll(); return; }
    const fig = mark.closest('.viz');
    hideAll();
    show(fig, mark, e.clientX);
  });

  root.addEventListener('pointermove', (e) => {
    if (e.pressure === 0 && e.pointerType === 'touch') return;
    const mark = e.target.closest('.viz-mark, .viz-hit');
    if (!mark) return;
    const fig = mark.closest('.viz');
    if (fig.querySelector('.viz-tip').hidden && e.pointerType === 'touch') return;
    show(fig, mark, e.clientX);
  });

  root.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') setTimeout(hideAll, 1800);
  });
}
