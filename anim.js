/* Laurens App — exercise animation engine.
 *
 * Original public-domain (CC0) artwork: an articulated figure drawn as SVG and
 * posed by inverse kinematics. Nothing is fetched from the network, so the
 * animations work offline and cannot rot.
 *
 * A pattern is a list of key poses. Poses give the positions that matter
 * (hips, hands, planted feet) and a two-link IK solver fills in the elbows and
 * knees, so feet stay on the floor and hands stay on the bar automatically.
 * Between key poses everything is eased and interpolated.
 *
 * Canvas: 200x200 viewBox, floor at y=170, standing hips at y=108.
 */

const L = { torso: 40, neck: 15, head: 8.5, uarm: 21, farm: 21, thigh: 30, shin: 30, foot: 11 };
const FLOOR = 170;

/* ── inverse kinematics ────────────────────────────────────────────── */

/* Two-link solve. Returns the joint (elbow/knee) and the reachable end point.
 * `bend` picks which side the joint buckles to: +1 or -1. */
function solve2(ox, oy, tx, ty, l1, l2, bend) {
  let dx = tx - ox, dy = ty - oy;
  let d = Math.hypot(dx, dy);
  const max = l1 + l2 - 0.01, min = Math.abs(l1 - l2) + 0.01;
  if (d > max) { dx *= max / d; dy *= max / d; d = max; }
  else if (d < min) {
    if (d < 0.001) { dx = min; dy = 0; d = min; }
    else { dx *= min / d; dy *= min / d; d = min; }
  }
  const base = Math.atan2(-dy, dx);                       // y-up angle
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  const a1 = base + bend * Math.acos(cosA);
  return {
    joint: { x: ox + Math.cos(a1) * l1, y: oy - Math.sin(a1) * l1 },
    end: { x: ox + dx, y: oy + dy },
  };
}

const rad = (d) => d * Math.PI / 180;
const along = (o, a, len) => ({ x: o.x + Math.cos(rad(a)) * len, y: o.y - Math.sin(rad(a)) * len });

/* ── pose interpolation ────────────────────────────────────────────── */

const POSE_PTS = ['hip', 'hand', 'hand2', 'handRel', 'handRel2', 'ankle', 'ankle2'];
const POSE_NUMS = ['t', 'headTilt', 'footA', 'footA2', 'elbowBend', 'kneeBend'];

function lerp(a, b, u) { return a + (b - a) * u; }
function lerpPt(a, b, u) { return a && b ? [lerp(a[0], b[0], u), lerp(a[1], b[1], u)] : (a || b); }

function blend(p0, p1, u) {
  const out = {};
  for (const k of POSE_PTS) if (p0[k] || p1[k]) out[k] = lerpPt(p0[k], p1[k], u);
  for (const k of POSE_NUMS) {
    const a = p0[k], b = p1[k];
    if (a === undefined && b === undefined) continue;
    out[k] = lerp(a === undefined ? b : a, b === undefined ? a : b, u);
  }
  return out;
}

/* ── skeleton resolution ───────────────────────────────────────────── */

function resolve(pose) {
  const hip = { x: pose.hip[0], y: pose.hip[1] };
  const t = pose.t === undefined ? 90 : pose.t;
  const sho = along(hip, t, L.torso);
  const head = along(sho, t + (pose.headTilt || 0), L.neck);

  const eb = pose.elbowBend === undefined ? -1 : (pose.elbowBend >= 0 ? 1 : -1);
  const kb = pose.kneeBend === undefined ? -1 : (pose.kneeBend >= 0 ? 1 : -1);

  const handAbs = (rel, abs) => rel ? [sho.x + rel[0], sho.y + rel[1]] : abs;
  const h1 = handAbs(pose.handRel, pose.hand) || [sho.x, sho.y + 42];
  const h2 = handAbs(pose.handRel2, pose.hand2) || h1;

  const arm = solve2(sho.x, sho.y, h1[0], h1[1], L.uarm, L.farm, eb);
  const arm2 = solve2(sho.x, sho.y, h2[0], h2[1], L.uarm, L.farm, eb);

  const a1 = pose.ankle || [hip.x, hip.y + 60];
  const a2 = pose.ankle2 || a1;
  const leg = solve2(hip.x, hip.y, a1[0], a1[1], L.thigh, L.shin, kb);
  const leg2 = solve2(hip.x, hip.y, a2[0], a2[1], L.thigh, L.shin, kb);

  const fa = pose.footA === undefined ? 0 : pose.footA;
  const fa2 = pose.footA2 === undefined ? fa : pose.footA2;

  return {
    hip, sho, head, t,
    arm, arm2, leg, leg2,
    toe: along(leg.end, fa, L.foot),
    toe2: along(leg2.end, fa2, L.foot),
  };
}

/* ── SVG drawing helpers ───────────────────────────────────────────── */

const n = (v) => Math.round(v * 10) / 10;
const line = (a, b, cls) => `<path class="${cls}" d="M${n(a.x)} ${n(a.y)} L${n(b.x)} ${n(b.y)}"/>`;
const poly = (pts, cls) => `<path class="${cls}" d="M${pts.map(p => `${n(p.x)} ${n(p.y)}`).join(' L')}"/>`;
const circ = (p, r, cls) => `<circle class="${cls}" cx="${n(p.x)}" cy="${n(p.y)}" r="${n(r)}"/>`;

function perp(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, m = Math.hypot(dx, dy) || 1;
  return { x: -dy / m, y: dx / m };
}

/* Equipment drawn at the hands. `view` changes how a bar reads: end-on from the
 * side, spanning both hands from the front. */
