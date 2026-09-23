/* Train App — views, routing and interaction. */

import { EQUIPMENT, GROUPS } from './exercises.js';
import * as S from './store.js';
import { animate, renderStill } from './anim.js';
import * as G from './generator.js';
import { barChart, hBarChart, lineChart, initVizTooltips, fmtShortDate } from './charts.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const VIEWS = ['train', 'routines', 'library', 'history', 'stats'];
let view = 'train';

/* Transient UI state. */
const ui = {
  libQuery: '', libEq: 'all', libGroup: 'all',
  editingRoutine: null,
  statsExercise: null,
  pickTarget: null,          // 'workout' | 'routine'
  picked: new Set(),
  generated: null,           // last generated workout, shown in the sheet
};

let stopAnim = null;         // teardown for the animation currently on screen

/* ── small utilities ───────────────────────────────────────────────── */

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2200);
}

function haptic() {
  if (navigator.vibrate) navigator.vibrate(12);
}

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  const today = S.todayISO();
  if (iso === today) return 'Today';
  if (iso === S.daysAgoISO(1)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function unit() { return S.state.settings.unit; }

/* Weight shown in the user's current unit, from a stored {w,u} pair. */
function displayWeight(w, u) {
  if (w === undefined || w === null || w === '') return '';
  if (u === unit()) return S.fmtNum(w);
  return S.fmtNum(S.fromKg(S.toKg(w, u), unit()));
}

/* ── sheet ─────────────────────────────────────────────────────────── */

function openSheet(title, body, opts = {}) {
  const sheet = $('#sheet');
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = body;
  $('#sheetAction').innerHTML = opts.action || '';
  $('#sheetBg').classList.add('show');
  // Flush layout so the slide-up transition has a starting frame. Deliberately
  // not requestAnimationFrame: that never fires while the tab is backgrounded,
  // which would leave the sheet stuck off-screen.
  void sheet.offsetHeight;
  sheet.classList.add('show');
  $('#sheetBody').scrollTop = 0;
  if (opts.onOpen) opts.onOpen($('#sheetBody'));
}

function closeSheet() {
  $('#sheet').classList.remove('show');
  $('#sheetBg').classList.remove('show');
  if (stopAnim) { stopAnim(); stopAnim = null; }
  setTimeout(() => { if (!$('#sheet').classList.contains('show')) $('#sheetBody').innerHTML = ''; }, 240);
}

/* ── thumbnails ────────────────────────────────────────────────────── */

/* 200+ exercises means 200+ little SVGs; only draw the ones actually on
 * screen, or opening the library janks on an older phone. */
const thumbObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const svg = e.target;
    thumbObserver.unobserve(svg);
    renderStill(svg, S.exById(svg.dataset.ex), 1);
  }
}, { rootMargin: '120px' });

function hydrateThumbs(root) {
  $$('svg.thumb-svg', root).forEach(svg => thumbObserver.observe(svg));
}

const thumbHTML = (ex) => `<div class="thumb"><svg class="fig thumb-svg" data-ex="${ex.id}" viewBox="0 0 200 200"></svg></div>`;

/* ── navigation ────────────────────────────────────────────────────── */

function go(next) {
  view = next;
  if (stopAnim) { stopAnim(); stopAnim = null; }
  for (const v of VIEWS) $('#view-' + v).hidden = v !== next;
  $$('nav button').forEach(b => b.classList.toggle('on', b.dataset.view === next));
  render();
  window.scrollTo(0, 0);
}

function render() {
  ({ train: renderTrain, routines: renderRoutines, library: renderLibrary, history: renderHistory, stats: renderStats })[view]();
  $('#activeDot').hidden = !S.state.active;
}

/* ── TRAIN ─────────────────────────────────────────────────────────── */

function renderTrain() {
  const root = $('#view-train');
  const a = S.state.active;
  root.innerHTML = a ? activeWorkoutHTML(a) : startScreenHTML();
  hydrateThumbs(root);          // the active workout's cards carry thumbnails too
}

function startScreenHTML() {
  const recent = S.sessionsSorted().slice(0, 3);
  const routines = S.state.routines;
  const last = S.latestBody();

  return `
    <h2>Start a workout</h2>
    <button class="btn btn-primary" data-act="quick-start">Empty workout</button>
    <div style="height:10px"></div>

    ${generatorHTML()}

    ${routines.length ? `
      <div class="eyebrow" style="margin:16px 2px 8px">Your routines</div>
      <div class="card flush">
        ${routines.map(r => `
          <button class="list-item" data-act="start-routine" data-id="${r.id}">
            <div class="grow">
              <div class="truncate" style="font-weight:650">${esc(r.name)}</div>
              <div class="meta">${r.items.length} exercise${r.items.length === 1 ? '' : 's'} · ${routineSummary(r)}</div>
            </div>
            <span class="chev">▶</span>
          </button>`).join('')}
      </div>` : `
      <div class="banner">No routines yet. Build one on the <b>Routines</b> tab, then start it here with one tap.</div>`}

    ${recent.length ? `
      <div class="eyebrow" style="margin:20px 2px 8px">Recent workouts</div>
      <div class="card flush">
        ${recent.map(s => `
          <button class="list-item" data-act="open-session" data-id="${s.id}">
            <div class="grow">
              <div class="truncate" style="font-weight:650">${esc(s.name || 'Workout')}</div>
              <div class="meta">${fmtDate(s.date)} · ${S.sessionSets(s)} sets · ${S.fmtNum(S.fromKg(S.sessionVolume(s), unit()), 0)} ${unit()} volume</div>
            </div>
            <span class="chev">›</span>
          </button>`).join('')}
      </div>
      <button class="btn btn-ghost" data-act="repeat-last">Repeat last workout</button>` : ''}

    ${last ? `<div class="divider"></div><div class="small dim" style="text-align:center">
      Bodyweight ${esc(displayWeight(last.w, last.u))} ${unit()} · logged ${fmtDate(last.date)}</div>` : ''}
  `;
}

/* ── workout generator ─────────────────────────────────────────────── */

const GEN_MINUTES = [30, 45, 60, 75];

function genPrefs() {
  const st = S.state.settings;
  return { eq: st.genEq || [], groups: st.genGroups || [], minutes: st.genMinutes || 45, goal: st.genGoal || 'muscle' };
}

function generatorHTML() {
  const p = genPrefs();
  const tick = (name, value, label, on) => `
    <label class="tick-chip"><input type="checkbox" name="${name}" value="${value}" ${on ? 'checked' : ''}>${esc(label)}</label>`;

  return `
    <div class="eyebrow" style="margin:16px 2px 8px">Generate a workout</div>
    <div class="card gen-card">
      <div class="gen-label">Equipment <span>any if none ticked</span></div>
      <div class="tick-grid">${EQUIPMENT.map(e => tick('genEq', e.id, e.label, p.eq.includes(e.id))).join('')}</div>

      <div class="gen-label">Target body area <span>full body if none ticked</span></div>
      <div class="tick-grid">${GROUPS.map(g => tick('genGroups', g, g, p.groups.includes(g))).join('')}</div>

      <div class="gen-label">Goal</div>
      <div class="seg gen-seg" data-pref="genGoal">
        ${G.GOALS.map(g => `<button data-val="${g.id}" class="${p.goal === g.id ? 'on' : ''}">${esc(g.label)}</button>`).join('')}
      </div>

      <div class="gen-label">Time</div>
      <div class="seg gen-seg" data-pref="genMinutes">
        ${GEN_MINUTES.map(m => `<button data-val="${m}" class="${p.minutes === m ? 'on' : ''}">${m} min</button>`).join('')}
      </div>

      <button class="btn btn-primary" data-act="generate">⚄ Generate workout</button>
    </div>`;
}

