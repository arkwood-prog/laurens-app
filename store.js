/* Train App — persistence and derived statistics.
 *
 * Everything lives in localStorage on the phone. No account, no server, no
 * network call anywhere in the app.
 *
 * Weights are stored exactly as they were typed, together with their unit, so
 * switching between kg and lb never introduces rounding drift. Anything that
 * aggregates across sets normalises to kg first.
 */

import { EXERCISES } from './exercises.js';

/* These two keys keep their original names on purpose. Renaming KEY would
 * orphan the history already saved on a phone, and LEGACY_KEY is whatever the
 * first version of this app wrote, so it is not ours to rename at all. */
const KEY = 'ironlog_v2';
const LEGACY_KEY = 'ironlog_data';

const LB_PER_KG = 2.2046226218;

export const toKg = (w, u) => (u === 'lb' ? w / LB_PER_KG : w);
export const fromKg = (kg, u) => (u === 'lb' ? kg * LB_PER_KG : kg);

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function todayISO(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return todayISO(d);
}

function emptyState() {
  return {
    v: 2,
    profile: { name: '', heightCm: null, sex: '', birthYear: null },
    settings: { unit: 'kg', defaultRest: 90, sound: true, autoRest: true, genEq: [], genGroups: [], genMinutes: 45, genGoal: 'muscle' },
    body: [],
    routines: [],
    sessions: [],
    custom: [],
    active: null,
  };
}

/* ── load / save ───────────────────────────────────────────────────── */

function migrateLegacy(state) {
  let raw;
  try { raw = localStorage.getItem(LEGACY_KEY); } catch { return state; }
  if (!raw) return state;
  try {
    const old = JSON.parse(raw);
    if (old.unit) state.settings.unit = old.unit;
    if (old.restSeconds) state.settings.defaultRest = old.restSeconds;
    const byName = new Map(EXERCISES.map(e => [e.name.toLowerCase(), e]));
    for (const s of old.sessions || []) {
      if (!s.exercises || !s.exercises.length) continue;
      const entries = [];
      for (const ex of s.exercises) {
        const match = byName.get((ex.name || '').toLowerCase());
        let exId;
        if (match) {
          exId = match.id;
        } else {
          // Preserve the name as a custom exercise so nothing is lost.
          exId = 'legacy-' + ex.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          if (!state.custom.some(c => c.id === exId)) {
            state.custom.push({
              id: exId, name: ex.name, eq: 'other', group: 'Chest',
              target: 'Imported from your previous log', pattern: 'squat', rest: 90, custom: true,
            });
          }
        }
        entries.push({
          exId,
          sets: (ex.sets || []).map(st => ({ w: st.weight, u: st.unit || 'kg', r: st.reps, done: true })),
        });
      }
      state.sessions.push({
        id: uid(), date: s.date, start: s.date + 'T12:00:00', end: s.date + 'T13:00:00',
        name: 'Imported workout', routineId: null, entries, note: '',
      });
    }
    state.migratedLegacy = true;
  } catch { /* a corrupt legacy blob should never block the new app */ }
  return state;
}

function load() {
  let state = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = JSON.parse(raw);
  } catch { state = null; }

  if (!state || state.v !== 2) {
    state = migrateLegacy(emptyState());
    persist(state);
  }
  // Defensive top-up: an older build may be missing newer fields.
  const base = emptyState();
  for (const k of Object.keys(base)) if (state[k] === undefined) state[k] = base[k];
  for (const k of Object.keys(base.settings)) if (state.settings[k] === undefined) state.settings[k] = base.settings[k];
  for (const k of Object.keys(base.profile)) if (state.profile[k] === undefined) state.profile[k] = base.profile[k];
  return state;
}

let saveTimer = null;
export let state = load();

function persist(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch (e) {
    console.warn('Train App: could not save', e);
    return false;
  }
}

/* Debounced — typing in a set row should not hit storage on every keystroke. */
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist(state), 150);
}

export function saveNow() {
  clearTimeout(saveTimer);
  return persist(state);
}

export function replaceState(next) {
  state = next;
  saveNow();
}

/* ── exercise lookup ───────────────────────────────────────────────── */

export function allExercises() {
  return EXERCISES.concat(state.custom || []);
}

const exCache = new Map();
export function exById(id) {
  if (exCache.size !== allExercises().length) {
    exCache.clear();
    for (const e of allExercises()) exCache.set(e.id, e);
  }
  return exCache.get(id) || { id, name: 'Unknown exercise', eq: 'other', group: 'Chest', target: '', pattern: 'squat', rest: 90 };
}

/* ── formatting ────────────────────────────────────────────────────── */