function drawEquip(eq, S, pat) {
  const h = S.arm.end, h2 = S.arm2.end;
  const view = pat.view || 'side';
  let out = '';

  if (eq === 'barbell') {
    if (view === 'front') {
      const dx = h.x - h2.x, dy = h.y - h2.y, m = Math.hypot(dx, dy) || 1;
      const ux = dx / m, uy = dy / m, e = 26;
      const A = { x: h2.x - ux * e, y: h2.y - uy * e };
      const B = { x: h.x + ux * e, y: h.y + uy * e };
      out += line(A, B, 'eq-bar');
      out += circ(A, 9, 'eq-plate') + circ(B, 9, 'eq-plate');
    } else {
      // End-on: the bar reads as a plate disc at the hands.
      out += circ(h2, 11, 'eq-plate-far') + circ(h, 12, 'eq-plate') + circ(h, 3.5, 'eq-hub');
    }
  } else if (eq === 'dumbbell') {
    for (const [hand, elbow, cls] of [[h2, S.arm2.joint, 'eq-far'], [h, S.arm.joint, 'eq']]) {
      const p = perp(elbow, hand);
      const A = { x: hand.x - p.x * 11, y: hand.y - p.y * 11 };
      const B = { x: hand.x + p.x * 11, y: hand.y + p.y * 11 };
      out += line(A, B, cls === 'eq-far' ? 'eq-bar-far' : 'eq-bar');
      out += circ(A, 5.5, cls === 'eq-far' ? 'eq-plate-far' : 'eq-plate');
      out += circ(B, 5.5, cls === 'eq-far' ? 'eq-plate-far' : 'eq-plate');
    }
  } else if (eq === 'kettlebell') {
    const bell = { x: h.x, y: h.y + 15 };
    out += `<path class="eq-bar" d="M${n(h.x - 6)} ${n(h.y + 2)} Q${n(h.x)} ${n(h.y - 6)} ${n(h.x + 6)} ${n(h.y + 2)}"/>`;
    out += `<path class="eq-plate" d="M${n(bell.x - 9)} ${n(bell.y + 5)} Q${n(bell.x - 9)} ${n(bell.y - 7)} ${n(bell.x)} ${n(bell.y - 7)} Q${n(bell.x + 9)} ${n(bell.y - 7)} ${n(bell.x + 9)} ${n(bell.y + 5)} Z"/>`;
  } else if (eq === 'cable' || eq === 'band') {
    const a = pat.cableAnchor || [175, 30];
    const anchor = { x: a[0], y: a[1] };
    out += `<path class="${eq === 'band' ? 'eq-band' : 'eq-cable'}" d="M${n(anchor.x)} ${n(anchor.y)} L${n(h.x)} ${n(h.y)}"/>`;
    if (eq === 'cable') {
      out += circ(anchor, 4.5, 'eq-plate');
      // Weight stack on the frame column.
      const col = a[0] > 100 ? 186 : 14;
      out += `<path class="eq-frame" d="M${col} ${n(anchor.y - 8)} L${col} 160"/>`;
      for (let i = 0; i < 4; i++) out += `<rect class="eq-plate" x="${col - 7}" y="${118 + i * 10}" width="14" height="7" rx="1.5"/>`;
    } else {
      out += circ(anchor, 3.5, 'eq-plate');
    }
    out += line({ x: h2.x, y: h2.y }, { x: h2.x, y: h2.y }, 'eq');
  } else if (eq === 'plate') {
    out += circ(h, 13, 'eq-plate') + circ(h, 4, 'eq-hub');
  }
  return out;
}

/* Static scenery. */
function drawProps(pat) {
  let out = '';
  for (const p of pat.props || []) {
    switch (p) {
      case 'floor':
        out += `<path class="prop-floor" d="M8 ${FLOOR} L192 ${FLOOR}"/>`;
        break;
      case 'benchFlat':
        out += bench([48, 120], [140, 120]);
        break;
      case 'benchIncline':
        out += bench([56, 142], [128, 96]);
        break;
      case 'benchDecline':
        out += bench([56, 104], [132, 138]);
        break;
      case 'benchShort':
        out += bench([74, 132], [136, 132]);
        break;
      case 'preacherPad':
        out += `<path class="prop" d="M70 150 L70 118 L112 100"/><path class="prop-fill" d="M66 150 L96 150 L96 156 L66 156 Z"/>`;
        break;
      case 'pullupBar':
        out += `<path class="prop" d="M40 22 L160 22"/><path class="prop" d="M46 22 L46 ${FLOOR}"/><path class="prop" d="M154 22 L154 ${FLOOR}"/>`;
        break;
      case 'lowBar':
        out += `<path class="prop" d="M40 118 L160 118"/><path class="prop" d="M46 118 L46 ${FLOOR}"/><path class="prop" d="M154 118 L154 ${FLOOR}"/>`;
        break;
      case 'seat':
        out += `<path class="prop-fill" d="M62 128 L118 128 L118 136 L62 136 Z"/><path class="prop" d="M70 136 L70 ${FLOOR}"/><path class="prop" d="M110 136 L110 ${FLOOR}"/>`;
        break;
      case 'seatBack':
        out += `<path class="prop-fill" d="M104 128 L150 128 L150 136 L104 136 Z"/><path class="prop-fill" d="M142 128 L150 128 L150 84 L142 84 Z"/><path class="prop" d="M112 136 L112 ${FLOOR}"/><path class="prop" d="M146 136 L146 ${FLOOR}"/>`;
        break;
      case 'sled':
        out += `<path class="prop" d="M24 40 L24 150"/><path class="prop-fill" d="M24 52 L52 78 L44 88 L16 62 Z"/>`;
        break;
      case 'wall':
        out += `<path class="prop" d="M150 30 L150 ${FLOOR}"/>`;
        break;
      case 'box':
        out += `<path class="prop-fill" d="M118 ${FLOOR} L118 132 L166 132 L166 ${FLOOR} Z"/>`;
        break;
      case 'mat':
        out += `<path class="prop-floor" d="M22 ${FLOOR} L178 ${FLOOR}"/>`;
        break;
      case 'bike':
        out += `<circle class="prop" cx="62" cy="146" r="24" fill="none"/><path class="prop" d="M62 146 L104 120 L128 152"/>`;
        break;
      case 'ergRail':
        out += `<path class="prop" d="M30 158 L178 158"/><path class="prop" d="M42 130 L42 158"/>`;
        break;
      case 'water':
        out += `<path class="prop-floor" d="M8 132 Q30 126 52 132 T96 132 T140 132 T192 132"/>`;
        break;
      case 'legExtPad':
        out += `<path class="prop-fill" d="M120 148 L140 148 L140 158 L120 158 Z"/>`;
        break;
      case 'legCurlPad':
        out += `<path class="prop-fill" d="M132 118 L152 118 L152 128 L132 128 Z"/>`;
        break;
      case 'step':
        out += `<path class="prop-fill" d="M84 ${FLOOR} L84 158 L128 158 L128 ${FLOOR} Z"/>`;
        break;
    }
  }
  return out;
}