function runGenerator() {
  const opts = genPrefs();
  if (!G.candidates(opts).length) { toast('No exercises match — tick more boxes'); return; }
  ui.generated = G.generate(opts);
  showGenerated();
}

function showGenerated() {
  const w = ui.generated;
  if (!w) return;
  const scroll = $('#sheet').classList.contains('show') ? $('#sheetBody').scrollTop : 0;
  openSheet('Your workout', `
    <label class="field"><span>Workout name</span>
      <input type="text" id="genName" value="${esc(w.name)}" autocomplete="off"></label>
    ${w.items.length ? `<div class="card flush" style="margin-bottom:10px">${w.items.map((it, i) => {
      const ex = S.exById(it.exId);
      const unitLabel = ex.type === 'time' ? 'sec' : 'reps';
      return `<div class="list-item gen-item">
        ${thumbHTML(ex)}
        <div class="grow" style="min-width:0">
          <div class="truncate" style="font-weight:650">${esc(ex.name)}</div>
          <div class="meta truncate">${esc(eqLabel(ex.eq))} · ${esc(ex.target)}</div>
          ${ex.type === 'cardio' ? `<div class="small dim" style="margin-top:6px">Log time &amp; distance</div>` : `
          <div class="row" style="margin-top:6px">
            <input type="number" inputmode="numeric" data-gitem="${i}" data-field="sets" value="${it.sets}" aria-label="Sets">
            <span class="small dim">sets ×</span>
            <input type="number" inputmode="numeric" data-gitem="${i}" data-field="reps" value="${it.reps ?? ''}" aria-label="${unitLabel}">
            <span class="small dim">${unitLabel}</span>
          </div>`}
        </div>
        <div class="gen-tools">
          <button class="icon-btn" data-act="gen-swap" data-i="${i}" aria-label="Swap exercise" title="Swap">⇄</button>
          <button class="icon-btn" data-act="gen-del" data-i="${i}" aria-label="Remove" title="Remove">✕</button>
        </div>
      </div>`;
    }).join('')}</div>` : `<div class="banner">Every exercise removed — add some or randomize.</div>`}
    <div class="row" style="gap:8px">
      <button class="btn btn-ghost grow" data-act="gen-add">+ Add exercise</button>
      <button class="btn btn-ghost grow" data-act="gen-again">⚄ Randomize all</button>
    </div>
    <div style="height:8px"></div>
    <button class="btn btn-ghost" data-act="gen-save">Save as routine</button>
    <div class="small dim" style="margin-top:10px;text-align:center">⇄ swaps an exercise for a similar one that fits your selections.</div>
  `, {
    action: `<button class="btn btn-primary" data-act="gen-start" ${w.items.length ? '' : 'disabled'}>Start this workout</button>`,
    onOpen: (body) => { hydrateThumbs(body); body.scrollTop = scroll; },
  });
}

function genName() {
  const n = ($('#genName')?.value || '').trim();
  if (n) ui.generated.name = n;
  return ui.generated.name;
}

/* Swap an exercise in the running workout for a similar one. */
function swapActiveEntry(ei) {
  const a = S.state.active;
  const e = a.entries[ei];
  const alt = G.swapFor(e.exId, genPrefs(), a.entries.map(x => x.exId))
    || G.swapFor(e.exId, { eq: [] }, a.entries.map(x => x.exId));
  if (!alt) { toast('No similar exercise available'); return; }
  if (e.sets.some(st => st.done) && !confirm('Sets already ticked for this exercise will be cleared. Swap anyway?')) return;
  const reps = e.sets[0]?.r ?? e.sets[0]?.sec ?? null;
  a.entries[ei] = { exId: alt.id, sets: e.sets.map(() => blankSet(alt, { reps })) };
  S.save();
  closeSheet();
  render();
  toast(`Swapped for ${alt.name}`);
}

function routineSummary(r) {
  const groups = [...new Set(r.items.map(i => S.exById(i.exId).group))];
  return groups.slice(0, 3).join(' · ') || 'Empty';
}

function activeWorkoutHTML(a) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(a.start)) / 60000));
  const vol = S.fromKg(S.sessionVolume(a), unit());

  return `
    <div class="card tight spread" style="position:sticky;top:0;z-index:5">
      <div>
        <div style="font-weight:700">${esc(a.name || 'Workout')}</div>
        <div class="small dim tnum" id="workoutClock">${mins} min · ${S.sessionSets(a)} sets · ${S.fmtNum(vol, 0)} ${unit()}</div>
      </div>
      <button class="btn btn-primary btn-sm" data-act="finish">Finish</button>
    </div>

    ${a.entries.length ? a.entries.map((e, ei) => exerciseCardHTML(e, ei)).join('') : `
      <div class="empty-state"><strong>Nothing added yet</strong>Add your first exercise to get going.</div>`}

    <button class="btn btn-ghost" data-act="add-exercise">+ Add exercise</button>
    <div style="height:10px"></div>
    <button class="btn btn-danger" data-act="cancel-workout">Discard workout</button>
  `;
}

/* Column layout depends on how the exercise is measured. */
function colsFor(ex) {
  switch (ex.type) {
    case 'time': return [{ key: 'sec', label: 'Seconds', step: 5 }];
    case 'cardio': return [{ key: 'min', label: 'Minutes', step: 1 }, { key: 'km', label: 'Distance', step: 0.5 }];
    case 'bw': return [{ key: 'w', label: '+ ' + unit(), step: unit() === 'kg' ? 1.25 : 2.5 }, { key: 'r', label: 'Reps', step: 1 }];
    default: return [{ key: 'w', label: unit(), step: unit() === 'kg' ? 2.5 : 5 }, { key: 'r', label: 'Reps', step: 1 }];
  }
}

function prevText(ex, idx) {
  const last = S.lastPerformance(ex.id);
  if (!last || !last.sets[idx]) return '—';
  const st = last.sets[idx];
  if (ex.type === 'time') return (st.sec || 0) + 's';
  if (ex.type === 'cardio') return (st.min || 0) + 'm';
  if (ex.type === 'bw') return (st.w ? '+' + displayWeight(st.w, st.u) + '×' : '') + (st.r || 0);
  return displayWeight(st.w, st.u) + '×' + (st.r || 0);
}

function exerciseCardHTML(entry, ei) {
  const ex = S.exById(entry.exId);
  const cols = colsFor(ex);
  const grid = `grid-template-columns:26px 1fr ${cols.map(() => '1fr').join(' ')} 40px`;

  return `<div class="ex-card" data-ei="${ei}">
    <header>
      ${thumbHTML(ex)}
      <div class="grow" data-act="ex-detail" data-id="${ex.id}">
        <div class="name truncate">${esc(ex.name)}</div>
        <div class="sub">${esc(ex.target)}</div>
      </div>
      <button class="icon-btn" data-act="entry-menu" data-ei="${ei}">⋯</button>
    </header>

    <div class="set-head" style="${grid}">
      <span>#</span><span style="text-align:center">Prev</span>
      ${cols.map(c => `<span style="text-align:center">${esc(c.label)}</span>`).join('')}
      <span></span>
    </div>

    ${entry.sets.map((st, si) => `
      <div class="set-row ${st.done ? 'done' : ''}" style="${grid}" data-ei="${ei}" data-si="${si}">
        <div class="idx">${si + 1}</div>
        <div class="prev">${esc(prevText(ex, si))}</div>
        ${cols.map(c => `<input type="number" inputmode="decimal" data-field="${c.key}"
            value="${st[c.key] ?? ''}" placeholder="${esc(String(prevValue(ex, si, c.key) ?? ''))}">`).join('')}
        <button class="tick" data-act="tick">✓</button>
      </div>`).join('')}

    <footer>
      <button data-act="add-set" data-ei="${ei}">+ Set</button>
      <button data-act="del-set" data-ei="${ei}">− Set</button>
    </footer>
  </div>`;
}

