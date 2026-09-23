// Leaf-sway build for tree_fg_04_smalltree_withered.svg (the withered/dying
// state of the same small tree). Does NOT touch the source SVG or any other
// build's output -- writes only to public/_test_leaf_sway_withered.json (plus
// a debug HTML player alongside it).
//
// Unlike the healthy 43-sway/19-static split, ALL 8 withered leaves sway
// (there are only 8 total, all treated the same); trunk_x5F_main stays fully
// static, same as the healthy build. Four leaves (leaf_02, leaf_07, leaf_04,
// leaf_06 -- picked to be spatially spread around the tree, not clustered)
// detach and fall to the ground in relay, one after another, partway through
// the 30s loop instead of just swaying.
import fs from "node:fs";
import path from "node:path";
import parseSvgPath from "parse-svg-path";
import absSvgPath from "abs-svg-path";

const SRC = "../tree-stages/tree_fg_04_smalltree_withered.svg";
const OUT_JSON = "public/_test_leaf_sway_withered.json";
const FPS = 30;
const OP = 900; // 30s loop, matches the background scene's master loop length
const CANVAS_W = 1000;
const CANVAS_H = 1000;

const svgText = fs.readFileSync(SRC, "utf8");
const defsEnd = svgText.indexOf("</defs>") + "</defs>".length;
const defsText = svgText.slice(0, defsEnd);
const bodyText = svgText.slice(defsEnd);

// ---------- attribute helpers ----------
function getAttr(tag, name) {
  const m = tag.match(new RegExp("\\s" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '="([^"]*)"'));
  return m ? m[1] : null;
}

// ---------- CSS class fills (not used here -- withered SVG uses direct fill="url(...)" -- kept for parity) ----------
const styleMatch = defsText.match(/<style>([\s\S]*?)<\/style>/);
const classFillMap = {};
if (styleMatch) {
  const ruleRe = /\.(\S+)\s*\{([^}]*)\}/g;
  let rm;
  while ((rm = ruleRe.exec(styleMatch[1]))) {
    const fillMatch = rm[2].match(/fill:\s*([^;]+);?/);
    if (fillMatch) classFillMap[rm[1]] = fillMatch[1].trim();
  }
}

// ---------- gradients ----------
const gradientTags = defsText.match(
  /<linearGradient\b[^>]*\/>|<linearGradient\b[^>]*[^/]>[\s\S]*?<\/linearGradient>/g
) || [];
const rawGradients = {};
for (const tag of gradientTags) {
  const id = getAttr(tag, "id");
  const href = getAttr(tag, "xlink:href");
  const x1 = getAttr(tag, "x1");
  const y1 = getAttr(tag, "y1");
  const x2 = getAttr(tag, "x2");
  const y2 = getAttr(tag, "y2");
  const gradientTransform = getAttr(tag, "gradientTransform");
  const stops = [];
  const stopMatches = tag.match(/<stop[^>]*\/>/g);
  if (stopMatches) {
    for (const s of stopMatches) {
      stops.push({ offset: parseFloat(getAttr(s, "offset")), color: getAttr(s, "stop-color") });
    }
  }
  rawGradients[id] = {
    href: href ? href.replace("#", "") : null,
    x1: x1 !== null ? parseFloat(x1) : null,
    y1: y1 !== null ? parseFloat(y1) : null,
    x2: x2 !== null ? parseFloat(x2) : null,
    y2: y2 !== null ? parseFloat(y2) : null,
    gradientTransform,
    stops,
  };
}

// full 2D affine composition (translate/rotate/scale/matrix) -- see
// project-composite-debug / the leaf_09+leaf_11 gradient-rotate bug fix in
// build-leaf-sway-full.mjs for why naive translate+scale-only parsing is
// wrong.
function matMul(m1, m2) {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2, b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2, b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1,
  ];
}