function bench(a, b) {
  const A = { x: a[0], y: a[1] }, B = { x: b[0], y: b[1] };
  const p = perp(A, B);
  const pts = [
    { x: A.x + p.x * 6, y: A.y + p.y * 6 }, { x: B.x + p.x * 6, y: B.y + p.y * 6 },
    { x: B.x - p.x * 6, y: B.y - p.y * 6 }, { x: A.x - p.x * 6, y: A.y - p.y * 6 },
  ];
  const legX = [A.x + (B.x - A.x) * 0.15, A.x + (B.x - A.x) * 0.85];
  const legY = [A.y + (B.y - A.y) * 0.15, A.y + (B.y - A.y) * 0.85];
  return `<path class="prop-fill" d="M${pts.map(q => `${n(q.x)} ${n(q.y)}`).join(' L')} Z"/>`
    + `<path class="prop" d="M${n(legX[0])} ${n(legY[0])} L${n(legX[0])} ${FLOOR}"/>`
    + `<path class="prop" d="M${n(legX[1])} ${n(legY[1])} L${n(legX[1])} ${FLOOR}"/>`;
}

/* ── figure ────────────────────────────────────────────────────────── */

function drawFigure(S) {
  const OFF = { x: -4, y: 2 };  // depth offset for the far-side limbs
  const off = (p) => ({ x: p.x + OFF.x, y: p.y + OFF.y });

  let s = '';
  // Far limbs first, behind the body.
  s += poly([off(S.sho), off(S.arm2.joint), off(S.arm2.end)], 'limb-far');
  s += poly([off(S.hip), off(S.leg2.joint), off(S.leg2.end), off(S.toe2)], 'limb-far');

  // Torso, with short bars suggesting the pelvis and shoulder girdle.
  const tp = perp(S.hip, S.sho);
  s += line(S.hip, S.sho, 'torso');
  s += line({ x: S.sho.x - tp.x * 7, y: S.sho.y - tp.y * 7 }, { x: S.sho.x + tp.x * 7, y: S.sho.y + tp.y * 7 }, 'girdle');
  s += line({ x: S.hip.x - tp.x * 6, y: S.hip.y - tp.y * 6 }, { x: S.hip.x + tp.x * 6, y: S.hip.y + tp.y * 6 }, 'girdle');

  // Near limbs.
  s += poly([S.hip, S.leg.joint, S.leg.end, S.toe], 'limb');
  s += poly([S.sho, S.arm.joint, S.arm.end], 'limb');

  // Head.
  s += line(S.sho, S.head, 'torso');
  s += circ(S.head, L.head, 'head');
  return s;
}

/* ── patterns ──────────────────────────────────────────────────────── */

/* Reusable landmarks. */
const FEET = [100, 168], FEET_L = [90, 168], FEET_R = [112, 168];