function prevValue(ex, idx, key) {
  const last = S.lastPerformance(ex.id);
  const st = last && last.sets[idx];
  if (!st) return '';
  if (key === 'w') return displayWeight(st.w, st.u);
  return st[key] ?? '';
}

/* ── workout actions ───────────────────────────────────────────────── */

function newSession(name, routineId, items) {
  return {
    id: S.uid(),
    date: S.todayISO(),
    start: new Date().toISOString(),
    end: null,
    name: name || 'Workout',
    routineId: routineId || null,
    entries: (items || []).map(i => ({
      exId: i.exId,
      sets: Array.from({ length: i.sets || 3 }, () => blankSet(S.exById(i.exId), i)),
    })),
    note: '',
  };
}

function blankSet(ex, target) {
  const st = { done: false, u: unit() };
  if (ex.type === 'time') st.sec = target?.reps || null;
  else if (ex.type === 'cardio') { st.min = null; st.km = null; }
  else { st.w = null; st.r = target?.reps || null; }
  return st;
}

function startWorkout(session) {
  if (S.state.active) { toast('Finish the current workout first'); return; }
  S.state.active = session;
  S.save();
  go('train');
}

function finishWorkout() {
  const a = S.state.active;
  if (!a) return;
  // Drop untouched sets and empty exercises so history stays honest.
  a.entries = a.entries
    .map(e => ({ ...e, sets: e.sets.filter(st => st.done) }))
    .filter(e => e.sets.length);

  if (!a.entries.length) {
    S.state.active = null;
    S.save();
    toast('Nothing logged — workout discarded');
    render();
    return;
  }

  a.end = new Date().toISOString();
  S.state.sessions.push(a);
  const prs = S.prsInSession(a);
  S.state.active = null;
  S.saveNow();
  render();
  showSummary(a, prs);
}

function showSummary(sess, prs) {
  const vol = S.fromKg(S.sessionVolume(sess), unit());
  openSheet('Workout complete', `
    <div class="tiles">
      <div class="tile"><div class="v">${S.sessionMinutes(sess)}<small>min</small></div><div class="k">Duration</div></div>
      <div class="tile"><div class="v">${S.sessionSets(sess)}</div><div class="k">Sets</div></div>
      <div class="tile"><div class="v">${S.fmtNum(vol, 0)}<small>${unit()}</small></div><div class="k">Volume lifted</div></div>
      <div class="tile"><div class="v">${S.sessionReps(sess)}</div><div class="k">Total reps</div></div>
    </div>

    ${prs.length ? `
      <h3 style="margin-top:14px">Personal records</h3>
      <div class="card flush">
        ${prs.map(p => {
          const ex = S.exById(p.exId);
          const label = p.kind === 'first' ? 'First time logged'
            : p.kind === 'weight' ? 'Heaviest weight yet'
            : `Best estimated 1RM — ${S.fmtNum(S.fromKg(p.e1rm, unit()), 0)} ${unit()}`;
          return `<div class="list-item"><div class="grow">
            <div style="font-weight:650" class="truncate">${esc(ex.name)}</div>
            <div class="meta">${esc(label)}</div>
          </div><span class="pr-badge">★ PR</span></div>`;
        }).join('')}
      </div>` : `<div class="banner">No new records this time — consistency still counts.</div>`}
  `, { action: `<button class="btn btn-primary" data-act="close-sheet">Done</button>` });
}

/* ── ROUTINES ──────────────────────────────────────────────────────── */

function renderRoutines() {
  const root = $('#view-routines');
  const rs = S.state.routines;
  root.innerHTML = `
    <h2>Routines</h2>
    <button class="btn btn-primary" data-act="new-routine">+ New routine</button>
    <div style="height:12px"></div>
    ${rs.length ? `<div class="card flush">${rs.map(r => `
      <button class="list-item" data-act="edit-routine" data-id="${r.id}">
        <div class="grow">
          <div class="truncate" style="font-weight:650">${esc(r.name)}</div>
          <div class="meta">${r.items.length} exercise${r.items.length === 1 ? '' : 's'} · ${esc(routineSummary(r))}</div>
        </div>
        <span class="chev">›</span>
      </button>`).join('')}</div>`
      : `<div class="empty-state"><strong>No routines yet</strong>
         A routine is a saved list of exercises with target sets and reps — build it once, start it every week.</div>`}
  `;
}

function editRoutine(id) {
  const r = id ? S.state.routines.find(x => x.id === id) : null;
  ui.editingRoutine = r ? JSON.parse(JSON.stringify(r)) : { id: S.uid(), name: '', note: '', items: [], created: new Date().toISOString() };
  renderRoutineEditor();
}

function renderRoutineEditor() {
  const r = ui.editingRoutine;
  const isNew = !S.state.routines.some(x => x.id === r.id);

  openSheet(isNew ? 'New routine' : 'Edit routine', `
    <label class="field"><span>Routine name</span>
      <input type="text" id="routineName" value="${esc(r.name)}" placeholder="e.g. Push Day A" autocomplete="off"></label>

    <div class="eyebrow" style="margin:4px 2px 8px">Exercises</div>
    ${r.items.length ? `<div class="card flush" style="margin-bottom:10px">${r.items.map((it, i) => {
      const ex = S.exById(it.exId);
      const repLabel = ex.type === 'time' ? 'sec' : 'reps';
      return `<div class="list-item">
        <div class="grow">
          <div class="truncate" style="font-weight:650">${esc(ex.name)}</div>
          <div class="meta">${esc(ex.target)}</div>
          <div class="row" style="margin-top:7px">
            <input type="number" inputmode="numeric" data-ritem="${i}" data-field="sets" value="${it.sets}"
              style="width:62px;padding:7px" aria-label="Sets">
            <span class="small dim">sets ×</span>
            <input type="number" inputmode="numeric" data-ritem="${i}" data-field="reps" value="${it.reps ?? ''}"
              style="width:62px;padding:7px" aria-label="${repLabel}">
            <span class="small dim">${repLabel}</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <button class="drag-handle" data-act="ritem-up" data-i="${i}">▲</button>
          <button class="drag-handle" data-act="ritem-down" data-i="${i}">▼</button>
        </div>
        <button class="icon-btn" data-act="ritem-del" data-i="${i}">✕</button>
      </div>`;
    }).join('')}</div>` : `<div class="banner">Pick exercises from the library to build this routine.</div>`}

    <button class="btn btn-ghost" data-act="pick-for-routine">+ Add exercises</button>
    <div style="height:12px"></div>
    ${!isNew ? `<button class="btn btn-danger" data-act="delete-routine" data-id="${r.id}">Delete routine</button>` : ''}
  `, { action: `<button class="btn btn-primary" data-act="save-routine">Save routine</button>` });
}