function parseTransformList(t) {
  let matrix = [1, 0, 0, 1, 0, 0];
  if (!t) return matrix;
  const funcRe = /(\w+)\(([^)]*)\)/g;
  let fm;
  while ((fm = funcRe.exec(t))) {
    const fn = fm[1];
    const args = fm[2].trim().split(/[\s,]+/).map(Number);
    let m;
    if (fn === "translate") {
      m = [1, 0, 0, 1, args[0] || 0, args[1] !== undefined ? args[1] : 0];
    } else if (fn === "scale") {
      const sx = args[0], sy = args[1] !== undefined ? args[1] : sx;
      m = [sx, 0, 0, sy, 0, 0];
    } else if (fn === "rotate") {
      const rad = (args[0] * Math.PI) / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const rot = [cos, sin, -sin, cos, 0, 0];
      if (args[1] !== undefined && args[2] !== undefined) {
        const [, cx, cy] = args;
        m = matMul(matMul([1, 0, 0, 1, cx, cy], rot), [1, 0, 0, 1, -cx, -cy]);
      } else {
        m = rot;
      }
    } else if (fn === "matrix") {
      m = args;
    } else if (fn === "skewX") {
      m = [1, 0, Math.tan((args[0] * Math.PI) / 180), 1, 0, 0];
    } else if (fn === "skewY") {
      m = [1, Math.tan((args[0] * Math.PI) / 180), 0, 1, 0, 0];
    } else {
      continue;
    }
    matrix = matMul(matrix, m);
  }
  return matrix;
}

function applyMatrix(m, x, y) {
  const [a, b, c, d, e, f] = m;
  return [a * x + c * y + e, b * x + d * y + f];
}

function resolveGradient(id) {
  const g = rawGradients[id];
  let stops = g.stops;
  let x1 = g.x1, y1 = g.y1, x2 = g.x2, y2 = g.y2;
  if (g.href && stops.length === 0) stops = resolveGradient(g.href).stops;
  if (x1 === null) {
    const base = resolveGradient(g.href);
    x1 = base.x1; y1 = base.y1; x2 = base.x2; y2 = base.y2;
  }
  const matrix = parseTransformList(g.gradientTransform);
  const [rx1, ry1] = applyMatrix(matrix, x1, y1);
  const [rx2, ry2] = applyMatrix(matrix, x2, y2);
  return { x1: rx1, y1: ry1, x2: rx2, y2: ry2, stops };
}

function hexToRgb1(hex) {
  hex = hex.replace("#", "");
  return [
    parseInt(hex.substring(0, 2), 16) / 255,
    parseInt(hex.substring(2, 4), 16) / 255,
    parseInt(hex.substring(4, 6), 16) / 255,
  ];
}

function makeSolidFill(hex) {
  const [r, g, b] = hexToRgb1(hex);
  return { ty: "fl", nm: "fill", c: { a: 0, k: [r, g, b, 1] }, o: { a: 0, k: 100 } };
}

function makeGradientFill(gradId) {
  const grad = resolveGradient(gradId);
  const gs = grad.stops.slice().sort((a, b) => a.offset - b.offset).map((s) => ({ offset: s.offset, rgb: hexToRgb1(s.color) }));
  const k = [];
  for (const s of gs) k.push(s.offset, ...s.rgb);
  return {
    ty: "gf", nm: "gradient-fill", o: { a: 0, k: 100 }, t: 1,
    s: { a: 0, k: [grad.x1, grad.y1] }, e: { a: 0, k: [grad.x2, grad.y2] },
    g: { p: gs.length, k: { a: 0, k } },
  };
}

function getFill(raw) {
  const fillAttr = getAttr(raw, "fill");
  if (fillAttr) return fillAttr;
  const className = getAttr(raw, "class");
  if (className && classFillMap[className]) return classFillMap[className];
  return null;
}

