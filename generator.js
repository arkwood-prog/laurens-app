/* Train App — workout generator.
 *
 * A rule-based engine that runs entirely on the phone: no network, no cost.
 * It builds a session from the exercise library using the ticked equipment and
 * body areas, then lets you swap, add or reshuffle individual exercises.
 *
 * How a session is chosen:
 *   - Exercises are split per body area into compounds (long rest: squats,
 *     presses, rows, RDLs) and accessories.
 *   - Each area gets one compound first, then accessories, round-robin so the
 *     areas stay balanced.
 *   - Within an area it avoids repeating a movement ("two presses"), and it
 *     prefers exercises you have not done in your last few workouts.
 *   - Sets and reps follow the goal (strength / muscle / endurance) and the
 *     exercise type, heaviest lifts first and cardio last.
 *
 * Output is { name, items: [{ exId, sets, reps }] } — the same item shape
 * routines use, so a result can be started or saved as a routine. */

import * as S from './store.js';

export const GOALS = [
  { id: 'strength', label: 'Strength' },
  { id: 'muscle', label: 'Muscle' },
  { id: 'endurance', label: 'Endurance' },
];

const FULL_BODY = ['Legs', 'Back', 'Chest', 'Shoulders', 'Glutes', 'Arms', 'Core'];

/* Exercises that satisfy the ticked equipment and body areas. */
export function candidates({ eq, groups }) {
  return S.allExercises().filter(ex =>
    (!eq.length || eq.includes(ex.eq)) && (!groups.length || groups.includes(ex.group)));
}

const countFor = (minutes) => Math.max(3, Math.min(8, Math.round(minutes / 10) + 1));
const isCompound = (ex) => (ex.rest || 0) >= 120 && ex.type !== 'cardio';
/* "Dumbbell Bench Press" and "Dumbbell Incline Press" are both a press. */
const kind = (ex) => ex.group + ':' + ex.name.split(' ').pop();

export function prescribe(ex, goal = 'muscle') {
  if (ex.type === 'cardio') return { sets: 1, reps: null };
  if (ex.type === 'time') return { sets: 3, reps: goal === 'endurance' ? 60 : 40 };
  const heavy = (ex.rest || 0) >= 180, compound = isCompound(ex);
  switch (goal) {
    case 'strength': return heavy ? { sets: 5, reps: 5 } : compound ? { sets: 4, reps: 6 } : { sets: 3, reps: 10 };
    case 'endurance': return compound ? { sets: 3, reps: 15 } : { sets: 2, reps: 20 };
    default: return heavy ? { sets: 4, reps: 8 } : compound ? { sets: 3, reps: 10 } : { sets: 3, reps: 12 };
  }
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Exercises from the last few sessions sort to the back of the queue. */
function recentIds() {
  const ids = new Set();
  for (const s of S.sessionsSorted().slice(0, 3)) for (const e of s.entries) ids.add(e.exId);
  return ids;
}

function freshFirst(list, recent) {
  const r = shuffle(list);
  return [...r.filter(e => !recent.has(e.id)), ...r.filter(e => recent.has(e.id))];
}

export function titleFor(groups) {
  if (!groups.length || groups.length >= 5) return 'Full Body Workout';
  return groups.join(' & ') + ' Workout';
}

function areasFor(opts, pool) {
  if (opts.groups.length) return opts.groups.filter(g => pool.some(e => e.group === g));
  const have = new Set(pool.map(e => e.group));
  const order = FULL_BODY.filter(g => have.has(g));
  return order.length ? order : [...have];
}

/* Heavy lifts first, finishers and cardio last. */
function orderItems(items) {
  const w = (it) => {
    const ex = S.exById(it.exId);
    return ex.type === 'cardio' ? -1 : (ex.rest || 0);
  };
  return items.sort((a, b) => w(b) - w(a));
}

export function generate(opts) {
  const pool = candidates(opts);
  const want = Math.min(countFor(opts.minutes), pool.length);
  const recent = recentIds();

  const queues = areasFor(opts, pool).map(g => {
    const inArea = pool.filter(e => e.group === g);
    return {
      compounds: freshFirst(inArea.filter(isCompound), recent),
      rest: freshFirst(inArea.filter(e => !isCompound(e)), recent),
      used: 0,
    };
  });

  const picked = [];
  const seen = new Set();
  const take = (q, strict) => {
    // An area's first pick is a compound when it has one.
    const lists = q.used === 0 ? [q.compounds, q.rest] : [q.rest, q.compounds];
    for (const list of lists) {
      const i = list.findIndex(e => !strict || (!seen.has(e.pattern) && !seen.has(kind(e))));
      if (i >= 0) {
        const [ex] = list.splice(i, 1);
        picked.push(ex);
        seen.add(ex.pattern).add(kind(ex));
        q.used++;
        return true;
      }
    }
    return false;
  };

  // First pass avoids repeating a movement; the second fills any gaps.
  for (const strict of [true, false]) {
    let progress = true;
    while (picked.length < want && progress) {
      progress = false;
      for (const q of queues) {
        if (picked.length >= want) break;
        if (take(q, strict)) progress = true;
      }
    }
  }

  return {
    name: titleFor(opts.groups),
    items: orderItems(picked.map(ex => ({ exId: ex.id, ...prescribe(ex, opts.goal) }))),
  };
}

/* A replacement for one exercise: same body area, same compound/accessory
 * role and ideally the same movement, never one already in the workout. */
export function swapFor(exId, opts, excludeIds) {
  const cur = S.exById(exId);
  const exclude = new Set(excludeIds);
  const pool = candidates({ eq: opts.eq, groups: [] })
    .filter(e => e.id !== exId && !exclude.has(e.id) && e.group === cur.group);
  const tiers = [
    pool.filter(e => e.pattern === cur.pattern),
    pool.filter(e => isCompound(e) === isCompound(cur)),
    pool,
  ];
  // Mostly the closest match, sometimes a broader one, so repeated swaps vary.
  for (const t of tiers) if (t.length && (t === pool || Math.random() < 0.7)) return shuffle(t)[0];
  return null;
}

/* One more exercise that fits the selections and is not already included. */
export function extraFor(opts, excludeIds) {
  const exclude = new Set(excludeIds);
  const pool = candidates(opts).filter(e => !exclude.has(e.id));
  if (!pool.length) return null;
  // Favour the area with the fewest exercises so far.
  const count = {};
  for (const id of excludeIds) { const g = S.exById(id).group; count[g] = (count[g] || 0) + 1; }
  const areas = areasFor(opts, pool).sort((a, b) => (count[a] || 0) - (count[b] || 0));
  const area = areas.find(g => pool.some(e => e.group === g));
  return freshFirst(pool.filter(e => e.group === area), recentIds())[0];
}