function saveRoutine() {
  const r = ui.editingRoutine;
  r.name = ($('#routineName')?.value || '').trim() || 'Untitled routine';
  if (!r.items.length) { toast('Add at least one exercise'); return; }
  const i = S.state.routines.findIndex(x => x.id === r.id);
  if (i >= 0) S.state.routines[i] = r; else S.state.routines.push(r);
  S.saveNow();
  ui.editingRoutine = null;
  closeSheet();
  go('routines');
  toast('Routine saved');
}

/* ── LIBRARY ───────────────────────────────────────────────────────── */

function filteredExercises() {
  const q = ui.libQuery.trim().toLowerCase();
  return S.allExercises().filter(ex => {
    if (ui.libEq !== 'all' && ex.eq !== ui.libEq) return false;
    if (ui.libGroup !== 'all' && ex.group !== ui.libGroup) return false;
    if (q && !(ex.name.toLowerCase().includes(q) || ex.target.toLowerCase().includes(q))) return false;
    return true;
  });
}

function renderLibrary() {
  const root = $('#view-library');
  const list = filteredExercises();

  root.innerHTML = `
    <h2>Exercise library</h2>
    <input type="search" id="libSearch" placeholder="Search 200+ exercises" value="${esc(ui.libQuery)}" autocomplete="off">
    <div class="chip-row" id="eqChips">
      <button class="chip ${ui.libEq === 'all' ? 'on' : ''}" data-eq="all">All kit</button>
      ${EQUIPMENT.map(e => `<button class="chip ${ui.libEq === e.id ? 'on' : ''}" data-eq="${e.id}">${esc(e.label)}</button>`).join('')}
    </div>
    <div class="chip-row" id="groupChips" style="margin-top:-4px">
      <button class="chip ${ui.libGroup === 'all' ? 'on' : ''}" data-group="all">All muscles</button>
      ${GROUPS.map(g => `<button class="chip ${ui.libGroup === g ? 'on' : ''}" data-group="${g}">${esc(g)}</button>`).join('')}
    </div>

    <div class="small dim" style="margin:2px 2px 8px">${list.length} exercise${list.length === 1 ? '' : 's'}</div>
    ${list.length ? `<div class="card flush">${list.map(ex => exRowHTML(ex)).join('')}</div>`
      : `<div class="empty-state"><strong>Nothing matches</strong>Try a different filter or search term.</div>`}
    <div style="height:8px"></div>
    <button class="btn btn-ghost" data-act="new-custom">+ Create custom exercise</button>
  `;
  hydrateThumbs(root);
}

const exRowHTML = (ex) => `
  <button class="list-item" data-act="ex-detail" data-id="${ex.id}">
    ${thumbHTML(ex)}
    <div class="grow">
      <div class="truncate" style="font-weight:650">${esc(ex.name)}</div>
      <div class="meta truncate">${esc(eqLabel(ex.eq))} · ${esc(ex.target)}</div>
    </div>
    <span class="chev">›</span>
  </button>`;

const eqLabel = (id) => (EQUIPMENT.find(e => e.id === id) || { label: 'Other' }).label;