function fillItemFor(fillAttr) {
  if (!fillAttr) return makeSolidFill("#000000");
  const urlMatch = fillAttr.match(/url\(#(.*)\)/);
  if (urlMatch) return makeGradientFill(urlMatch[1]);
  return makeSolidFill(fillAttr);
}

// ---------- path d -> lottie shape ----------
function svgPathToLottieShape(d) {
  const segs = absSvgPath(parseSvgPath(d));
  const subpaths = [];
  let current = null;
  let cx = 0, cy = 0, sx = 0, sy = 0, prevCtrl = null, prevType = null;

  function pushVertex(x, y) { current.vertices.push({ v: [x, y], i: [0, 0], o: [0, 0] }); }
  function setOutOfLast(dx, dy) { current.vertices[current.vertices.length - 1].o = [dx, dy]; }

  for (const seg of segs) {
    const type = seg[0];
    if (type === "M") {
      current = { vertices: [], closed: false };
      subpaths.push(current);
      cx = seg[1]; cy = seg[2]; sx = cx; sy = cy;
      pushVertex(cx, cy);
      prevType = "M";
    } else if (type === "L") {
      cx = seg[1]; cy = seg[2]; pushVertex(cx, cy); prevType = "L";
    } else if (type === "H") {
      cx = seg[1]; pushVertex(cx, cy); prevType = "H";
    } else if (type === "V") {
      cy = seg[1]; pushVertex(cx, cy); prevType = "V";
    } else if (type === "C") {
      const [x1, y1, x2, y2, x, y] = seg.slice(1);
      setOutOfLast(x1 - cx, y1 - cy);
      current.vertices.push({ v: [x, y], i: [x2 - x, y2 - y], o: [0, 0] });
      prevCtrl = [x2, y2]; cx = x; cy = y; prevType = "C";
    } else if (type === "S") {
      const [x2, y2, x, y] = seg.slice(1);
      let x1, y1;
      if (prevType === "C" || prevType === "S") { x1 = cx + (cx - prevCtrl[0]); y1 = cy + (cy - prevCtrl[1]); }
      else { x1 = cx; y1 = cy; }
      setOutOfLast(x1 - cx, y1 - cy);
      current.vertices.push({ v: [x, y], i: [x2 - x, y2 - y], o: [0, 0] });
      prevCtrl = [x2, y2]; cx = x; cy = y; prevType = "S";
    } else if (type === "Z" || type === "z") {
      current.closed = true; cx = sx; cy = sy; prevType = "Z";
    } else {
      throw new Error("Unsupported segment type: " + type + " in path: " + d);
    }
  }

  return subpaths.map((sp) => ({
    closed: sp.closed,
    v: sp.vertices.map((pt) => pt.v),
    i: sp.vertices.map((pt) => pt.i),
    o: sp.vertices.map((pt) => pt.o),
  }));
}

function identityTransform() {
  return {
    ty: "tr",
    p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] },
    s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 },
  };
}

function shapeItemFor(el) {
  const contours = svgPathToLottieShape(el.d);
  const it = contours.map((c, i) => ({
    ty: "sh", nm: "path-" + i,
    ks: { a: 0, k: { c: c.closed, v: c.v, i: c.i, o: c.o } },
  }));
  it.push(fillItemFor(el.fill));
  it.push(identityTransform());
  return { ty: "gr", nm: el.id, it };
}

function baseLayerTransform() {
  return {
    o: { a: 0, k: 100 }, r: { a: 0, k: 0 },
    p: { a: 0, k: [0, 0, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] },
  };
}

// ---------- extract all top-level <path> elements in document order ----------
const pathRe = /<path\b([^>]*?)\/>/g;
const allElements = [];
let m;
while ((m = pathRe.exec(bodyText))) {
  const raw = m[0];
  const id = getAttr(raw, "id");
  const leafGroup = getAttr(raw, "data-leaf-group") || (/^leaf_\d+$/.test(id) ? id : null);
  allElements.push({ id, d: getAttr(raw, "d"), fill: getFill(raw), leafGroup });
}
console.log("Total <path> elements:", allElements.length);

// ---------- leaf groups: all 8 sway (no static split for this sparse tree) ----------
const SWAY_IDS = ["leaf_01", "leaf_02", "leaf_03", "leaf_04", "leaf_05", "leaf_06", "leaf_07", "leaf_08"];
const SWAY_SET = new Set(SWAY_IDS);

const allLeafGroups = new Set(allElements.map((el) => el.leafGroup).filter(Boolean));
for (const g of allLeafGroups) {
  if (!SWAY_SET.has(g)) throw new Error("Unexpected leaf group in SVG not in SWAY_IDS: " + g);
}
for (const g of SWAY_IDS) {
  if (!allLeafGroups.has(g)) throw new Error("Expected leaf group missing from SVG: " + g);
}
console.log("Leaf groups OK:", allLeafGroups.size, "(all sway)");