export function fmtNum(v, dp = 1) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  const r = Math.round(v * 10 ** dp) / 10 ** dp;
  return String(r % 1 === 0 ? r : r.toFixed(dp));
}

export function fmtWeight(w, u) {
  return fmtNum(w) + ' ' + (u || state.settings.unit);
}

/* Load moved by one set, in kg. Bodyweight sets record the bodyweight at the
 * time they were logged, so a set of pull-ups counts as real work and old
 * sessions keep the weight you actually were back then. */
export function setLoadKg(st) {
  return toKg(st.w || 0, st.u) + (st.bwkg || 0);
}

/* Volume in kg for one logged set. */
export function setVolume(st) {
  if (!st.done || !st.r) return 0;
  return setLoadKg(st) * st.r;
}

export function sessionVolume(sess) {
  let v = 0;
  for (const e of sess.entries || []) for (const st of e.sets || []) v += setVolume(st);
  return v;
}

export function sessionSets(sess) {
  let n = 0;
  for (const e of sess.entries || []) for (const st of e.sets || []) if (st.done) n++;
  return n;
}

export function sessionReps(sess) {
  let n = 0;
  for (const e of sess.entries || []) for (const st of e.sets || []) if (st.done) n += st.r || 0;
  return n;
}

export function sessionMinutes(sess) {
  if (!sess.start || !sess.end) return 0;
  return Math.max(0, Math.round((new Date(sess.end) - new Date(sess.start)) / 60000));
}

/* Epley estimated one-rep max, in kg. */
export function e1rm(st) {
  if (!st.done || !st.r) return 0;
  const kg = setLoadKg(st);
  if (!kg) return 0;
  return st.r === 1 ? kg : kg * (1 + st.r / 30);
}

/* ── history queries ───────────────────────────────────────────────── */

export function sessionsSorted() {
  return [...state.sessions].sort((a, b) => (b.start || b.date).localeCompare(a.start || a.date));
}