function showExerciseDetail(exId) {
  const ex = S.exById(exId);
  const pr = S.prFor(exId);
  const hist = S.historyFor(exId).slice(-6).reverse();
  const series = S.progressSeries(exId);
  const u = unit();

  const chart = series.length > 1 ? lineChart({
    title: 'Progress',
    sub: 'Estimated 1RM and heaviest set per session',
    unit: ' ' + u,
    zeroBase: false,
    series: [
      { name: 'Est. 1RM', color: 'var(--viz-1)', points: series.map(p => ({ x: p.date, y: S.fromKg(p.e1rm, u) })) },
      { name: 'Top set', color: 'var(--viz-2)', points: series.map(p => ({ x: p.date, y: S.fromKg(p.top, u) })) },
    ],
  }) : '';

  openSheet(ex.name, `
    <div class="anim-stage"><svg class="fig" id="animStage" viewBox="0 0 200 200"></svg></div>
    <div class="row wrap" style="justify-content:center;gap:6px;margin-bottom:12px">
      <span class="chip">${esc(eqLabel(ex.eq))}</span>
      <span class="chip">${esc(ex.group)}</span>
      ${ex.uni ? `<span class="chip">Per side</span>` : ''}
    </div>

    <div class="card">
      <h3>How to do it</h3>
      <div class="small" style="color:var(--text-2)">${esc(ex.tips || '')}</div>
      <div class="divider"></div>
      <div class="small dim">Works: ${esc(ex.target)} · Suggested rest ${ex.rest}s</div>
    </div>

    ${pr.set ? `
      <div class="tiles">
        <div class="tile"><div class="v">${S.fmtNum(S.fromKg(pr.e1rm, u), 0)}<small>${u}</small></div><div class="k">Best est. 1RM</div></div>
        <div class="tile"><div class="v">${S.fmtNum(S.fromKg(pr.weight, u), 0)}<small>${u}</small></div><div class="k">Heaviest set</div></div>
      </div>` : ''}

    ${chart}

    ${hist.length ? `
      <h3 style="margin-top:14px">Recent sessions</h3>
      <div class="card">
        ${hist.map(d => `<div class="hist-line">
          <span class="n">${esc(fmtDate(d.date))}</span>
          <span class="s">${d.sets.map(st => setLabel(ex, st)).join(', ')}</span>
        </div>`).join('')}
      </div>` : `<div class="banner">You haven't logged this one yet.</div>`}

    ${ex.custom ? `<button class="btn btn-danger" data-act="delete-custom" data-id="${ex.id}">Delete custom exercise</button><div style="height:10px"></div>` : ''}
  `, {
    action: S.state.active
      ? `<button class="btn btn-primary" data-act="add-to-workout" data-id="${ex.id}">Add to workout</button>`
      : `<button class="btn btn-primary" data-act="start-with" data-id="${ex.id}">Start workout with this</button>`,
    onOpen: () => {
      const svg = $('#animStage');
      if (svg) stopAnim = animate(svg, ex);
    },
  });
}

function setLabel(ex, st) {
  if (ex.type === 'time') return (st.sec || 0) + 's';
  if (ex.type === 'cardio') return (st.min || 0) + 'min' + (st.km ? ` / ${st.km}km` : '');
  if (ex.type === 'bw' && !st.w) return (st.r || 0) + ' reps';
  return `${displayWeight(st.w, st.u)}×${st.r || 0}`;
}

/* ── exercise picker ───────────────────────────────────────────────── */

function openPicker(target) {
  ui.pickTarget = target;
  ui.picked = new Set();
  ui.libQuery = '';
  renderPicker();
}

function renderPicker() {
  const list = filteredExercises();
  openSheet('Add exercises', `
    <input type="search" id="pickSearch" placeholder="Search exercises" value="${esc(ui.libQuery)}" autocomplete="off">
    <div class="chip-row">
      <button class="chip ${ui.libEq === 'all' ? 'on' : ''}" data-eq="all" data-pick="1">All kit</button>
      ${EQUIPMENT.map(e => `<button class="chip ${ui.libEq === e.id ? 'on' : ''}" data-eq="${e.id}" data-pick="1">${esc(e.label)}</button>`).join('')}
    </div>
    <div class="card flush" id="pickList">
      ${list.slice(0, 80).map(ex => `
        <button class="list-item" data-act="toggle-pick" data-id="${ex.id}">
          <div class="grow">
            <div class="truncate" style="font-weight:650">${esc(ex.name)}</div>
            <div class="meta truncate">${esc(eqLabel(ex.eq))} · ${esc(ex.target)}</div>
          </div>
          <span class="tick-mark" style="font-size:19px;color:${ui.picked.has(ex.id) ? 'var(--good)' : 'var(--line)'}">${ui.picked.has(ex.id) ? '✓' : '+'}</span>
        </button>`).join('')}
      ${list.length > 80 ? `<div class="small dim" style="padding:12px;text-align:center">Showing the first 80 — refine your search to see more.</div>` : ''}
    </div>
  `, { action: `<button class="btn btn-primary" data-act="confirm-pick">Add ${ui.picked.size || ''} selected</button>` });
}

function confirmPick() {
  const ids = [...ui.picked];
  if (!ids.length) { toast('Nothing selected'); return; }

  if (ui.pickTarget === 'routine') {
    for (const id of ids) {
      const ex = S.exById(id);
      ui.editingRoutine.items.push({ exId: id, sets: 3, reps: ex.type === 'time' ? 30 : 8, rest: ex.rest });
    }
    renderRoutineEditor();
  } else {
    const a = S.state.active;
    for (const id of ids) {
      const ex = S.exById(id);
      a.entries.push({ exId: id, sets: Array.from({ length: 3 }, () => blankSet(ex)) });
    }
    S.save();
    closeSheet();
    render();
  }
  toast(`Added ${ids.length} exercise${ids.length === 1 ? '' : 's'}`);
}

/* ── HISTORY ───────────────────────────────────────────────────────── */

function renderHistory() {
  const root = $('#view-history');
  const sessions = S.sessionsSorted();

  root.innerHTML = `
    <h2>History</h2>
    ${sessions.length ? sessions.map(s => {
      const vol = S.fromKg(S.sessionVolume(s), unit());
      return `<button class="card" style="display:block;width:100%;text-align:left" data-act="open-session" data-id="${s.id}">
        <div class="spread" style="margin-bottom:8px">
          <span style="font-weight:700">${esc(s.name || 'Workout')}</span>
          <span class="small dim">${esc(fmtDate(s.date))}</span>
        </div>
        <div class="small dim tnum" style="margin-bottom:8px">
          ${S.sessionSets(s)} sets · ${S.fmtNum(vol, 0)} ${unit()} · ${S.sessionMinutes(s)} min</div>
        ${s.entries.slice(0, 4).map(e => `<div class="hist-line">
          <span class="n truncate">${esc(S.exById(e.exId).name)}</span>
          <span class="s">${e.sets.map(st => setLabel(S.exById(e.exId), st)).join(', ')}</span>
        </div>`).join('')}
        ${s.entries.length > 4 ? `<div class="small dim" style="margin-top:5px">+ ${s.entries.length - 4} more</div>` : ''}
      </button>`;
    }).join('') : `<div class="empty-state"><strong>No workouts yet</strong>Your completed sessions will appear here.</div>`}
  `;
}

function showSession(id) {
  const s = S.state.sessions.find(x => x.id === id);
  if (!s) return;
  const vol = S.fromKg(S.sessionVolume(s), unit());

  openSheet(s.name || 'Workout', `
    <div class="small dim" style="margin-bottom:12px">${esc(fmtDate(s.date))} · ${S.sessionMinutes(s)} minutes</div>
    <div class="tiles">
      <div class="tile"><div class="v">${S.sessionSets(s)}</div><div class="k">Sets</div></div>
      <div class="tile"><div class="v">${S.fmtNum(vol, 0)}<small>${unit()}</small></div><div class="k">Volume</div></div>
    </div>
    ${s.entries.map(e => {
      const ex = S.exById(e.exId);
      return `<div class="card tight" style="margin-bottom:8px">
        <div style="font-weight:650;margin-bottom:4px">${esc(ex.name)}</div>
        <div class="small dim">${e.sets.map((st, i) => `${i + 1}. ${setLabel(ex, st)}`).join('  ·  ')}</div>
      </div>`;
    }).join('')}
    <div style="height:6px"></div>
    <button class="btn btn-ghost" data-act="repeat-session" data-id="${s.id}">Repeat this workout</button>
    <div style="height:10px"></div>
    <button class="btn btn-danger" data-act="delete-session" data-id="${s.id}">Delete workout</button>
  `);
}

/* ── STATS ─────────────────────────────────────────────────────────── */

function renderStats() {
  const root = $('#view-stats');
  const t = S.totals();
  const u = unit();
  const tracked = S.trackedExercises();

  if (!ui.statsExercise || !tracked.some(x => x.exId === ui.statsExercise)) {
    ui.statsExercise = tracked.length ? tracked[0].exId : null;
  }

  const weekly = S.weeklyVolume(12).map(w => ({
    label: 'Week of ' + fmtShortDate(w.key),
    tick: fmtShortDate(w.key),
    value: S.fromKg(w.value, u),
  }));

  const groups = S.groupBreakdown(S.daysAgoISO(30));
  const body = S.bodySorted();
  const bmiVal = S.bmi();

  const progress = ui.statsExercise ? S.progressSeries(ui.statsExercise) : [];

  root.innerHTML = `
    <h2>Progress</h2>

    <div class="tiles">
      <div class="tile"><div class="v">${t.workouts}</div><div class="k">Workouts logged</div></div>
      <div class="tile"><div class="v">${S.weekStreak()}<small>wk</small></div><div class="k">Week streak</div></div>
      <div class="tile"><div class="v">${S.fmtNum(S.fromKg(t.volume, u) / 1000, 1)}<small>k ${u}</small></div><div class="k">Total volume</div></div>
      <div class="tile"><div class="v">${t.sets}</div><div class="k">Total sets</div></div>
    </div>

    ${barChart({
      title: 'Weekly volume',
      sub: `Total weight moved per week, last 12 weeks (${u})`,
      data: weekly, unit: ' ' + u,
    })}

    ${hBarChart({
      title: 'Sets per muscle group',
      sub: 'Last 30 days',
      data: groups, unit: ' sets',
    })}

    <h2>Exercise progression</h2>
    ${tracked.length ? `
      <select id="statsExPicker" style="margin-bottom:10px">
        ${tracked.map(x => `<option value="${x.exId}" ${x.exId === ui.statsExercise ? 'selected' : ''}>${esc(S.exById(x.exId).name)}</option>`).join('')}
      </select>
      ${lineChart({
        title: S.exById(ui.statsExercise).name,
        sub: 'Estimated 1RM vs heaviest set',
        unit: ' ' + u,
        zeroBase: false,
        series: [
          { name: 'Est. 1RM', color: 'var(--viz-1)', points: progress.map(p => ({ x: p.date, y: S.fromKg(p.e1rm, u) })) },
          { name: 'Top set', color: 'var(--viz-2)', points: progress.map(p => ({ x: p.date, y: S.fromKg(p.top, u) })) },
        ],
      })}`
      : `<div class="banner">Log a few sessions and your strength curves show up here.</div>`}

    <h2>Body</h2>
    <div class="tiles">
      <div class="tile"><div class="v">${body.length ? esc(displayWeight(body[body.length - 1].w, body[body.length - 1].u)) : '—'}<small>${u}</small></div><div class="k">Current weight</div></div>
      <div class="tile"><div class="v">${bmiVal ? S.fmtNum(bmiVal, 1) : '—'}</div><div class="k">BMI</div></div>
    </div>
    ${lineChart({
      title: 'Bodyweight',
      sub: body.length ? `${body.length} measurement${body.length === 1 ? '' : 's'}` : '',
      unit: ' ' + u,
      zeroBase: false,
      series: [{ name: 'Bodyweight', color: 'var(--viz-3)', points: body.map(b => ({ x: b.date, y: S.fromKg(S.toKg(b.w, b.u), u) })) }],
    })}
    <button class="btn btn-ghost" data-act="log-body">Log today's weight</button>
  `;
}

/* ── profile & settings ────────────────────────────────────────────── */

function showProfile() {
  const p = S.state.profile, st = S.state.settings;
  const body = S.latestBody();

  openSheet('You & settings', `
    <label class="field"><span>Name</span>
      <input type="text" id="pfName" value="${esc(p.name)}" placeholder="Optional" autocomplete="off"></label>

    <div class="row" style="align-items:flex-start">
      <label class="field grow"><span>Height (cm)</span>
        <input type="number" inputmode="numeric" id="pfHeight" value="${p.heightCm ?? ''}" placeholder="175"></label>
      <label class="field grow"><span>Year of birth</span>
        <input type="number" inputmode="numeric" id="pfBirth" value="${p.birthYear ?? ''}" placeholder="1990"></label>
    </div>

    <label class="field"><span>Weight unit</span></label>
    <div class="seg" id="unitSeg" style="margin:-6px 0 14px">
      <button data-unit="kg" class="${st.unit === 'kg' ? 'on' : ''}">Kilograms</button>
      <button data-unit="lb" class="${st.unit === 'lb' ? 'on' : ''}">Pounds</button>
    </div>

    <label class="field"><span>Default rest between sets</span>
      <input type="number" inputmode="numeric" id="pfRest" value="${st.defaultRest}"></label>

    <div class="seg" id="soundSeg" style="margin-bottom:16px">
      <button data-sound="1" class="${st.sound ? 'on' : ''}">Timer sound on</button>
      <button data-sound="0" class="${!st.sound ? 'on' : ''}">Silent</button>
    </div>

    <h3>Bodyweight log</h3>
    <div class="card">
      <div class="row">
        <label class="field grow" style="margin:0"><span>Weight (${st.unit})</span>
          <input type="number" inputmode="decimal" id="bwWeight" value="${body ? esc(displayWeight(body.w, body.u)) : ''}" placeholder="e.g. 78"></label>
        <label class="field grow" style="margin:0"><span>Body fat %</span>
          <input type="number" inputmode="decimal" id="bwFat" value="${body?.bodyFat ?? ''}" placeholder="Optional"></label>
      </div>
      <div style="height:10px"></div>
      <button class="btn btn-ghost btn-sm" style="width:100%" data-act="save-body">Save for today</button>
    </div>

    <h3 style="margin-top:16px">Your data</h3>
    <div class="banner">Everything is stored on this phone only. Export a backup before clearing Safari's website data,
      or to move to a new phone.</div>
    <button class="btn btn-ghost" data-act="export">Export backup</button>
    <div style="height:8px"></div>
    <button class="btn btn-ghost" data-act="import">Import backup</button>
    <div style="height:8px"></div>
    <button class="btn btn-danger" data-act="wipe">Erase all data</button>
    <div style="height:14px"></div>
    <div class="small dim" style="text-align:center">Train App · ${S.state.sessions.length} workouts · ${S.allExercises().length} exercises</div>
  `, { action: `<button class="btn btn-primary" data-act="save-profile">Save</button>` });
}

function saveProfile() {
  const p = S.state.profile, st = S.state.settings;
  p.name = ($('#pfName')?.value || '').trim();
  p.heightCm = numOrNull($('#pfHeight')?.value);
  p.birthYear = numOrNull($('#pfBirth')?.value);
  const rest = numOrNull($('#pfRest')?.value);
  if (rest) st.defaultRest = Math.max(10, Math.min(600, rest));
  S.saveNow();
  closeSheet();
  render();
  toast('Saved');
}

const numOrNull = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};

function saveBodyWeight() {
  const w = numOrNull($('#bwWeight')?.value);
  if (!w) { toast('Enter a weight first'); return; }
  S.logBody({
    date: S.todayISO(), w, u: unit(),
    bodyFat: numOrNull($('#bwFat')?.value), note: '',
  });
  toast('Bodyweight logged');
  render();
}

/* ── rest timer ────────────────────────────────────────────────────── */

const RING_R = 100;
const CIRC = 2 * Math.PI * RING_R;
let timer = { total: 0, left: 0, handle: null };

function startRest(seconds, nextLabel) {
  if (!S.state.settings.autoRest) return;
  timer.total = seconds;
  timer.left = seconds;
  $('#restNext').textContent = nextLabel || '';
  $('#restOverlay').classList.add('show');
  drawRing();
  clearInterval(timer.handle);
  timer.handle = setInterval(() => {
    timer.left -= 1;
    drawRing();
    if (timer.left <= 0) endRest(true);
  }, 1000);
}

function drawRing() {
  const frac = timer.total ? Math.max(0, timer.left / timer.total) : 0;
  const ring = $('#restRing');
  ring.setAttribute('stroke-dasharray', CIRC.toFixed(1));
  ring.setAttribute('stroke-dashoffset', (CIRC * (1 - frac)).toFixed(1));
  const s = Math.max(0, Math.ceil(timer.left));
  $('#restNum').textContent = s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : s;
}

function endRest(withSound) {
  clearInterval(timer.handle);
  timer.handle = null;
  if (withSound && S.state.settings.sound) beep();
  if (withSound) haptic();
  setTimeout(() => $('#restOverlay').classList.remove('show'), withSound ? 350 : 0);
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.19, 0.38].forEach((t) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.17);
    });
  } catch { /* audio is a nicety, never a failure */ }
}

/* ── import / export ───────────────────────────────────────────────── */

function exportBackup() {
  const blob = new Blob([S.exportJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `train-app-backup-${S.todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Backup downloaded');
}

function importBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        S.importJSON(reader.result);
        closeSheet();
        go('train');
        toast('Backup restored');
      } catch (e) {
        toast(e.message || 'Could not read that file');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

/* ── event wiring ──────────────────────────────────────────────────── */

const ACTIONS = {
  'quick-start': () => startWorkout(newSession('Workout', null, [])),

  'start-routine': (el) => {
    const r = S.state.routines.find(x => x.id === el.dataset.id);
    if (r) startWorkout(newSession(r.name, r.id, r.items));
  },

  'repeat-last': () => {
    const last = S.sessionsSorted()[0];
    if (last) repeatSession(last);
  },

  'repeat-session': (el) => {
    const s = S.state.sessions.find(x => x.id === el.dataset.id);
    if (s) { closeSheet(); repeatSession(s); }
  },

  'start-with': (el) => {
    closeSheet();
    startWorkout(newSession('Workout', null, [{ exId: el.dataset.id, sets: 3 }]));
  },

  'generate': runGenerator,
  'gen-again': () => {
    const typed = genName();
    const w = G.generate(genPrefs());
    if (typed !== G.titleFor(genPrefs().groups)) w.name = typed;   // keep a name you typed
    ui.generated = w;
    showGenerated();
  },
  'gen-del': (el) => {
    genName();
    ui.generated.items.splice(+el.dataset.i, 1);
    showGenerated();
  },
  'gen-swap': (el) => {
    genName();
    const w = ui.generated, i = +el.dataset.i;
    const alt = G.swapFor(w.items[i].exId, genPrefs(), w.items.map(it => it.exId));
    if (!alt) { toast('No other exercise fits — tick more boxes'); return; }
    w.items[i] = { exId: alt.id, ...G.prescribe(alt, genPrefs().goal) };
    showGenerated();
  },
  'gen-add': () => {
    genName();
    const w = ui.generated;
    const ex = G.extraFor(genPrefs(), w.items.map(it => it.exId));
    if (!ex) { toast('Every matching exercise is already in'); return; }
    w.items.push({ exId: ex.id, ...G.prescribe(ex, genPrefs().goal) });
    showGenerated();
    $('#sheetBody').scrollTop = $('#sheetBody').scrollHeight;
  },
  'gen-start': () => {
    const w = ui.generated;
    if (!w || !w.items.length) return;
    const name = genName();
    closeSheet();
    startWorkout(newSession(name, null, w.items));
  },
  'gen-save': () => {
    const w = ui.generated;
    if (!w || !w.items.length) return;
    S.state.routines.push({
      id: S.uid(), name: genName(), note: w.notes || '',
      items: w.items.map(it => ({ ...it })), created: new Date().toISOString(),
    });
    S.saveNow();
    closeSheet();
    toast('Saved to Routines');
  },

  'add-exercise': () => openPicker('workout'),
  'pick-for-routine': () => openPicker('routine'),
  'confirm-pick': confirmPick,

  'toggle-pick': (el) => {
    const id = el.dataset.id;
    if (ui.picked.has(id)) ui.picked.delete(id); else ui.picked.add(id);
    const mark = el.querySelector('.tick-mark');
    mark.textContent = ui.picked.has(id) ? '✓' : '+';
    mark.style.color = ui.picked.has(id) ? 'var(--good)' : 'var(--line)';
    $('#sheetAction button').textContent = `Add ${ui.picked.size || ''} selected`;
  },

  'add-set': (el) => {
    const e = S.state.active.entries[+el.dataset.ei];
    const ex = S.exById(e.exId);
    const prev = e.sets[e.sets.length - 1];
    e.sets.push(prev ? { ...prev, done: false } : blankSet(ex));
    S.save();
    render();
  },

  'del-set': (el) => {
    const e = S.state.active.entries[+el.dataset.ei];
    if (e.sets.length > 1) e.sets.pop();
    S.save();
    render();
  },

  'entry-menu': (el) => {
    const ei = +el.dataset.ei;
    const e = S.state.active.entries[ei];
    const ex = S.exById(e.exId);
    openSheet(ex.name, `
      <button class="btn btn-ghost" data-act="ex-detail" data-id="${ex.id}">View animation &amp; history</button>
      <div style="height:10px"></div>
      <button class="btn btn-ghost" data-act="swap-entry" data-ei="${ei}">⇄ Swap for a similar exercise</button>
      <div style="height:10px"></div>
      <button class="btn btn-ghost" data-act="move-entry" data-ei="${ei}" data-dir="-1">Move up</button>
      <div style="height:10px"></div>
      <button class="btn btn-ghost" data-act="move-entry" data-ei="${ei}" data-dir="1">Move down</button>
      <div style="height:10px"></div>
      <button class="btn btn-danger" data-act="remove-entry" data-ei="${ei}">Remove from workout</button>
    `);
  },

  'swap-entry': (el) => swapActiveEntry(+el.dataset.ei),

  'move-entry': (el) => {
    const ei = +el.dataset.ei, dir = +el.dataset.dir;
    const arr = S.state.active.entries;
    const j = ei + dir;
    if (j < 0 || j >= arr.length) { toast('Already at the end'); return; }
    [arr[ei], arr[j]] = [arr[j], arr[ei]];
    S.save();
    closeSheet();
    render();
  },

  'remove-entry': (el) => {
    S.state.active.entries.splice(+el.dataset.ei, 1);
    S.save();
    closeSheet();
    render();
  },

  'finish': finishWorkout,

  'cancel-workout': () => {
    if (!confirm('Discard this workout? Nothing will be saved.')) return;
    S.state.active = null;
    S.saveNow();
    render();
  },

  'ex-detail': (el) => showExerciseDetail(el.dataset.id),
  'open-session': (el) => showSession(el.dataset.id),

  'delete-session': (el) => {
    if (!confirm('Delete this workout permanently?')) return;
    S.state.sessions = S.state.sessions.filter(s => s.id !== el.dataset.id);
    S.saveNow();
    closeSheet();
    render();
    toast('Workout deleted');
  },

  'add-to-workout': (el) => {
    const ex = S.exById(el.dataset.id);
    S.state.active.entries.push({ exId: ex.id, sets: Array.from({ length: 3 }, () => blankSet(ex)) });
    S.save();
    closeSheet();
    go('train');
    toast('Added to workout');
  },

  'new-routine': () => editRoutine(null),
  'edit-routine': (el) => editRoutine(el.dataset.id),
  'save-routine': saveRoutine,

  'delete-routine': (el) => {
    if (!confirm('Delete this routine?')) return;
    S.state.routines = S.state.routines.filter(r => r.id !== el.dataset.id);
    S.saveNow();
    closeSheet();
    go('routines');
  },

  'ritem-up': (el) => moveRoutineItem(+el.dataset.i, -1),
  'ritem-down': (el) => moveRoutineItem(+el.dataset.i, 1),
  'ritem-del': (el) => {
    ui.editingRoutine.items.splice(+el.dataset.i, 1);
    renderRoutineEditor();
  },

  'new-custom': showCustomEditor,
  'save-custom': saveCustom,
  'delete-custom': (el) => {
    if (!confirm('Delete this custom exercise? Past sessions keep their history.')) return;
    S.state.custom = S.state.custom.filter(c => c.id !== el.dataset.id);
    S.saveNow();
    closeSheet();
    render();
  },

  'log-body': showProfile,
  'save-body': saveBodyWeight,
  'save-profile': saveProfile,
  'export': exportBackup,
  'import': importBackup,

  'wipe': () => {
    if (!confirm('Erase every workout, routine and measurement on this phone? This cannot be undone.')) return;
    if (!confirm('Really erase everything?')) return;
    localStorage.removeItem('ironlog_v2');
    localStorage.removeItem('ironlog_data');
    location.reload();
  },

  'close-sheet': closeSheet,
};

function moveRoutineItem(i, dir) {
  const arr = ui.editingRoutine.items;
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  renderRoutineEditor();
}

function repeatSession(s) {
  startWorkout(newSession(s.name, s.routineId,
    s.entries.map(e => ({ exId: e.exId, sets: e.sets.length, reps: e.sets[0]?.r }))));
}

function showCustomEditor() {
  openSheet('Custom exercise', `
    <label class="field"><span>Name</span><input type="text" id="cxName" placeholder="e.g. Trap Bar Deadlift" autocomplete="off"></label>
    <label class="field"><span>Equipment</span>
      <select id="cxEq">${EQUIPMENT.map(e => `<option value="${e.id}">${esc(e.label)}</option>`).join('')}</select></label>
    <label class="field"><span>Muscle group</span>
      <select id="cxGroup">${GROUPS.map(g => `<option value="${g}">${esc(g)}</option>`).join('')}</select></label>
    <label class="field"><span>Movement it looks like</span>
      <select id="cxPattern">
        ${['squat', 'deadlift', 'benchPress', 'overheadPress', 'row', 'pulldown', 'curl', 'triPushdown', 'lunge', 'plank', 'run']
          .map(p => `<option value="${p}">${p.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())}</option>`).join('')}
      </select></label>
    <div class="small dim">The movement picks which animation is shown.</div>
  `, { action: `<button class="btn btn-primary" data-act="save-custom">Create exercise</button>` });
}

function saveCustom() {
  const name = ($('#cxName')?.value || '').trim();
  if (!name) { toast('Give it a name'); return; }
  S.state.custom.push({
    id: 'custom-' + S.uid(),
    name,
    eq: $('#cxEq').value,
    group: $('#cxGroup').value,
    target: 'Custom exercise',
    pattern: $('#cxPattern').value,
    rest: S.state.settings.defaultRest,
    tips: 'Your own exercise.',
    custom: true,
  });
  S.saveNow();
  closeSheet();
  go('library');
  toast('Exercise created');
}

/* Delegated clicks. */
document.addEventListener('click', (ev) => {
  const nav = ev.target.closest('nav button[data-view]');
  if (nav) { go(nav.dataset.view); return; }

  const tick = ev.target.closest('.set-row .tick');
  if (tick) { toggleSet(tick.closest('.set-row')); return; }

  const chip = ev.target.closest('.chip[data-eq], .chip[data-group]');
  if (chip) {
    if (chip.dataset.eq) ui.libEq = chip.dataset.eq;
    if (chip.dataset.group) ui.libGroup = chip.dataset.group;
    if (chip.dataset.pick) renderPicker(); else renderLibrary();
    return;
  }

  const genBtn = ev.target.closest('.gen-seg button');
  if (genBtn) {
    const seg = genBtn.parentElement, key = seg.dataset.pref;
    S.state.settings[key] = key === 'genMinutes' ? +genBtn.dataset.val : genBtn.dataset.val;
    S.save();
    $$('button', seg).forEach(b => b.classList.toggle('on', b === genBtn));
    return;
  }

  const seg = ev.target.closest('#unitSeg button, #soundSeg button');
  if (seg) {
    if (seg.dataset.unit) S.state.settings.unit = seg.dataset.unit;
    if (seg.dataset.sound !== undefined) S.state.settings.sound = seg.dataset.sound === '1';
    S.saveNow();
    showProfile();
    return;
  }

  const act = ev.target.closest('[data-act]');
  if (act && ACTIONS[act.dataset.act]) {
    ev.preventDefault();
    ACTIONS[act.dataset.act](act);
  }
});

/* Generator tick boxes: remember the selection without re-rendering. */
document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.name !== 'genEq' && t.name !== 'genGroups') return;
  S.state.settings[t.name] = $$(`input[name=${t.name}]:checked`).map(i => i.value);
  S.save();
});