// ---------- reference geometry for anchor-finding: trunk_x5F_main only ----------
const REF_IDS = new Set(["trunk_x5F_main"]);
const refElements = allElements.filter((el) => REF_IDS.has(el.id));
if (refElements.length !== REF_IDS.size) {
  throw new Error("Expected trunk_x5F_main, found " + refElements.length + " matching elements");
}
const refVerts = [];
let trunkBbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
for (const el of refElements) {
  for (const contour of svgPathToLottieShape(el.d)) {
    for (const v of contour.v) {
      refVerts.push(v);
      trunkBbox.minX = Math.min(trunkBbox.minX, v[0]);
      trunkBbox.maxX = Math.max(trunkBbox.maxX, v[0]);
      trunkBbox.minY = Math.min(trunkBbox.minY, v[1]);
      trunkBbox.maxY = Math.max(trunkBbox.maxY, v[1]);
    }
  }
}
console.log("Reference (trunk) vertices:", refVerts.length, "bbox:", trunkBbox);

// ---------- anchor finding: for each sway leaf, the leaf vertex closest to the trunk ----------
function leafVertices(leafGroup) {
  const parts = allElements.filter((el) => el.leafGroup === leafGroup);
  const verts = [];
  for (const el of parts) {
    for (const contour of svgPathToLottieShape(el.d)) {
      for (const v of contour.v) verts.push(v);
    }
  }
  return verts;
}

function findAnchor(leafGroup) {
  const verts = leafVertices(leafGroup);
  let best = null, bestDist = Infinity;
  for (const v of verts) {
    for (const rv of refVerts) {
      const dx = v[0] - rv[0], dy = v[1] - rv[1];
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) { bestDist = dist; best = v; }
    }
  }
  return { anchor: best, dist: Math.sqrt(bestDist) };
}

const ANCHORS = {};
for (const leafGroup of SWAY_IDS) {
  const { anchor, dist } = findAnchor(leafGroup);
  ANCHORS[leafGroup] = anchor;
  console.log(" ", leafGroup.padEnd(9), anchor.map((n) => n.toFixed(2)).join(","), " dist=" + dist.toFixed(2));
}

// ---------- grass-style leaf rotation keyframes (identical params to the healthy build) ----------
const GRASS_HALF = 30; // grass: GRASS_T=60 (2s cycle) / 2
const GRASS_AMPLITUDE = 3; // grass default amplitude, degrees
const ease = { o: { x: [0.42], y: [0] }, i: { x: [0.58], y: [1] } };
const STEADY_START = 450; // frame the last relay leaf lands; see FALLING_PARAMS below

// ---------- surviving leaves (never fall): sway forever. Playback plays the
// whole composition once (intro + relay fall), then loops ONLY the
// [STEADY_START, OP] segment forever via lottie's playSegments/setLoop (see
// the composite/debug HTML) -- the fallen leaves never come back within a
// page session, only a manual page reload resets everything (explicit user
// request: 葉片不要復原回原位,重整頁面才恢復). That means the loop-closure
// requirement moves from [0, OP] to [STEADY_START, OP] -- this function
// forces the last keyframe to match the value at STEADY_START instead of at
// t=0. shift is restricted to a multiple of GRASS_HALF (0 or 30) so
// STEADY_START (450, itself a multiple of 30) always lands exactly on that
// leaf's keyframe grid, making "the value at STEADY_START" a plain ±amplitude
// lookup instead of requiring mid-ease bezier evaluation.
function survivorRotationKs(anchor, shift, startSign, amplitude) {
  const ks = baseLayerTransform();
  const anchorArr = [anchor[0], anchor[1], 0];
  ks.a = { a: 0, k: anchorArr };
  ks.p = { a: 0, k: anchorArr };
  const keyframes = [];
  let sign = startSign;
  let t = shift;
  while (t < OP) {
    keyframes.push({ t, s: [sign * amplitude], ...ease });
    sign = -sign;
    t += GRASS_HALF;
  }
  const flips = (STEADY_START - shift) / GRASS_HALF;
  const signAtSteadyStart = startSign * (flips % 2 === 0 ? 1 : -1);
  keyframes.push({ t: OP, s: [signAtSteadyStart * amplitude] });
  ks.r = { a: 1, k: keyframes };
  return ks;
}