const PATTERNS = {

  /* ── horizontal press ── */
  benchPress: { tempo: 3.0, props: ['floor', 'benchFlat'], elbowBend: 1, poses: [
    { hip: [112, 114], t: 180, hand: [72, 72], ankle: [148, 168], ankle2: [140, 168], footA: 0, kneeBend: 1, elbowBend: 1 },
    { hip: [112, 114], t: 180, hand: [72, 104], ankle: [148, 168], ankle2: [140, 168], footA: 0, kneeBend: 1, elbowBend: 1 },
  ]},
  inclinePress: { tempo: 3.0, props: ['floor', 'benchIncline'], poses: [
    { hip: [110, 136], t: 155, hand: [58, 66], ankle: [140, 168], ankle2: [132, 168], kneeBend: 1, elbowBend: 1 },
    { hip: [110, 136], t: 155, hand: [56, 96], ankle: [140, 168], ankle2: [132, 168], kneeBend: 1, elbowBend: 1 },
  ]},
  declinePress: { tempo: 3.0, props: ['floor', 'benchDecline'], poses: [
    { hip: [112, 130], t: 196, hand: [72, 84], ankle: [146, 150], ankle2: [140, 152], kneeBend: 1, elbowBend: 1 },
    { hip: [112, 130], t: 196, hand: [72, 112], ankle: [146, 150], ankle2: [140, 152], kneeBend: 1, elbowBend: 1 },
  ]},
  floorPress: { tempo: 3.0, props: ['floor'], poses: [
    { hip: [112, 158], t: 180, hand: [72, 116], ankle: [146, 168], ankle2: [138, 168], kneeBend: 1, elbowBend: 1 },
    { hip: [112, 158], t: 180, hand: [72, 146], ankle: [146, 168], ankle2: [138, 168], kneeBend: 1, elbowBend: 1 },
  ]},
  chestFly: { tempo: 3.2, view: 'front', props: ['floor', 'benchFlat'], cableAnchor: [175, 40], poses: [
    { hip: [112, 114], t: 180, hand: [70, 66], hand2: [74, 66], ankle: [148, 168], ankle2: [140, 168], kneeBend: 1, elbowBend: 1 },
    { hip: [112, 114], t: 180, hand: [40, 104], hand2: [104, 104], ankle: [148, 168], ankle2: [140, 168], kneeBend: 1, elbowBend: 1 },
  ]},
  pullover: { tempo: 3.2, props: ['floor', 'benchShort'], poses: [
    { hip: [112, 126], t: 180, hand: [76, 82], ankle: [140, 168], ankle2: [132, 168], kneeBend: 1, elbowBend: 1 },
    { hip: [112, 126], t: 180, hand: [42, 118], ankle: [140, 168], ankle2: [132, 168], kneeBend: 1, elbowBend: 1 },
  ]},
  pushup: { tempo: 2.6, props: ['floor'], poses: [
    { hip: [104, 128], t: 168, hand: [58, 168], ankle: [156, 160], footA: -50, kneeBend: 1, elbowBend: 1 },
    { hip: [104, 146], t: 172, hand: [58, 168], ankle: [156, 162], footA: -50, kneeBend: 1, elbowBend: 1 },
  ]},
  pikePushup: { tempo: 2.8, props: ['floor'], poses: [
    { hip: [122, 84], t: 214, hand: [56, 168], ankle: [150, 168], footA: -40, kneeBend: 1, elbowBend: 1 },
    { hip: [122, 96], t: 218, hand: [56, 168], ankle: [150, 168], footA: -40, kneeBend: 1, elbowBend: 1 },
  ]},
  dip: { tempo: 2.8, props: ['floor'], poses: [
    { hip: [100, 108], t: 96, hand: [86, 108], ankle: [112, 150], footA: 10, kneeBend: 1, elbowBend: 1 },
    { hip: [100, 130], t: 100, hand: [86, 108], ankle: [112, 168], footA: 10, kneeBend: 1, elbowBend: 1 },
  ]},

  /* ── vertical press ── */
  overheadPress: { tempo: 3.0, props: ['floor'], cableAnchor: [24, 150], poses: [
    { hip: [100, 108], t: 90, handRel: [-4, 6], ankle: FEET_L, ankle2: FEET_R },
    { hip: [100, 108], t: 90, handRel: [-2, -40], ankle: FEET_L, ankle2: FEET_R },
  ]},
  thruster: { tempo: 3.4, props: ['floor'], poses: [
    { hip: [100, 108], t: 90, handRel: [-2, -40], ankle: FEET_L, ankle2: FEET_R },
    { hip: [96, 146], t: 66, handRel: [-4, 4], ankle: FEET_L, ankle2: FEET_R },
    { hip: [100, 108], t: 90, handRel: [-2, -40], ankle: FEET_L, ankle2: FEET_R },
  ], loop: 'cycle' },
  clean: { tempo: 3.6, props: ['floor'], poses: [
    { hip: [98, 142], t: 54, hand: [112, 158], ankle: FEET_L, ankle2: FEET_R },
    { hip: [100, 106], t: 92, hand: [100, 100], ankle: FEET_L, ankle2: FEET_R },
    { hip: [100, 106], t: 92, handRel: [-2, 4], ankle: FEET_L, ankle2: FEET_R },
  ], loop: 'cycle' },
  halo: { tempo: 3.0, props: ['floor'], poses: [
    { hip: [100, 108], t: 90, hand: [84, 56], ankle: FEET_L, ankle2: FEET_R },
    { hip: [100, 108], t: 90, hand: [116, 56], ankle: FEET_L, ankle2: FEET_R },
  ]},

  /* ── delts ── */
  lateralRaise: { tempo: 3.0, view: 'front', props: ['floor'], cableAnchor: [24, 158], poses: [
    { hip: [100, 108], t: 90, hand: [86, 110], hand2: [114, 110], ankle: FEET_L, ankle2: FEET_R },
    { hip: [100, 108], t: 90, hand: [58, 68], hand2: [142, 68], ankle: FEET_L, ankle2: FEET_R },
  ]},
  frontRaise: { tempo: 3.0, props: ['floor'], cableAnchor: [24, 158], poses: [
    { hip: [100, 108], t: 90, hand: [92, 112], ankle: FEET_L, ankle2: FEET_R },
    { hip: [100, 108], t: 90, hand: [60, 68], ankle: FEET_L, ankle2: FEET_R },
  ]},
  rearDeltFly: { tempo: 3.0, view: 'front', props: ['floor'], cableAnchor: [172, 46], poses: [
    { hip: [100, 118], t: 62, hand: [92, 140], hand2: [112, 140], ankle: FEET_L, ankle2: FEET_R, kneeBend: 1 },
    { hip: [100, 118], t: 62, hand: [56, 118], hand2: [146, 118], ankle: FEET_L, ankle2: FEET_R, kneeBend: 1 },
  ]},
  uprightRow: { tempo: 2.8, props: ['floor'], cableAnchor: [24, 158], poses: [
    { hip: [100, 108], t: 90, hand: [96, 116], ankle: FEET_L, ankle2: FEET_R },
    { hip: [100, 108], t: 90, hand: [94, 74], ankle: FEET_L, ankle2: FEET_R, elbowBend: 1 },
  ]},
  shrug: { tempo: 2.2, props: ['floor'], cableAnchor: [24, 158], poses: [
    { hip: [100, 110], t: 90, hand: [92, 116], ankle: FEET_L, ankle2: FEET_R },
    { hip: [100, 104], t: 90, hand: [92, 110], ankle: FEET_L, ankle2: FEET_R },
  ]},
  facePull: { tempo: 2.8, props: ['floor'], cableAnchor: [176, 52], poses: [
    { hip: [100, 108], t: 90, hand: [140, 76], ankle: FEET_L, ankle2: FEET_R },
    { hip: [100, 108], t: 90, hand: [108, 58], ankle: FEET_L, ankle2: FEET_R, elbowBend: 1 },
  ]},

  /* ── arms ── */
  curl: { tempo: 2.8, props: ['floor'], cableAnchor: [24, 158], poses: [
    { hip: [100, 108], t: 90, hand: [98, 116], ankle: FEET_L, ankle2: FEET_R },
    { hip: [100, 108], t: 90, hand: [88, 74], ankle: FEET_L, ankle2: FEET_R },
  ]},
  preacherCurl: { tempo: 2.8, props: ['floor', 'preacherPad'], poses: [
    { hip: [92, 128], t: 74, hand: [124, 92], ankle: [96, 168], ankle2: [104, 168], kneeBend: 1 },
    { hip: [92, 128], t: 74, hand: [104, 70], ankle: [96, 168], ankle2: [104, 168], kneeBend: 1 },
  ]},
  triPushdown: { tempo: 2.6, props: ['floor'], cableAnchor: [172, 34], poses: [
    { hip: [100, 108], t: 88, hand: [116, 82], ankle: FEET_L, ankle2: FEET_R, elbowBend: 1 },
    { hip: [100, 108], t: 88, hand: [116, 118], ankle: FEET_L, ankle2: FEET_R, elbowBend: 1 },
  ]},
  triOverhead: { tempo: 2.8, props: ['floor'], cableAnchor: [24, 150], poses: [
    { hip: [100, 108], t: 90, hand: [104, 30], ankle: FEET_L, ankle2: FEET_R },
    { hip: [100, 108], t: 90, hand: [128, 62], ankle: FEET_L, ankle2: FEET_R, elbowBend: 1 },
  ]},
  skullcrusher: { tempo: 2.8, props: ['floor', 'benchFlat'], poses: [
    { hip: [112, 114], t: 180, hand: [72, 74], ankle: [148, 168], ankle2: [140, 168], kneeBend: 1, elbowBend: 1 },
    { hip: [112, 114], t: 180, hand: [50, 104], ankle: [148, 168], ankle2: [140, 168], kneeBend: 1, elbowBend: 1 },
  ]},
  kickback: { tempo: 2.6, props: ['floor'], cableAnchor: [24, 100], poses: [
    { hip: [104, 120], t: 56, hand: [92, 120], ankle: FEET_L, ankle2: FEET_R, kneeBend: 1, elbowBend: 1 },
    { hip: [104, 120], t: 56, hand: [128, 122], ankle: FEET_L, ankle2: FEET_R, kneeBend: 1, elbowBend: 1 },
  ]},

  /* ── back ── */
  row: { tempo: 2.8, props: ['floor'], poses: [
    { hip: [104, 118], t: 52, hand: [82, 150], ankle: FEET_L, ankle2: FEET_R, kneeBend: 1 },
    { hip: [104, 118], t: 52, hand: [86, 118], ankle: FEET_L, ankle2: FEET_R, kneeBend: 1 },
  ]},
  seatedRow: { tempo: 2.8, props: ['floor', 'seat'], cableAnchor: [22, 122], poses: [
    { hip: [96, 122], t: 74, hand: [50, 118], ankle: [56, 158], ankle2: [62, 160], kneeBend: 1 },
    { hip: [96, 122], t: 96, hand: [84, 112], ankle: [56, 158], ankle2: [62, 160], kneeBend: 1, elbowBend: 1 },
  ]},
  invertedRow: { tempo: 2.8, props: ['floor', 'lowBar'], poses: [
    { hip: [104, 148], t: 172, hand: [100, 118], ankle: [158, 168], footA: -60, elbowBend: 1 },
    { hip: [104, 130], t: 172, hand: [100, 118], ankle: [158, 168], footA: -60, elbowBend: 1 },
  ]},
  pulldown: { tempo: 3.0, props: ['floor', 'seat'], cableAnchor: [100, 20], poses: [
    { hip: [100, 122], t: 86, hand: [100, 36], ankle: [88, 160], ankle2: [96, 162], kneeBend: 1 },
    { hip: [100, 122], t: 80, hand: [100, 70], ankle: [88, 160], ankle2: [96, 162], kneeBend: 1, elbowBend: 1 },
  ]},
  straightArmPulldown: { tempo: 2.8, props: ['floor'], cableAnchor: [100, 22], poses: [
    { hip: [100, 112], t: 78, hand: [104, 60], ankle: FEET_L, ankle2: FEET_R },
    { hip: [100, 112], t: 72, hand: [110, 110], ankle: FEET_L, ankle2: FEET_R },
  ]},
  pullup: { tempo: 3.2, props: ['pullupBar'], poses: [
    { hip: [100, 118], t: 88, hand: [100, 22], ankle: [104, 176], footA: 10 },
    { hip: [100, 90], t: 88, hand: [100, 22], ankle: [106, 150], footA: 10, elbowBend: 1, kneeBend: 1 },
  ]},
  hangingLegRaise: { tempo: 3.0, props: ['pullupBar'], poses: [
    { hip: [100, 108], t: 88, hand: [100, 22], ankle: [104, 166], footA: 10 },
    { hip: [100, 108], t: 96, hand: [100, 22], ankle: [148, 106], footA: 10, kneeBend: 1 },
  ]},

  /* ── legs ── */
  squat: { tempo: 3.2, props: ['floor'], poses: [
    { hip: [100, 108], t: 90, handRel: [-20, -1], ankle: FEET_L, ankle2: FEET_R },
    { hip: [94, 146], t: 64, handRel: [-20, -1], ankle: FEET_L, ankle2: FEET_R },
  ]},
  frontSquat: { tempo: 3.2, props: ['floor'], poses: [
    { hip: [100, 108], t: 90, hand: [104, 78], ankle: FEET_L, ankle2: FEET_R, elbowBend: 1 },
    { hip: [96, 146], t: 74, hand: [110, 112], ankle: FEET_L, ankle2: FEET_R, elbowBend: 1 },
  ]},
  wallSit: { tempo: 4.0, props: ['floor', 'wall'], poses: [
    { hip: [136, 136], t: 92, hand: [128, 140], ankle: [106, 168], ankle2: [114, 168] },
    { hip: [136, 138], t: 92, hand: [128, 142], ankle: [106, 168], ankle2: [114, 168] },
  ]},
  lunge: { tempo: 3.2, props: ['floor'], poses: [
    { hip: [100, 108], t: 90, hand: [92, 118], ankle: [86, 168], ankle2: [112, 168] },
    { hip: [100, 138], t: 88, hand: [92, 148], ankle: [72, 168], ankle2: [132, 168], footA2: -30 },
  ]},
  legPress: { tempo: 3.0, props: ['floor', 'sled'], poses: [
    { hip: [128, 140], t: 168, hand: [110, 128], ankle: [56, 82], footA: 150, kneeBend: 1, elbowBend: 1 },
    { hip: [128, 140], t: 168, hand: [110, 128], ankle: [92, 110], footA: 150, kneeBend: 1, elbowBend: 1 },
  ]},
  legExtension: { tempo: 2.8, props: ['floor', 'seat', 'legExtPad'], poses: [
    { hip: [90, 124], t: 92, hand: [76, 128], ankle: [104, 160], kneeBend: 1 },
    { hip: [90, 124], t: 92, hand: [76, 128], ankle: [148, 122], kneeBend: 1 },
  ]},
  legCurl: { tempo: 2.8, props: ['floor', 'benchFlat', 'legCurlPad'], poses: [
    { hip: [104, 114], t: 176, hand: [70, 122], ankle: [140, 152], footA: -40, kneeBend: -1 },
    { hip: [104, 114], t: 176, hand: [70, 122], ankle: [116, 88], footA: -40, kneeBend: -1 },
  ]},
  calfRaise: { tempo: 2.2, props: ['floor'], poses: [
    { hip: [100, 108], t: 90, hand: [92, 118], ankle: [100, 168], footA: 0 },
    { hip: [100, 96], t: 90, hand: [92, 106], ankle: [100, 156], footA: -46 },
  ]},
  nordicCurl: { tempo: 3.4, props: ['floor'], poses: [
    { hip: [100, 118], t: 90, hand: [92, 128], ankle: [100, 158], footA: 0, kneeBend: 1 },
    { hip: [116, 140], t: 152, hand: [70, 164], ankle: [116, 168], footA: -20, kneeBend: 1, elbowBend: 1 },
  ]},

  /* ── hinge & glutes ── */
  deadlift: { tempo: 3.4, props: ['floor'], poses: [
    { hip: [100, 108], t: 90, hand: [98, 116], ankle: FEET_L, ankle2: FEET_R },
    { hip: [98, 140], t: 50, hand: [110, 160], ankle: FEET_L, ankle2: FEET_R, kneeBend: 1 },
  ]},
  rdl: { tempo: 3.2, props: ['floor'], cableAnchor: [24, 158], poses: [
    { hip: [100, 108], t: 90, hand: [98, 116], ankle: FEET_L, ankle2: FEET_R },
    { hip: [106, 118], t: 32, hand: [116, 146], ankle: FEET_L, ankle2: FEET_R },
  ]},
  /* Same hinge as the RDL, but the bar rides on the shoulders. */
  goodMorning: { tempo: 3.2, props: ['floor'], poses: [
    { hip: [100, 108], t: 90, handRel: [-20, -1], ankle: FEET_L, ankle2: FEET_R },
    { hip: [106, 116], t: 32, handRel: [-18, -6], ankle: FEET_L, ankle2: FEET_R },
  ]},
  kbSwing: { tempo: 2.6, props: ['floor'], poses: [
    { hip: [106, 122], t: 40, hand: [86, 138], ankle: FEET_L, ankle2: FEET_R, kneeBend: 1 },
    { hip: [100, 108], t: 92, hand: [130, 84], ankle: FEET_L, ankle2: FEET_R },
  ]},
  hipThrust: { tempo: 2.8, props: ['floor', 'benchShort'], poses: [
    { hip: [96, 154], t: 32, hand: [116, 130], ankle: [62, 168], ankle2: [70, 168], kneeBend: -1, elbowBend: 1 },
    { hip: [96, 126], t: 6, hand: [116, 124], ankle: [62, 168], ankle2: [70, 168], kneeBend: -1, elbowBend: 1 },
  ]},
  gluteBridge: { tempo: 2.6, props: ['floor'], poses: [
    { hip: [100, 166], t: 8, hand: [140, 168], ankle: [66, 168], ankle2: [74, 168], kneeBend: -1 },
    { hip: [100, 138], t: 8, hand: [140, 168], ankle: [66, 168], ankle2: [74, 168], kneeBend: -1 },
  ]},
  gluteKickback: { tempo: 2.6, props: ['floor'], cableAnchor: [26, 162], poses: [
    { hip: [100, 112], t: 78, hand: [92, 120], ankle: [96, 168], ankle2: [104, 168] },
    { hip: [100, 112], t: 66, hand: [92, 120], ankle: [96, 168], ankle2: [142, 148], kneeBend: 1 },
  ]},
  backExtension: { tempo: 3.0, props: ['floor', 'benchIncline'], poses: [
    { hip: [104, 128], t: 224, hand: [92, 108], ankle: [140, 162], ankle2: [132, 164], elbowBend: 1 },
    { hip: [104, 128], t: 166, hand: [70, 96], ankle: [140, 162], ankle2: [132, 164], elbowBend: 1 },
  ]},
  superman: { tempo: 2.6, props: ['floor'], poses: [
    { hip: [104, 164], t: 178, hand: [44, 166], ankle: [162, 166], footA: -20 },
    { hip: [104, 164], t: 190, hand: [42, 148], ankle: [160, 150], footA: -20 },
  ]},

  /* ── core ── */
  plank: { tempo: 3.6, props: ['floor'], poses: [
    { hip: [104, 134], t: 172, hand: [56, 162], ankle: [158, 164], footA: -55, elbowBend: 1 },
    { hip: [104, 136], t: 172, hand: [56, 162], ankle: [158, 164], footA: -55, elbowBend: 1 },
  ]},
  sidePlank: { tempo: 3.6, view: 'front', props: ['floor'], poses: [
    { hip: [104, 128], t: 168, hand: [58, 164], hand2: [104, 88], ankle: [158, 164], footA: -40, elbowBend: 1 },
    { hip: [104, 130], t: 168, hand: [58, 164], hand2: [104, 88], ankle: [158, 164], footA: -40, elbowBend: 1 },
  ]},
  hollowHold: { tempo: 3.4, props: ['floor'], poses: [
    { hip: [104, 152], t: 200, hand: [44, 138], ankle: [162, 140], footA: -20 },
    { hip: [104, 154], t: 200, hand: [42, 134], ankle: [164, 136], footA: -20 },
  ]},
  crunch: { tempo: 2.4, props: ['floor'], poses: [
    { hip: [110, 160], t: 182, hand: [76, 146], ankle: [66, 168], ankle2: [74, 168], kneeBend: -1, elbowBend: 1 },
    { hip: [110, 160], t: 208, hand: [82, 132], ankle: [66, 168], ankle2: [74, 168], kneeBend: -1, elbowBend: 1 },
  ]},
  situp: { tempo: 2.8, props: ['floor'], poses: [
    { hip: [116, 160], t: 182, hand: [82, 146], ankle: [68, 168], ankle2: [76, 168], kneeBend: -1, elbowBend: 1 },
    { hip: [116, 158], t: 236, hand: [92, 116], ankle: [68, 168], ankle2: [76, 168], kneeBend: -1, elbowBend: 1 },
  ]},
  bicycleCrunch: { tempo: 2.4, props: ['floor'], poses: [
    { hip: [110, 158], t: 200, hand: [84, 132], hand2: [92, 128], ankle: [70, 150], ankle2: [154, 132], kneeBend: -1, elbowBend: 1 },
    { hip: [110, 158], t: 200, hand: [84, 132], hand2: [92, 128], ankle: [152, 134], ankle2: [72, 148], kneeBend: -1, elbowBend: 1 },
  ]},
  legRaise: { tempo: 2.8, props: ['floor'], poses: [
    { hip: [96, 162], t: 178, hand: [56, 166], ankle: [156, 164], footA: -20 },
    { hip: [96, 162], t: 178, hand: [56, 166], ankle: [104, 104], footA: -20 },
  ]},
  russianTwist: { tempo: 2.4, view: 'front', props: ['floor'], poses: [
    { hip: [110, 158], t: 208, hand: [66, 122], ankle: [66, 152], ankle2: [74, 154], kneeBend: -1, elbowBend: 1 },
    { hip: [110, 158], t: 208, hand: [106, 116], ankle: [66, 152], ankle2: [74, 154], kneeBend: -1, elbowBend: 1 },
  ]},
  sideBend: { tempo: 2.6, view: 'front', props: ['floor'], poses: [
    { hip: [100, 108], t: 90, hand: [86, 122], hand2: [116, 116], ankle: FEET_L, ankle2: FEET_R },
    { hip: [100, 108], t: 74, hand: [80, 140], hand2: [122, 106], ankle: FEET_L, ankle2: FEET_R },
  ]},
  woodchop: { tempo: 2.6, view: 'front', props: ['floor'], cableAnchor: [172, 34], poses: [
    { hip: [100, 110], t: 104, hand: [140, 54], ankle: FEET_L, ankle2: FEET_R },
    { hip: [100, 114], t: 74, hand: [64, 148], ankle: FEET_L, ankle2: FEET_R, kneeBend: 1 },
  ]},
  cableCrunch: { tempo: 2.6, props: ['floor', 'mat'], cableAnchor: [100, 22], poses: [
    { hip: [100, 148], t: 96, hand: [92, 62], ankle: [116, 168], footA: -40, kneeBend: 1, elbowBend: 1 },
    { hip: [100, 148], t: 132, hand: [88, 84], ankle: [116, 168], footA: -40, kneeBend: 1, elbowBend: 1 },
  ]},
  abWheel: { tempo: 3.2, props: ['floor'], poses: [
    { hip: [104, 132], t: 130, hand: [72, 168], ankle: [116, 168], footA: -40, kneeBend: 1 },
    { hip: [110, 152], t: 172, hand: [36, 168], ankle: [150, 168], footA: -40, kneeBend: 1 },
  ]},
  birdDog: { tempo: 3.0, props: ['floor'], poses: [
    { hip: [110, 130], t: 176, hand: [64, 168], hand2: [66, 166], ankle: [120, 168], ankle2: [126, 166], footA: -40, kneeBend: 1, elbowBend: 1 },
    { hip: [110, 130], t: 176, hand: [36, 116], hand2: [66, 166], ankle: [166, 118], ankle2: [126, 166], footA: -20, kneeBend: 1, elbowBend: 1 },
  ]},
  deadBug: { tempo: 3.0, props: ['floor'], poses: [
    { hip: [104, 162], t: 178, hand: [70, 120], hand2: [72, 124], ankle: [140, 122], ankle2: [136, 126], kneeBend: -1 },
    { hip: [104, 162], t: 178, hand: [40, 152], hand2: [72, 124], ankle: [166, 158], ankle2: [136, 126], kneeBend: -1 },
  ]},
  mountainClimber: { tempo: 1.4, props: ['floor'], poses: [
    { hip: [110, 134], t: 172, hand: [60, 168], ankle: [162, 162], ankle2: [128, 150], footA: -50, kneeBend: 1, elbowBend: 1 },
    { hip: [110, 134], t: 172, hand: [60, 168], ankle: [126, 148], ankle2: [162, 162], footA: -50, kneeBend: 1, elbowBend: 1 },
  ]},

  /* ── conditioning ── */
  burpee: { tempo: 3.6, props: ['floor'], poses: [
    { hip: [100, 100], t: 90, hand: [100, 34], ankle: [94, 164], ankle2: [106, 164], footA: -20 },
    { hip: [98, 146], t: 62, hand: [116, 166], ankle: FEET_L, ankle2: FEET_R, kneeBend: 1 },
    { hip: [106, 146], t: 172, hand: [60, 168], ankle: [158, 166], footA: -50, kneeBend: 1, elbowBend: 1 },
    { hip: [98, 146], t: 62, hand: [116, 166], ankle: FEET_L, ankle2: FEET_R, kneeBend: 1 },
  ], loop: 'cycle' },
  jumpingJack: { tempo: 1.6, view: 'front', props: ['floor'], poses: [
    { hip: [100, 108], t: 90, hand: [90, 118], hand2: [110, 118], ankle: [96, 168], ankle2: [104, 168] },
    { hip: [100, 104], t: 90, hand: [66, 34], hand2: [134, 34], ankle: [64, 168], ankle2: [136, 168] },
  ]},
  run: { tempo: 1.2, props: ['floor'], poses: [
    { hip: [100, 106], t: 96, hand: [80, 104], hand2: [122, 116], ankle: [72, 158], ankle2: [126, 150], footA: -30, kneeBend: 1, elbowBend: 1 },
    { hip: [100, 102], t: 96, hand: [122, 104], hand2: [80, 116], ankle: [128, 148], ankle2: [74, 160], footA: -30, kneeBend: 1, elbowBend: 1 },
  ]},
  jumpRope: { tempo: 1.0, view: 'front', props: ['floor'], poses: [
    { hip: [100, 108], t: 90, hand: [80, 120], hand2: [120, 120], ankle: [96, 168], ankle2: [104, 168] },
    { hip: [100, 98], t: 90, hand: [80, 116], hand2: [120, 116], ankle: [96, 160], ankle2: [104, 160], footA: -40 },
  ]},
  cycle: { tempo: 1.4, props: ['floor', 'bike'], poses: [
    { hip: [116, 116], t: 62, hand: [150, 122], ankle: [70, 132], ankle2: [56, 160], kneeBend: 1, elbowBend: 1 },
    { hip: [116, 116], t: 62, hand: [150, 122], ankle: [54, 160], ankle2: [72, 132], kneeBend: 1, elbowBend: 1 },
  ]},
  rowErg: { tempo: 2.4, props: ['floor', 'ergRail'], poses: [
    { hip: [82, 140], t: 62, hand: [46, 138], ankle: [44, 152], ankle2: [50, 154], kneeBend: 1, elbowBend: 1 },
    { hip: [124, 140], t: 108, hand: [96, 134], ankle: [46, 152], ankle2: [52, 154], elbowBend: 1 },
  ]},
  swim: { tempo: 2.0, props: ['water'], poses: [
    { hip: [110, 128], t: 176, hand: [46, 108], hand2: [92, 140], ankle: [166, 134], footA: -20 },
    { hip: [110, 128], t: 176, hand: [64, 96], hand2: [96, 132], ankle: [164, 124], footA: -20 },
  ]},
  carry: { tempo: 1.8, props: ['floor'], poses: [
    { hip: [100, 108], t: 92, hand: [92, 118], hand2: [96, 120], ankle: [86, 166], ankle2: [116, 160], footA: -10, kneeBend: 1 },
    { hip: [100, 108], t: 92, hand: [92, 118], hand2: [96, 120], ankle: [118, 158], ankle2: [84, 166], footA: -10, kneeBend: 1 },
  ]},
  getup: { tempo: 4.0, props: ['floor'], poses: [
    { hip: [104, 162], t: 178, hand: [72, 112], ankle: [154, 166], footA: -20, elbowBend: 1 },
    { hip: [112, 152], t: 132, hand: [96, 84], ankle: [78, 168], ankle2: [148, 164], kneeBend: 1 },
    { hip: [100, 112], t: 90, hand: [100, 32], ankle: FEET_L, ankle2: FEET_R },
  ], loop: 'cycle' },
};