/* Live-updating numeric inputs: never re-render, or the keyboard closes. */
document.addEventListener('input', (ev) => {
  const t = ev.target;

  if (t.id === 'libSearch') { ui.libQuery = t.value; renderLibrary(); $('#libSearch').focus(); return; }
  if (t.id === 'pickSearch') {
    ui.libQuery = t.value;
    const list = filteredExercises().slice(0, 80);
    $('#pickList').innerHTML = list.map(ex => `
      <button class="list-item" data-act="toggle-pick" data-id="${ex.id}">
        <div class="grow"><div class="truncate" style="font-weight:650">${esc(ex.name)}</div>
        <div class="meta truncate">${esc(eqLabel(ex.eq))} · ${esc(ex.target)}</div></div>
        <span class="tick-mark" style="font-size:19px;color:${ui.picked.has(ex.id) ? 'var(--good)' : 'var(--line)'}">${ui.picked.has(ex.id) ? '✓' : '+'}</span>
      </button>`).join('');
    return;
  }

  if (t.id === 'statsExPicker') { ui.statsExercise = t.value; renderStats(); return; }

  const row = t.closest('.set-row');
  if (row && t.dataset.field) {
    const e = S.state.active.entries[+row.dataset.ei];
    const st = e.sets[+row.dataset.si];
    const v = t.value === '' ? null : parseFloat(t.value);
    st[t.dataset.field] = isNaN(v) ? null : v;
    st.u = unit();
    S.save();
    return;
  }

  const gitem = t.dataset.gitem;
  if (gitem !== undefined && ui.generated) {
    const v = parseInt(t.value, 10);
    ui.generated.items[+gitem][t.dataset.field] = isNaN(v) ? null : Math.max(1, v);
    return;
  }

  const ritem = t.dataset.ritem;
  if (ritem !== undefined) {
    const it = ui.editingRoutine.items[+ritem];
    const v = parseInt(t.value, 10);
    it[t.dataset.field] = isNaN(v) ? null : v;
    return;
  }
});

