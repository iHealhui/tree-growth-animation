// Build for stage 01 seed (tree_fg_01_seed_healthy.svg -- the seed only has a
// healthy state). Does NOT touch the source SVG -- writes only to
// public/_test_seed.json.
//
// Two gentle motions, both plain layer transforms (no shape keyframes, so the
// file stays tiny):
// 1. Breathing: the whole seed (body, crack and root) swells a little and
//    settles back, scaled from the point where the seed rests on the soil so it
//    never lifts off or sinks in. Driven by a null layer every part is parented
//    to.
// 2. Root wiggle: root_base + root_main rock about the point where the root
//    leaves the seed, on a different rhythm from the breathing so the two never
//    line up and read as mechanical.
import fs from "node:fs";
import path from "node:path";
import parseSvgPath from "parse-svg-path";
import absSvgPath from "abs-svg-path";

const SRC = "../tree-stages/tree_fg_01_seed_healthy.svg";
const OUT_JSON = "public/_test_seed.json";
const FPS = 30;
const OP = 900; // 30s loop, matches the background scene's master loop length
const CANVAS_W = 1000;
const CANVAS_H = 1000;

// ---------- motion params ----------
const BREATH_SCALE = 2; // percent the seed swells at the peak
const BREATH_PERIOD = 150; // frames per swell-and-settle (5s, same pace as the healthy sprout's swing); must divide OP
const ROOT_DEG = 6; // root wiggle each side
const ROOT_PERIOD = 90; // frames per full wiggle (3s); must divide OP
for (const p of [BREATH_PERIOD, ROOT_PERIOD]) {
  if (OP % p !== 0) throw new Error(p + " must divide OP for a seamless loop");
}
const ROOT_IDS = new Set(["root_base", "root_main"]);

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
  allElements.push({ id: getAttr(raw, "id"), d: getAttr(raw, "d"), fill: getFill(raw) });
}
console.log("Total <path> elements:", allElements.length, "(" + allElements.map((el) => el.id).join(", ") + ")");
for (const id of ["seed_body", ...ROOT_IDS]) {
  if (!allElements.some((el) => el.id === id)) throw new Error(id + " not found");
}
const vertsOf = (id) => svgPathToLottieShape(allElements.find((el) => el.id === id).d).flatMap((c) => c.v);

// where the seed rests on the soil: its lowest vertex
const bodyVerts = vertsOf("seed_body");
const REST_POINT = bodyVerts.reduce((a, b) => (b[1] > a[1] ? b : a));
// where the root leaves the seed: the top end of root_main (it hangs straight
// down from there; "nearest vertex to the seed body" picks the middle of the
// root instead, because the tilted seed's lower edge runs right beside it)
const ROOT_PIVOT = vertsOf("root_main").reduce((a, b) => (b[1] < a[1] ? b : a));
console.log("Rest point:", REST_POINT.map((n) => n.toFixed(1)).join(","), "| root pivot:", ROOT_PIVOT.map((n) => n.toFixed(1)).join(","));

// ---------- keyframes ----------
// ease in/out between extremes, same curve as the grass/leaf sway; see
// project-composite-debug memory: lottie-web wants o+i on every keyframe
// except the last, and none on the last.
const ease = { o: { x: [0.42], y: [0] }, i: { x: [0.58], y: [1] } };
function pingPong(period, from, to) {
  const k = [];
  for (let t = 0; t < OP; t += period / 2) k.push({ t, s: (k.length % 2 ? to : from), ...ease });
  k.push({ t: OP, s: from });
  return { a: 1, k };
}

// breathing: a null layer scaled about the rest point; every part is parented to it
const BREATH_IND = 1;
const breathKs = baseLayerTransform();
breathKs.a = { a: 0, k: [...REST_POINT, 0] };
breathKs.p = { a: 0, k: [...REST_POINT, 0] };
breathKs.s = pingPong(BREATH_PERIOD, [100, 100, 100], [100 + BREATH_SCALE, 100 + BREATH_SCALE, 100]);
const breathLayer = { ddd: 0, ty: 3, nm: "seed_breath", sr: 1, ks: breathKs, ao: 0, ip: 0, op: OP, st: 0, ind: BREATH_IND };

// root wiggle: rotation about the root pivot, starting at one extreme
const rootKs = baseLayerTransform();
rootKs.a = { a: 0, k: [...ROOT_PIVOT, 0] };
rootKs.p = { a: 0, k: [...ROOT_PIVOT, 0] };
rootKs.r = pingPong(ROOT_PERIOD, [ROOT_DEG], [-ROOT_DEG]);

// ---------- assemble layers, preserving exact original document z-order ----------
const orderedElements = allElements.slice().reverse(); // topmost-in-SVG first
const layers = [
  breathLayer,
  ...orderedElements.map((el, i) => ({
    ddd: 0, ty: 4, nm: el.id, sr: 1, ks: ROOT_IDS.has(el.id) ? rootKs : baseLayerTransform(), ao: 0,
    ip: 0, op: OP, st: 0, ind: BREATH_IND + 1 + i, parent: BREATH_IND, shapes: [shapeItemFor(el)],
  })),
];

const lottie = {
  v: "5.7.0", fr: FPS, ip: 0, op: OP, w: CANVAS_W, h: CANVAS_H,
  nm: "Seed Healthy - breathing (" + BREATH_SCALE + "%, " + BREATH_PERIOD + "f) + root wiggle (" + ROOT_DEG + "deg, " + ROOT_PERIOD + "f)",
  assets: [], layers,
};

fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(lottie));
console.log("Wrote", OUT_JSON, "| layers:", layers.length, "| size:", (fs.statSync(OUT_JSON).size / 1024).toFixed(1) + "KB");
