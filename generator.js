/* Train App — workout generator.
 *
 * Two engines behind one call:
 *   - Claude (when an Anthropic API key is saved under ☰): picks exercises from
 *     this app's own catalogue, so every result has an animation and logs
 *     like any other workout. The SDK is bundled locally and only loaded here.
 *   - Offline: a rule-based picker used when there is no key or no signal.
 *
 * Both return { name, notes, items: [{ exId, sets, reps }] } — the same item
 * shape routines use, so the result can be started or saved as a routine. */

import * as S from './store.js';

const KEY_STORE = 'train_ai_key';   // kept out of state so backups never carry it
const MODEL = 'claude-opus-5';

export function getApiKey() {
  try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; }
}

export function setApiKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORE, key); else localStorage.removeItem(KEY_STORE);
  } catch { /* storage unavailable: key just won't persist */ }
}

/* Exercises that satisfy the ticked equipment and body areas. */
export function candidates({ eq, groups }) {
  return S.allExercises().filter(ex =>
    (!eq.length || eq.includes(ex.eq)) && (!groups.length || groups.includes(ex.group)));
}

const countFor = (minutes) => Math.max(3, Math.min(8, Math.round(minutes / 10) + 1));

/* Rest time is a good proxy for how heavy/compound a movement is. */
function prescribe(ex) {
  if (ex.type === 'cardio') return { sets: 1, reps: null };
  if (ex.type === 'time') return { sets: 3, reps: 45 };
  if ((ex.rest || 0) >= 180) return { sets: 4, reps: 6 };
  if ((ex.rest || 0) >= 120) return { sets: 3, reps: 8 };
  return { sets: 3, reps: 12 };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function titleFor(groups) {
  if (!groups.length || groups.length >= 5) return 'Full Body Workout';
  return groups.join(' & ') + ' Workout';
}

/* No area ticked: big muscle groups first, cardio only if nothing else fits. */
function fullBody(pool) {
  const have = new Set(pool.map(e => e.group));
  const order = ['Legs', 'Back', 'Chest', 'Shoulders', 'Glutes', 'Arms', 'Core'].filter(g => have.has(g));
  return order.length ? order : [...have];
}

export function generateOffline(opts) {
  const pool = candidates(opts);
  const want = Math.min(countFor(opts.minutes), pool.length);
  const groups = opts.groups.length ? opts.groups : fullBody(pool);

  // One queue per body area: its heaviest lift first, the rest shuffled for
  // variety. Round-robin across areas keeps the split balanced.
  const queues = groups.map(g => {
    const q = shuffle(pool.filter(e => e.group === g));
    const top = q.reduce((i, e, j) => (e.rest || 0) > (q[i].rest || 0) ? j : i, 0);
    if (q.length) q.unshift(q.splice(top, 1)[0]);
    return q;
  });
  // "Dumbbell Bench Press" and "Dumbbell Incline Press" are both a press.
  const kind = (ex) => ex.group + ':' + ex.name.split(' ').pop();
  const picked = [];
  const seen = new Set();
  for (let pass = 0; picked.length < want && pass < 2; pass++) {
    let progress = true;
    while (picked.length < want && progress) {
      progress = false;
      for (const q of queues) {
        if (picked.length >= want) break;
        // First pass avoids repeating a movement; the second fills any gaps.
        const i = q.findIndex(e => pass > 0 || (!seen.has(e.pattern) && !seen.has(kind(e))));
        if (i < 0) continue;
        const [ex] = q.splice(i, 1);
        picked.push(ex);
        seen.add(ex.pattern).add(kind(ex));
        progress = true;
      }
    }
  }

  // Heavy lifts first, finishers and cardio last.
  picked.sort((a, b) => (a.type === 'cardio') - (b.type === 'cardio') || (b.rest || 0) - (a.rest || 0));
  return {
    name: titleFor(opts.groups),
    notes: 'Built offline from your selections.',
    items: picked.map(ex => ({ exId: ex.id, ...prescribe(ex) })),
    source: 'offline',
  };
}

export async function generateWithClaude(opts) {
  const pool = candidates(opts);
  if (!pool.length) throw new Error('No exercises match those selections.');
  const want = Math.min(countFor(opts.minutes), pool.length);

  const recent = S.sessionsSorted().slice(0, 3)
    .map(s => `${s.date}: ${s.entries.map(e => S.exById(e.exId).name).join(', ')}`);

  const catalogue = pool.map(ex =>
    `${ex.id} | ${ex.name} | ${ex.eq} | ${ex.group} | ${ex.target}${ex.type ? ' | ' + ex.type : ''}`).join('\n');

  const prompt = `Design one gym session for me.

Time available: about ${opts.minutes} minutes (aim for ${want} exercises).
Equipment: ${opts.eq.length ? opts.eq.join(', ') : 'anything'}.
Target body areas: ${opts.groups.length ? opts.groups.join(', ') : 'full body'}.
${opts.goal ? `Goal / notes from me: ${opts.goal}\n` : ''}${recent.length ? `My recent sessions (avoid repeating them too closely):\n${recent.join('\n')}\n` : ''}
Choose only from this catalogue (id | name | equipment | group | muscles | log type):
${catalogue}

Order exercises sensibly (big compound lifts first), cover every target area, and give sets and reps.
For log type "time" the reps field is seconds; for "cardio" use 1 set and reps 0.
Give the workout a short name and one or two sentences of coaching notes.`;

  const { default: Anthropic } = await import('./anthropic-sdk.js');
  const client = new Anthropic({ apiKey: getApiKey(), dangerouslyAllowBrowser: true });

  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'medium',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            notes: { type: 'string' },
            exercises: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', enum: pool.map(e => e.id) },
                  sets: { type: 'integer' },
                  reps: { type: 'integer' },
                },
                required: ['id', 'sets', 'reps'],
                additionalProperties: false,
              },
            },
          },
          required: ['name', 'notes', 'exercises'],
          additionalProperties: false,
        },
      },
    },
    messages: [{ role: 'user', content: prompt }],
  });

  if (res.stop_reason === 'refusal') throw new Error('Claude declined that request.');
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const out = JSON.parse(text);

  const valid = new Set(pool.map(e => e.id));
  const seen = new Set();
  const items = [];
  for (const x of out.exercises || []) {
    if (!valid.has(x.id) || seen.has(x.id)) continue;
    seen.add(x.id);
    const ex = S.exById(x.id);
    items.push({
      exId: x.id,
      sets: Math.max(1, Math.min(8, x.sets | 0 || 3)),
      reps: ex.type === 'cardio' ? null : Math.max(1, Math.min(300, x.reps | 0)) || null,
    });
  }
  if (!items.length) throw new Error('Claude returned no usable exercises.');
  return { name: out.name || titleFor(opts.groups), notes: out.notes || '', items, source: 'ai' };
}

/* Claude when a key is saved, falling back to offline on any failure. */
export async function generate(opts) {
  if (!getApiKey()) return generateOffline(opts);
  try {
    return await generateWithClaude(opts);
  } catch (e) {
    const w = generateOffline(opts);
    const why = e.status === 401 ? 'API key was rejected'
      : e.status === 429 ? 'rate limited, try again shortly'
      : e.status ? `API error ${e.status}`
      : e.message || 'no connection';
    w.notes = `AI unavailable (${why}) — built offline instead.`;
    return w;
  }
}