// 2 shifts (0, 30 -- both multiples of GRASS_HALF) x 2 starting signs = 4
// distinct phase combos, one per surviving leaf, picked by hand instead of
// the healthy build's generic index-cycling formula (which used shifts of
// 10/20 that don't land on-grid at STEADY_START).
const SURVIVOR_PARAMS = {
  leaf_01: { shift: 0, startSign: 1 },
  leaf_03: { shift: 30, startSign: -1 },
  leaf_05: { shift: 0, startSign: -1 },
  leaf_08: { shift: 30, startSign: 1 },
};
const SURVIVOR_SET = new Set(Object.keys(SURVIVOR_PARAMS));

const SWAY_KS = {};
for (const [leafGroup, { shift, startSign }] of Object.entries(SURVIVOR_PARAMS)) {
  SWAY_KS[leafGroup] = survivorRotationKs(ANCHORS[leafGroup], shift, startSign, GRASS_AMPLITUDE);
}
// trunk_x5F_main stays fully static (baseLayerTransform, applied by the
// fallback branch in the layer-assembly loop below) -- no trunk sway.

// ---------- falling leaves: sway, then fall, then STAY GONE. leaf_02,
// leaf_07, leaf_04 and leaf_06 fall one at a time in relay -- each starts
// exactly as the previous one lands -- and then simply stay invisible at
// their landed spot for the rest of the composition (no pause-then-regrow).
// Lottie holds a property's last keyframe value forever past its time, so
// once opacity's final keyframe is 0 at landing, nothing else is needed --
// the leaf is just permanently gone until the page (and therefore the whole
// animation) is reloaded from scratch.
//
// The fall itself samples several points along a decaying sine wobble +
// gently-accelerating drop (instead of a handful of straight segments between
// far-apart waypoints, which read as a jagged "lightning bolt" path) and a
// continuous one-directional spin (instead of alternating +/- tumbles, which
// looked chaotic combined with the drift). Those sample-to-sample segments
// use LINEAR easing, not the sway's "slow in/out" ease -- reusing the sway
// ease between many close-together fall samples made the leaf visibly
// pause-and-restart at each one, reading as stepped/stop-motion rather than a
// continuous flutter.
const posEase = { o: { x: [0.42, 0.42, 0.42], y: [0, 0, 0] }, i: { x: [0.58, 0.58, 0.58], y: [1, 1, 1] } };
const linear = { o: { x: [0], y: [0] }, i: { x: [1], y: [1] } };
const linearPos = { o: { x: [0, 0, 0], y: [0, 0, 0] }, i: { x: [1, 1, 1], y: [1, 1, 1] } };

function coordinatedFallKs(anchor, cfg) {
  const { swaySign, fallStart, fallDur, driftAmp, wobbleCycles, totalDrop, spinTotal, spinDir, numFallSamples } = cfg;
  const anchorArr = [anchor[0], anchor[1], 0];
  const rKeys = [], pKeys = [], oKeys = [];

  // pre-fall sway (grid starts at t=0, same convention as the other leaves)
  let sign = swaySign;
  let t = 0;
  while (t < fallStart) {
    rKeys.push({ t, s: [sign * GRASS_AMPLITUDE], ...ease });
    sign = -sign;
    t += GRASS_HALF;
  }
  rKeys.push({ t: fallStart, s: [sign * GRASS_AMPLITUDE], ...linear }); // enters the fall, linear from here on
  pKeys.push({ t: 0, s: anchorArr, ...posEase });
  pKeys.push({ t: fallStart, s: anchorArr, ...linearPos });
  oKeys.push({ t: 0, s: [100], ...ease });

  // fall: numFallSamples points along a decaying sine wobble (x) + an
  // accelerating drop (y), continuous one-directional spin (rotation)
  const fallStartRot = sign * GRASS_AMPLITUDE;
  for (let i = 1; i <= numFallSamples; i++) {
    const frac = i / numFallSamples;
    const tt = fallStart + fallDur * frac;
    const x = anchor[0] + driftAmp * Math.sin(frac * wobbleCycles * 2 * Math.PI) * (1 - frac * 0.6);
    const y = anchor[1] + totalDrop * Math.pow(frac, 1.15);
    const rot = fallStartRot + spinDir * spinTotal * frac;
    pKeys.push({ t: tt, s: [x, y, 0], ...linearPos });
    rKeys.push({ t: tt, s: [rot], ...linear });
  }
  const fallEnd = fallStart + fallDur;
  oKeys.push({ t: fallStart + fallDur * 0.7, s: [100], ...ease });
  oKeys.push({ t: fallEnd, s: [0], ...ease }); // fully faded by landing -- and stays that way: no
  // more keyframes follow, so lottie holds opacity at 0 (and position/rotation
  // at their landed values) for the rest of the composition. The leaf does
  // NOT regrow within the loop -- only reloading the page rebuilds the scene
  // from t=0 with every leaf back (explicit user request: 葉片掉落後不要復原,
  // 直到使用者手動重整頁面才恢復原位).

  const ks = baseLayerTransform();
  ks.a = { a: 0, k: anchorArr };
  ks.r = { a: 1, k: rKeys };
  ks.p = { a: 1, k: pKeys };
  ks.o = { a: 1, k: oKeys };
  return ks;
}

