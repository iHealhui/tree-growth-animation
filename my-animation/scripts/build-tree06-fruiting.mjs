// Build for tree_fg_06_fruiting_healthy.svg (final stage: the mature tree in
// flower + fruit). Does NOT touch the source SVG -- writes only to
// public/_test_tree06_fruiting.json.
//
// The tree base (trunk + 3 crown clusters + leaf_01~30) is identical to
// tree_fg_05_maturetree_healthy.svg (same names, order, geometry), so the 30
// leaves reuse tree_05 healthy's sway exactly -- switching 05 -> 06 doesn't
// jump. On top of that:
//   - flower_01~07 (petals + center): slow back-and-forth rotation around the
//     flower center. No scale "breathing" (user's call).
//   - fruit_01~05 (body + highlight + stem): slow pendulum around the stem
//     tip, slower than the leaves so the fruit reads as heavier.
//   - a glass-like gloss (one soft band) sweeps across each fruit, every 6s.
// fruit_02 body/stem sit between crown_upper_02 and _03 on purpose (partly
// tucked into the canopy); z-order is preserved per path, so that holds.
// Like stage 01, stage 06 only has a healthy state.
import fs from "node:fs";
import path from "node:path";
import parseSvgPath from "parse-svg-path";
import absSvgPath from "abs-svg-path";

const SRC = "../tree-stages/tree_fg_06_fruiting_healthy.svg";
const OUT_JSON = "public/_test_tree06_fruiting.json";
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

// ---------- CSS class fills (Illustrator export: class="stN" + <style>) ----------
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

// full 2D affine composition -- see project-composite-debug memory for why
// naive translate+scale-only parsing silently drops rotate() and throws
// gradient endpoints far outside the shape.
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
  // gradientTransform is inherited through xlink:href when not set locally
  // (SVG spec). tree_06's flower/fruit gradients rely on this: the parent
  // carries translate(0 1000) scale(1 -1), the child only its own x1..y2.
  let transform = g.gradientTransform;
  for (let h = g.href; !transform && h; h = rawGradients[h].href) transform = rawGradients[h].gradientTransform;
  const matrix = parseTransformList(transform);
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

// fruit highlights are exported as rgba(...) with alpha
function makeRgbaFill(rgba) {
  const [r, g, b, a] = rgba.match(/[\d.]+/g).map(Number);
  return { ty: "fl", nm: "fill", c: { a: 0, k: [r / 255, g / 255, b / 255, 1] }, o: { a: 0, k: (a ?? 1) * 100 } };
}