/* Every completed set of one exercise, oldest first, tagged with its date. */
export function historyFor(exId) {
  const out = [];
  for (const s of state.sessions) {
    for (const e of s.entries || []) {
      if (e.exId !== exId) continue;
      const sets = (e.sets || []).filter(st => st.done);
      if (sets.length) out.push({ date: s.date, sessionId: s.id, sets });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function lastPerformance(exId) {
  const h = historyFor(exId);
  return h.length ? h[h.length - 1] : null;
}

/* Personal records for one exercise. */
export function prFor(exId) {
  let bestE1 = 0, bestWeight = 0, bestWeightSet = null, bestReps = 0, bestVolume = 0, bestSet = null;
  for (const day of historyFor(exId)) {
    let dayVol = 0;
    for (const st of day.sets) {
      const e = e1rm(st);
      if (e > bestE1) { bestE1 = e; bestSet = { ...st, date: day.date }; }
      const kg = setLoadKg(st);
      if (kg > bestWeight) { bestWeight = kg; bestWeightSet = { ...st, date: day.date }; }
      if ((st.r || 0) > bestReps) bestReps = st.r;
      dayVol += setVolume(st);
    }
    if (dayVol > bestVolume) bestVolume = dayVol;
  }
  return { e1rm: bestE1, set: bestSet, weight: bestWeight, weightSet: bestWeightSet, reps: bestReps, volume: bestVolume };
}

/* PRs broken by a session — computed against everything logged *before* it. */
export function prsInSession(sess) {
  const prior = state.sessions.filter(s => s.id !== sess.id && (s.start || s.date) < (sess.start || sess.date));
  const best = new Map();
  for (const s of prior) {
    for (const e of s.entries || []) {
      for (const st of e.sets || []) {
        if (!st.done) continue;
        const cur = best.get(e.exId) || { e1: 0, w: 0 };
        best.set(e.exId, { e1: Math.max(cur.e1, e1rm(st)), w: Math.max(cur.w, setLoadKg(st)) });
      }
    }
  }
  const out = [];
  for (const e of sess.entries || []) {
    const before = best.get(e.exId);
    let topE1 = 0, topW = 0, topSet = null;
    for (const st of e.sets || []) {
      if (!st.done) continue;
      const v = e1rm(st);
      if (v > topE1) { topE1 = v; topSet = st; }
      topW = Math.max(topW, setLoadKg(st));
    }
    if (!topSet) continue;
    if (!before) out.push({ exId: e.exId, kind: 'first', set: topSet, e1rm: topE1 });
    else if (topE1 > before.e1 + 0.01) out.push({ exId: e.exId, kind: 'e1rm', set: topSet, e1rm: topE1, prev: before.e1 });
    else if (topW > before.w + 0.01) out.push({ exId: e.exId, kind: 'weight', set: topSet, e1rm: topE1 });
  }
  return out;
}

/* ── aggregate stats ───────────────────────────────────────────────── */

export function totals() {
  const s = state.sessions;
  let vol = 0, sets = 0, reps = 0, mins = 0;
  for (const x of s) { vol += sessionVolume(x); sets += sessionSets(x); reps += sessionReps(x); mins += sessionMinutes(x); }
  return { workouts: s.length, volume: vol, sets, reps, minutes: mins };
}

/* Consecutive-week training streak, counting back from this week. */
export function weekStreak() {
  if (!state.sessions.length) return 0;
  const weeks = new Set(state.sessions.map(s => weekKey(s.date)));
  let streak = 0;
  const d = new Date();
  for (let i = 0; i < 260; i++) {
    const k = weekKey(todayISO(d));
    if (weeks.has(k)) streak++;
    else if (i > 0) break;                    // the current week may be empty so far
    d.setDate(d.getDate() - 7);
  }
  return streak;
}

export function weekKey(iso) {
  const d = new Date(iso + 'T00:00:00');
  const day = (d.getDay() + 6) % 7;           // Monday = 0
  d.setDate(d.getDate() - day);
  return todayISO(d);
}

/* Volume per week for the last `n` weeks, oldest first. */
export function weeklyVolume(n = 12) {
  const buckets = new Map();
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  const keys = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = new Date(d);
    k.setDate(k.getDate() - i * 7);
    const key = todayISO(k);
    keys.push(key);
    buckets.set(key, 0);
  }
  for (const s of state.sessions) {
    const k = weekKey(s.date);
    if (buckets.has(k)) buckets.set(k, buckets.get(k) + sessionVolume(s));
  }
  return keys.map(k => ({ key: k, value: buckets.get(k) }));
}

/* Sets per muscle group since `sinceISO`. */
export function groupBreakdown(sinceISO) {
  const map = new Map();
  for (const s of state.sessions) {
    if (sinceISO && s.date < sinceISO) continue;
    for (const e of s.entries || []) {
      const g = exById(e.exId).group;
      const n = (e.sets || []).filter(st => st.done).length;
      if (n) map.set(g, (map.get(g) || 0) + n);
    }
  }
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

/* Progression series for one exercise: top-set e1RM and heaviest weight per day. */
export function progressSeries(exId) {
  return historyFor(exId).map(day => {
    let e1 = 0, top = 0, vol = 0;
    for (const st of day.sets) {
      e1 = Math.max(e1, e1rm(st));
      top = Math.max(top, setLoadKg(st));
      vol += setVolume(st);
    }
    return { date: day.date, e1rm: e1, top, volume: vol };
  });
}

/* Exercises with at least two logged days, most recently trained first. */
export function trackedExercises() {
  const seen = new Map();
  for (const s of state.sessions) {
    for (const e of s.entries || []) {
      if (!(e.sets || []).some(st => st.done)) continue;
      const cur = seen.get(e.exId) || { days: new Set(), last: '' };
      cur.days.add(s.date);
      if (s.date > cur.last) cur.last = s.date;
      seen.set(e.exId, cur);
    }
  }
  return [...seen.entries()]
    .map(([exId, v]) => ({ exId, days: v.days.size, last: v.last }))
    .sort((a, b) => b.last.localeCompare(a.last));
}

/* ── body metrics ──────────────────────────────────────────────────── */

export function bodySorted() {
  return [...state.body].sort((a, b) => a.date.localeCompare(b.date));
}

export function latestBody() {
  const b = bodySorted();
  return b.length ? b[b.length - 1] : null;
}

export function logBody({ date, w, u, bodyFat, note }) {
  const existing = state.body.find(b => b.date === date);
  if (existing) Object.assign(existing, { w, u, bodyFat, note });
  else state.body.push({ id: uid(), date, w, u, bodyFat, note });
  save();
}

export function bmi() {
  const b = latestBody();
  const h = state.profile.heightCm;
  if (!b || !h) return null;
  const kg = toKg(b.w, b.u);
  const m = h / 100;
  return kg / (m * m);
}

/* ── backup ────────────────────────────────────────────────────────── */

export function exportJSON() {
  return JSON.stringify({ app: 'Train App', exported: new Date().toISOString(), data: state }, null, 2);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  const next = parsed.data || parsed;
  if (!next || typeof next !== 'object' || !Array.isArray(next.sessions)) {
    throw new Error('That file does not look like a Train App backup.');
  }
  const base = emptyState();
  for (const k of Object.keys(base)) if (next[k] === undefined) next[k] = base[k];
  next.v = 2;
  replaceState(next);
  exCache.clear();
}