// timeline (frames @ 30fps): sway 0-90 (3s) | leaf_02 falls 90-180 | leaf_07
// falls 180-270 (starts exactly as leaf_02 lands) | leaf_04 falls 270-360
// (starts as leaf_07 lands) | leaf_06 falls 360-450 (starts as leaf_04 lands)
// | all four then simply STAY GONE for the rest of the composition (see
// coordinatedFallKs) -- no pause-then-regrow anymore. Composition plays once
// end-to-end (0-900, matching STEADY_START..OP = the surviving leaves'
// seamless sway loop -- see survivorRotationKs above), then the page's JS
// loops only [STEADY_START, OP] forever via lottie playSegments/setLoop, so
// the fallen leaves are permanently gone until a manual page reload.
const FALLING_PARAMS = {
  leaf_02: {
    swaySign: 1, fallStart: 90, fallDur: 90,
    driftAmp: 35, wobbleCycles: 1.7, totalDrop: 561, spinTotal: 480, spinDir: 1, numFallSamples: 14,
  },
  leaf_07: {
    swaySign: -1, fallStart: 180, fallDur: 90,
    driftAmp: 30, wobbleCycles: 1.5, totalDrop: 446, spinTotal: 420, spinDir: -1, numFallSamples: 14,
  },
  leaf_04: {
    swaySign: 1, fallStart: 270, fallDur: 90,
    driftAmp: 32, wobbleCycles: 1.6, totalDrop: 529, spinTotal: 450, spinDir: 1, numFallSamples: 14,
  },
  leaf_06: {
    swaySign: -1, fallStart: 360, fallDur: 90,
    driftAmp: 28, wobbleCycles: 1.4, totalDrop: 384, spinTotal: 400, spinDir: -1, numFallSamples: 14,
  },
};
const FALLING_SET = new Set(Object.keys(FALLING_PARAMS));
const FALLING_KS = {};
for (const [leafGroup, params] of Object.entries(FALLING_PARAMS)) {
  FALLING_KS[leafGroup] = coordinatedFallKs(ANCHORS[leafGroup], params);
  console.log("Falling leaf:", leafGroup, "falls at", params.fallStart / FPS, "s, lands at", (params.fallStart + params.fallDur) / FPS, "s, then stays gone");
}

// ---------- assemble layers, preserving original document z-order ----------
const orderedElements = allElements.slice().reverse(); // topmost-in-SVG first
const layers = orderedElements.map((el, i) => {
  let ks;
  if (el.leafGroup && FALLING_SET.has(el.leafGroup)) ks = FALLING_KS[el.leafGroup];
  else if (el.leafGroup && SWAY_SET.has(el.leafGroup)) ks = SWAY_KS[el.leafGroup];
  else ks = baseLayerTransform();
  return {
    ddd: 0, ty: 4, nm: el.id, sr: 1, ks, ao: 0,
    ip: 0, op: OP, st: 0, ind: i + 1, shapes: [shapeItemFor(el)],
  };
});

const lottie = {
  v: "5.7.0", fr: FPS, ip: 0, op: OP, w: CANVAS_W, h: CANVAS_H,
  nm: "Withered Small Tree - Leaf Sway + Falling Leaves",
  assets: [], layers,
};

fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(lottie, null, 2));
console.log("\nWrote", OUT_JSON, "| layers:", layers.length);