/* ── public API ────────────────────────────────────────────────────── */

const easeInOut = (u) => u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;

function patternFor(ex) {
  return PATTERNS[ex.pattern] || PATTERNS.squat;
}

/* Equipment kind actually drawn for an exercise. */
function equipFor(ex) {
  switch (ex.eq) {
    case 'barbell': return 'barbell';
    case 'dumbbell': return 'dumbbell';
    case 'kettlebell': return 'kettlebell';
    case 'cable': return 'cable';
    case 'band': return 'band';
    case 'machine': return ex.pattern === 'pulldown' || ex.pattern === 'seatedRow' ? 'cable' : 'none';
    default: return 'none';
  }
}

/* One frame of SVG innerHTML at phase u. Any real number is accepted and
 * wrapped into [0,1): a requestAnimationFrame timestamp can legitimately
 * predate the start time captured just before it, which would otherwise index
 * poses[-1]. */
function frameSVG(ex, phase) {
  const pat = patternFor(ex);
  const poses = pat.poses;
  const u = Number.isFinite(phase) ? ((phase % 1) + 1) % 1 : 0;
  const last = poses.length - 1;
  let a, b, uu;
  if (pat.loop === 'cycle') {
    const seg = u * poses.length;
    const i = Math.min(last, Math.max(0, Math.floor(seg)));
    a = poses[i]; b = poses[(i + 1) % poses.length]; uu = seg - Math.floor(seg);
  } else {
    // Ping-pong: out and back through the key poses.
    const tri = u < 0.5 ? u * 2 : (1 - u) * 2;
    const seg = tri * last;
    const i = Math.min(last - 1, Math.max(0, Math.floor(seg)));
    a = poses[i]; b = poses[i + 1]; uu = seg - i;
  }
  const S = resolve(blend(a, b, easeInOut(uu)));
  return drawProps(pat) + drawEquip(equipFor(ex), S, pat) + drawFigure(S);
}

/* Render a single still frame (used for list thumbnails — no rAF cost). */
export function renderStill(svgEl, ex, phase = 0.5) {
  svgEl.innerHTML = frameSVG(ex, phase);
}

/* Animate into an <svg>. Returns a stop() function. Capped at 30fps; pauses
 * automatically when the page is hidden. */
export function animate(svgEl, ex) {
  const pat = patternFor(ex);
  const period = (pat.tempo || 3) * 1000;
  let raf = 0, last = 0, start = performance.now(), stopped = false;

  // Paint one frame straight away. requestAnimationFrame does not run while
  // the tab is not painting, and waiting for it would show an empty box.
  svgEl.innerHTML = frameSVG(ex, 0);

  function tick(now) {
    if (stopped) return;
    raf = requestAnimationFrame(tick);
    if (now - last < 33) return;             // ~30fps
    last = now;
    if (document.hidden) return;
    svgEl.innerHTML = frameSVG(ex, (now - start) / period);
  }
  raf = requestAnimationFrame(tick);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}

export { PATTERNS };