function toggleSet(row) {
  const a = S.state.active;
  const entry = a.entries[+row.dataset.ei];
  const st = entry.sets[+row.dataset.si];
  const ex = S.exById(entry.exId);

  if (!st.done) {
    // Fill anything left blank from the placeholder (last time's numbers).
    for (const c of colsFor(ex)) {
      if (st[c.key] === null || st[c.key] === undefined) {
        const p = parseFloat(prevValue(ex, +row.dataset.si, c.key));
        st[c.key] = isNaN(p) ? (c.key === 'w' ? 0 : null) : p;
      }
    }
    if (ex.type !== 'time' && ex.type !== 'cardio' && !st.r) { toast('Enter your reps first'); return; }
    if (ex.type === 'time' && !st.sec) { toast('Enter the time first'); return; }
    st.u = unit();
    // Bodyweight work is real volume: capture today's bodyweight with the set.
    if (ex.type === 'bw') {
      const b = S.latestBody();
      st.bwkg = b ? S.toKg(b.w, b.u) : 0;
    }
    st.done = true;
    st.ts = new Date().toISOString();
    haptic();
    S.save();
    render();
    startRest(ex.rest || S.state.settings.defaultRest, `Next: ${ex.name}`);
  } else {
    st.done = false;
    S.save();
    render();
  }
}