function fillItemFor(fillAttr) {
  if (!fillAttr) return makeSolidFill("#000000");
  const urlMatch = fillAttr.match(/url\(#(.*)\)/);
  if (urlMatch) return makeGradientFill(urlMatch[1]);
  if (fillAttr.startsWith("rgb")) return makeRgbaFill(fillAttr);
  return makeSolidFill(fillAttr);
}

// ---------- path d -> lottie shape (also used for anchor-finding vertices) ----------
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
  const flowerGroup = getAttr(raw, "data-flower-group");
  const fruitGroup = getAttr(raw, "data-fruit-group");
  allElements.push({ id, d: getAttr(raw, "d"), fill: getFill(raw), leafGroup, flowerGroup, fruitGroup });
}
console.log("Total <path> elements:", allElements.length);

// ---------- leaf groups: all 30 sway (plenty of static visual mass already
// comes from the 3 crown clusters, unlike tree_04 healthy's 43/19 split) ----------
const SWAY_IDS = Array.from({ length: 30 }, (_, i) => "leaf_" + String(i + 1).padStart(2, "0"));
const SWAY_SET = new Set(SWAY_IDS);

const allLeafGroups = new Set(allElements.map((el) => el.leafGroup).filter(Boolean));
for (const g of allLeafGroups) {
  if (!SWAY_SET.has(g)) throw new Error("Unexpected leaf group in SVG not in SWAY_IDS: " + g);
}
for (const g of SWAY_IDS) {
  if (!allLeafGroups.has(g)) throw new Error("Expected leaf group missing from SVG: " + g);
}
console.log("Leaf groups OK:", allLeafGroups.size, "(all sway)");

// ---------- reference geometry: trunk_main + the 3 static crown clusters
// (leaves ring the OUTSIDE of 3 separate canopy lobes, not a single trunk, so
// anchor-finding needs vertices from all of them, not just the trunk) ----------
const REF_IDS = new Set([
  "trunk_main",
  "crown_upper_01", "crown_upper_02", "crown_upper_03", "crown_upper_light_left", "crown_upper_light_right",
  "crown_left_01", "crown_left_shadow", "crown_left_02",
  "crown_right_01", "crown_right_shadow", "crown_right_02",
]);
const refElements = allElements.filter((el) => REF_IDS.has(el.id));
if (refElements.length !== REF_IDS.size) {
  throw new Error("Expected " + REF_IDS.size + " reference (trunk/crown) elements, found " + refElements.length);
}
const refVerts = [];
for (const el of refElements) {
  for (const contour of svgPathToLottieShape(el.d)) {
    for (const v of contour.v) refVerts.push(v);
  }
}
console.log("Reference (trunk+crown) vertices:", refVerts.length);

// ---------- anchor finding: for each sway leaf, the leaf vertex closest to any reference vertex ----------
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
const anchorReport = [];
for (const leafGroup of SWAY_IDS) {
  const { anchor, dist } = findAnchor(leafGroup);
  ANCHORS[leafGroup] = anchor;
  anchorReport.push({ leafGroup, anchor, dist: Math.round(dist * 100) / 100 });
}
console.log("\nComputed anchors (leaf -> nearest trunk/crown vertex, distance):");
for (const r of anchorReport) {
  console.log(" ", r.leafGroup.padEnd(9), r.anchor.map((n) => n.toFixed(2)).join(","), " dist=" + r.dist);
}
const maxDist = Math.max(...anchorReport.map((r) => r.dist));
console.log("\nMax anchor-to-crown distance:", maxDist.toFixed(2), "(flag for review if this looks large)");

// ---------- grass-style rotation keyframes (same params as tree_04) ----------
const GRASS_HALF = 30; // grass: GRASS_T=60 (2s cycle) / 2
const GRASS_AMPLITUDE = 3; // grass default amplitude, degrees
const ease = { o: { x: [0.42], y: [0] }, i: { x: [0.58], y: [1] } };
const SHIFTS = [0, 10, 20]; // phase stagger, same recipe as tree_04

function leafRotationKs(anchor, shift, startSign, amplitude) {
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
  keyframes.push({ t: OP, s: [startSign * amplitude] });
  ks.r = { a: 1, k: keyframes };
  return ks;
}

const SWAY_KS = {};
SWAY_IDS.forEach((leafGroup, i) => {
  const shift = SHIFTS[i % SHIFTS.length];
  const startSign = i % 2 === 0 ? 1 : -1;
  SWAY_KS[leafGroup] = leafRotationKs(ANCHORS[leafGroup], shift, startSign, GRASS_AMPLITUDE);
});

// ---------- flowers + fruit ----------
function groupIds(key, prefix, count) {
  const found = [...new Set(allElements.map((el) => el[key]).filter(Boolean))].sort();
  const expected = Array.from({ length: count }, (_, i) => prefix + String(i + 1).padStart(2, "0"));
  if (JSON.stringify(found) !== JSON.stringify(expected)) {
    throw new Error("Expected " + key + " " + expected.join(",") + " but found " + found.join(","));
  }
  return expected;
}
const FLOWER_IDS = groupIds("flowerGroup", "flower_", 7);
const FRUIT_IDS = groupIds("fruitGroup", "fruit_", 5);

function partOf(key, group, suffix) {
  const el = allElements.find((e) => e[key] === group && e.id.endsWith("_" + suffix));
  if (!el) throw new Error("Missing " + group + "_" + suffix);
  return el;
}
function verticesOf(el) {
  return svgPathToLottieShape(el.d).flatMap((c) => c.v);
}
function bboxCenter(verts) {
  const xs = verts.map((v) => v[0]), ys = verts.map((v) => v[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

// Seamless loop without the leaves' phase shifts: every half-period splits OP
// into an EVEN number of swings, so frame OP lands back on the starting value.
function pingPongRotationKs(anchor, startSign, amplitude, half) {
  if ((OP / half) % 2 !== 0) throw new Error("half " + half + " doesn't loop evenly in " + OP);
  const ks = baseLayerTransform();
  const anchorArr = [anchor[0], anchor[1], 0];
  ks.a = { a: 0, k: anchorArr };
  ks.p = { a: 0, k: anchorArr };
  const keyframes = [];
  let sign = startSign;
  for (let t = 0; t < OP; t += half) {
    keyframes.push({ t, s: [sign * amplitude], ...ease });
    sign = -sign;
  }
  keyframes.push({ t: OP, s: [startSign * amplitude] });
  ks.r = { a: 1, k: keyframes };
  return ks;
}

// flowers: slow rotation around the center disc; 3.75s / 5s per swing, mixed so
// neighbouring flowers never move in lockstep
const FLOWER_AMPLITUDE = 8; // degrees
const FLOWER_HALVES = [112.5, 150]; // fractional frames are fine in Lottie; 900/112.5 = 8 (even)
const FLOWER_KS = {};
FLOWER_IDS.forEach((g, i) => {
  const center = bboxCenter(verticesOf(partOf("flowerGroup", g, "center")));
  FLOWER_KS[g] = pingPongRotationKs(center, i % 2 === 0 ? 1 : -1, FLOWER_AMPLITUDE, FLOWER_HALVES[i % 2]);
  console.log("flower pivot", g, center.map((n) => n.toFixed(1)).join(","));
});

// fruit: pendulum around the stem tip (the stem vertex farthest from the body);
// 3s / 2.5s per swing vs the leaves' 1s, so the fruit reads as heavier
const FRUIT_AMPLITUDE = 2; // degrees
const FRUIT_HALVES = [90, 75];
const FRUIT_KS = {};
FRUIT_IDS.forEach((g, i) => {
  const bodyC = bboxCenter(verticesOf(partOf("fruitGroup", g, "body")));
  let tip = null, best = -1;
  for (const v of verticesOf(partOf("fruitGroup", g, "stem"))) {
    const dist = Math.hypot(v[0] - bodyC[0], v[1] - bodyC[1]);
    if (dist > best) { best = dist; tip = v; }
  }
  FRUIT_KS[g] = pingPongRotationKs(tip, i % 2 === 0 ? -1 : 1, FRUIT_AMPLITUDE, FRUIT_HALVES[i % 2]);
  console.log("fruit pivot", g, tip.map((n) => n.toFixed(1)).join(","));
});

// sheen: a glass-like gloss -- a soft band of light
// that slides diagonally across each fruit body. (A thin trailing second band
// was tried and dropped at the user's call; SHEEN_BANDS still takes more.)
// (A droplet flowing along the edge was tried and dropped; the user preferred
// this sweep.) The light takes the fruit's own lightest color lifted toward
// white and stays semi-transparent, so it reads as gloss on the fruit rather
// than a white sticker.
// The bands are alpha-matted to a copy of the body shape (with a soft radial
// falloff, see sheenMatteShape) so they only show
// inside the fruit, and both sit right above the body in z-order (so
// fruit_02's sheen stays tucked under crown_upper_03 too). Both are parented
// to the body layer so they follow the pendulum. The loop is cut into 5
// rounds of 6s; every fruit shines once per round, ~1s apart, but the order
// is shuffled each round (plus a little timing jitter) so it doesn't read as
// a fixed left-to-right chase. Seeded, so rebuilds give the same sequence.
const SHEEN_TILT = -35; // degrees; bands lean, sweep runs lower-left -> upper-right
const SHEEN_BANDS = [
  { width: 26, offset: 0, alpha: 0.6 }, // main band (wide, since the soft profile eats into the visible width)
];
const SHEEN_LEN = 27; // frames per sweep (0.9s)
const SHEEN_PROFILE = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]; // gradient stop offsets across a band
const SHEEN_FIRST = 6, SHEEN_STAGGER = 30, SHEEN_REPEAT = OP / 5;
const SHEEN_JITTER = 5; // +-frames added to each slot
const SHEEN_SEED = 4; // picked by eye: each round opens on a different fruit, no obvious repeats

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// start frames per fruit: each round shuffles which fruit takes which slot
function sheenSchedule(fruitIds) {
  const rand = mulberry32(SHEEN_SEED);
  const starts = Object.fromEntries(fruitIds.map((g) => [g, []]));
  let prevLast = null;
  for (let round = 0; round * SHEEN_REPEAT < OP; round++) {
    let order;
    do {
      order = fruitIds.slice();
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    } while (order[0] === prevLast); // no fruit twice in a row across rounds
    prevLast = order[order.length - 1];
    order.forEach((g, slot) => {
      const jitter = Math.round((rand() * 2 - 1) * SHEEN_JITTER);
      starts[g].push(SHEEN_FIRST + round * SHEEN_REPEAT + slot * SHEEN_STAGGER + jitter);
    });
  }
  return starts;
}
const SHEEN_STARTS = sheenSchedule(FRUIT_IDS);
const SHEEN_LIGHTEN = 0.45; // tint = lightest body color mixed this far toward white

// the light takes the fruit's own lightest color, lifted toward white
function sheenTint(bodyEl) {
  const m = bodyEl.fill && bodyEl.fill.match(/url\(#(.*)\)/);
  const colors = m ? resolveGradient(m[1]).stops.map((st) => hexToRgb1(st.color)) : [hexToRgb1(bodyEl.fill)];
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const lightest = colors.reduce((a, b) => (lum(b) > lum(a) ? b : a));
  return lightest.map((v) => v + (1 - v) * SHEEN_LIGHTEN);
}

// one soft-edged band: rect along local y, gradient across its width
function bandGroup(band, start, length, rgb, dir) {
  const w = band.width;
  return {
    ty: "gr", nm: "sheen-band", it: [
      { ty: "rc", nm: "band", d: 1, p: { a: 0, k: [0, 0] }, s: { a: 0, k: [w, length] }, r: { a: 0, k: 0 } },
      {
        ty: "gf", nm: "band-fill", o: { a: 0, k: 100 }, r: 1, t: 1,
        s: { a: 0, k: [-w / 2, 0] }, e: { a: 0, k: [w / 2, 0] },
        // bell-shaped opacity (sin^2) instead of a 3-stop tent: the tent's
        // straight ramps left visibly hard edges and a sharp ridge down the middle
        g: { p: SHEEN_PROFILE.length, k: { a: 0, k: [
          ...SHEEN_PROFILE.flatMap((x) => [x, ...rgb]),
          ...SHEEN_PROFILE.flatMap((x) => [x, band.alpha * Math.sin(Math.PI * x) ** 2]),
        ] } },
      },
      {
        ty: "tr", a: { a: 0, k: [0, 0] },
        p: { a: 0, k: [start[0] + dir[0] * band.offset, start[1] + dir[1] * band.offset] },
        s: { a: 0, k: [100, 100] }, r: { a: 0, k: SHEEN_TILT }, o: { a: 0, k: 100 },
      },
    ],
  };
}

// matte for the sweep: the body shape filled with a radial alpha falloff, so
// the light fades out as it nears the fruit outline instead of being cut off
// hard by it. Opaque in the middle, transparent at the (average) edge.
const SHEEN_EDGE_FADE = [[0, 1], [0.5, 1], [0.75, 0.55], [0.9, 0.15], [1, 0]]; // [offset, alpha]
function sheenMatteShape(bodyEl) {
  const verts = verticesOf(bodyEl);
  const c = bboxCenter(verts);
  const r = verts.reduce((s, v) => s + Math.hypot(v[0] - c[0], v[1] - c[1]), 0) / verts.length;
  const contours = svgPathToLottieShape(bodyEl.d);
  return {
    ty: "gr", nm: "sheen-matte", it: [
      ...contours.map((ct, i) => ({ ty: "sh", nm: "path-" + i, ks: { a: 0, k: { c: ct.closed, v: ct.v, i: ct.i, o: ct.o } } })),
      {
        ty: "gf", nm: "edge-fade", o: { a: 0, k: 100 }, r: 1, t: 2,
        s: { a: 0, k: c }, e: { a: 0, k: [c[0] + r, c[1]] }, h: { a: 0, k: 0 }, a: { a: 0, k: 0 },
        g: { p: SHEEN_EDGE_FADE.length, k: { a: 0, k: [
          ...SHEEN_EDGE_FADE.flatMap(([x]) => [x, 1, 1, 1]),
          ...SHEEN_EDGE_FADE.flatMap(([x, alpha]) => [x, alpha]),
        ] } },
      },
      identityTransform(),
    ],
  };
}

// returns the band shapes + layer transform that slides them across the body
function sheenFor(bodyEl, starts) {
  const verts = verticesOf(bodyEl);
  const c = bboxCenter(verts);
  const radius = Math.max(...verts.map((v) => Math.hypot(v[0] - c[0], v[1] - c[1])));
  // direction across the bands (their local +x after the tilt)
  const rad = (SHEEN_TILT * Math.PI) / 180;
  const dir = [Math.cos(rad), Math.sin(rad)];
  const widest = Math.max(...SHEEN_BANDS.map((b) => b.width / 2 + Math.abs(b.offset)));
  const reach = radius + widest; // start/end with every band fully outside the body
  const start = [c[0] - dir[0] * reach, c[1] - dir[1] * reach];
  const travel = [dir[0] * reach * 2, dir[1] * reach * 2, 0];

  const ks = baseLayerTransform();
  // every non-final keyframe needs easing or h:1 (hold) -- lottie-web throws
  // on a bare one, and that stops every animation on the page
  const pk = [{ t: 0, s: [0, 0, 0], h: 1 }];
  for (const t0 of starts) {
    pk.push({ t: t0, s: [0, 0, 0], to: [0, 0, 0], ti: [0, 0, 0], ...ease }, { t: t0 + SHEEN_LEN, s: travel, h: 1 });
  }
  pk.push({ t: OP, s: travel });
  ks.p = { a: 1, k: pk };

  const rgb = sheenTint(bodyEl);
  const shapes = SHEEN_BANDS.map((b) => bandGroup(b, start, radius * 2.4, rgb, dir));
  return { shapes, ks };
}

// ---------- assemble layers, preserving exact original document z-order ----------
function ksFor(el) {
  if (el.leafGroup && SWAY_SET.has(el.leafGroup)) return SWAY_KS[el.leafGroup];
  if (el.flowerGroup) return FLOWER_KS[el.flowerGroup];
  if (el.fruitGroup) return FRUIT_KS[el.fruitGroup];
  return baseLayerTransform();
}
const orderedElements = allElements.slice().reverse(); // topmost-in-SVG first
const layers = [];
const pendingParent = []; // [layer, body element id] resolved once ind is known
for (const el of orderedElements) {
  if (el.fruitGroup && el.id.endsWith("_body")) {
    const sheen = sheenFor(el, SHEEN_STARTS[el.fruitGroup]);
    // matte (td:1) must sit directly above the layer it mattes (tt:1)
    const matte = {
      ddd: 0, ty: 4, nm: el.fruitGroup + "_sheen_matte", sr: 1, ks: baseLayerTransform(), ao: 0, td: 1,
      ip: 0, op: OP, st: 0, shapes: [sheenMatteShape(el)],
    };
    const band = {
      ddd: 0, ty: 4, nm: el.fruitGroup + "_sheen", sr: 1, ks: sheen.ks, ao: 0, tt: 1,
      ip: 0, op: OP, st: 0, shapes: sheen.shapes,
    };
    layers.push(matte, band);
    pendingParent.push([matte, el.id], [band, el.id]);
  }
  layers.push({
    ddd: 0, ty: 4, nm: el.id, sr: 1, ks: ksFor(el), ao: 0,
    ip: 0, op: OP, st: 0, shapes: [shapeItemFor(el)],
  });
}
layers.forEach((l, i) => { l.ind = i + 1; });
for (const [l, bodyId] of pendingParent) l.parent = layers.find((x) => x.nm === bodyId).ind;

const lottie = {
  v: "5.7.0", fr: FPS, ip: 0, op: OP, w: CANVAS_W, h: CANVAS_H,
  nm: "Tree06 Fruiting Healthy - Leaf Sway + Flower Turn + Fruit Swing + Sheen",
  assets: [], layers,
};

fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
// minified (was pretty-printed -- ~80% of the file was indentation). Numbers
// are left unrounded: rounding to 3 decimals visibly shifted ~200 pixels on
// tree_04 healthy, so it isn't worth the extra ~15%.
fs.writeFileSync(OUT_JSON, JSON.stringify(lottie));
console.log("\nWrote", OUT_JSON, "| layers:", layers.length);