/* ── init ──────────────────────────────────────────────────────────── */

function init() {
  $('#sheetBg').addEventListener('click', closeSheet);
  $('#sheetClose').addEventListener('click', closeSheet);
  $('#profileBtn').addEventListener('click', showProfile);
  $('#restSkip').addEventListener('click', () => endRest(false));
  $('#restMinus').addEventListener('click', () => { timer.left = Math.max(1, timer.left - 15); drawRing(); });
  $('#restPlus').addEventListener('click', () => { timer.left += 15; timer.total = Math.max(timer.total, timer.left); drawRing(); });

  const name = S.state.profile.name;
  $('#greeting').textContent = name ? `Let's go, ${name}` : new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  initVizTooltips(document.body);

  // Keep the in-workout clock honest without re-rendering the inputs.
  setInterval(() => {
    const a = S.state.active;
    const clock = $('#workoutClock');
    if (!a || !clock) return;
    const mins = Math.max(0, Math.round((Date.now() - new Date(a.start)) / 60000));
    clock.textContent = `${mins} min · ${S.sessionSets(a)} sets · ${S.fmtNum(S.fromKg(S.sessionVolume(a), unit()), 0)} ${unit()}`;
  }, 20000);

  if (S.state.migratedLegacy) {
    delete S.state.migratedLegacy;
    S.saveNow();
    setTimeout(() => toast('Imported your previous workout history'), 700);
  }

  go('train');

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
}

init();
