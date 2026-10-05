// Bend build for tree_fg_02_sprout_healthy.svg. Does NOT touch the source SVG
// -- writes only to public/_test_bend_sprout.json.
//
// Emulates AE's CC Bend It (what the sprout was previously hand-animated with,
// see "AE project/CC Bend it 輸出版"): the base of trunk_main stays pinned and
// the whole sprout (stem + stalk + both leaves) bends along one smooth arc,
// swinging left/right. Unlike leaf-sway (whole-piece rotation per layer), the
// path outlines themselves deform: every vertex AND both of its bezier handles
// are pushed through the same bend map, so curves stay smooth (rotating only
// vertices and leaving handles un-rotated is what kinks the outline).
//
// Lottie interpolates shape keyframes linearly per vertex, which would cut the
// arc's corners if only the two extremes were keyed, so the bend is sampled
// every SAMPLE_STEP frames along a sine wave instead.
import fs from "node:fs";
import path from "node:path";
import parseSvgPath from "parse-svg-path";
import absSvgPath from "abs-svg-path";

const SRC = "../tree-stages/tree_fg_02_sprout_healthy.svg";
const OUT_JSON = "public/_test_bend_sprout.json";
const FPS = 30;
const OP = 900; // 30s loop, matches the background scene's master loop length
const CANVAS_W = 1000;
const CANVAS_H = 1000;

// ---------- bend params ----------
const BEND_AMPLITUDE_DEG = 10; // tip angle at full bend (each side)
const BEND_PERIOD = 150; // frames per full left-right-left cycle (5s); must divide OP
const BEND_PROFILE = 1; // angle(h) = A * (h/H)^PROFILE; 1 = circular arc like CC Bend It, >1 = stiffer base
const SAMPLE_STEP = 3; // frames between shape keyframes
if (OP % BEND_PERIOD !== 0) throw new Error("BEND_PERIOD must divide OP for a seamless loop");
if (OP % SAMPLE_STEP !== 0) throw new Error("SAMPLE_STEP must divide OP");
const CYCLE = BEND_PERIOD; // the whole motion repeats every bend cycle

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

// ---------- bend frame: base = bottom-centre of trunk_main, height = up to the sprout's top ----------
const trunk = allElements.find((el) => el.id === "trunk_main");
if (!trunk) throw new Error("trunk_main not found");
const trunkVerts = svgPathToLottieShape(trunk.d).flatMap((c) => c.v);
const BASE_Y = Math.max(...trunkVerts.map((v) => v[1]));
const bottomVerts = trunkVerts.filter((v) => BASE_Y - v[1] < 3);
const BASE_X = bottomVerts.reduce((s, v) => s + v[0], 0) / bottomVerts.length;
const TOP_Y = Math.min(...allElements.flatMap((el) => svgPathToLottieShape(el.d).flatMap((c) => c.v.map((v) => v[1]))));
const BEND_H = BASE_Y - TOP_Y;
console.log("Bend base:", BASE_X.toFixed(2), BASE_Y.toFixed(2), "| height:", BEND_H.toFixed(2));

// Spine of the bent sprout: arc length h up from the base, tangent angle
// phi(h) = A*(h/H)^PROFILE (0 = straight up, + = leaning right). Integrated
// numerically so any PROFILE works. Each point keeps its horizontal offset
// from the base line as a perpendicular offset from the spine, rotated by
// phi at its height.
const SPINE_STEPS = 400;
function makeBendMap(amplitudeRad) {
  const phiAt = (h) => amplitudeRad * Math.pow(h / BEND_H, BEND_PROFILE);
  const table = [[0, 0]]; // spine [dx, dy] relative to the base, per step
  const dh = BEND_H / SPINE_STEPS;
  for (let k = 1; k <= SPINE_STEPS; k++) {
    const phi = phiAt((k - 0.5) * dh);
    const [px, py] = table[k - 1];
    table.push([px + Math.sin(phi) * dh, py - Math.cos(phi) * dh]);
  }
  return (x, y) => {
    const below = Math.max(y - BASE_Y, 0); // anything under the base just stays put
    const h = Math.min(Math.max(BASE_Y - y, 0), BEND_H);
    // above the top vertex (bezier handles can poke out past it, e.g. the
    // withered seedling's hooked tip): carry on straight along the tip's
    // tangent instead of clamping, which flattened those curves
    const above = Math.max(BASE_Y - y - BEND_H, 0);
    const f = (h / BEND_H) * SPINE_STEPS;
    const k0 = Math.min(Math.floor(f), SPINE_STEPS - 1);
    const t = f - k0;
    const sx = table[k0][0] + (table[k0 + 1][0] - table[k0][0]) * t;
    const sy = table[k0][1] + (table[k0 + 1][1] - table[k0][1]) * t;
    const phi = phiAt(h);
    const d = x - BASE_X;
    return [
      BASE_X + sx + d * Math.cos(phi) + above * Math.sin(phi),
      BASE_Y + sy + d * Math.sin(phi) - above * Math.cos(phi) + below,
    ];
  };
}

// Deform a contour: map each vertex, and each handle as an absolute point
// (vertex + handle), then convert back to relative -- this is what turns the
// handles together with the vertex.
function bendContour(c, map) {
  const v = [], i = [], o = [];
  for (let n = 0; n < c.v.length; n++) {
    const [x, y] = c.v[n];
    const nv = map(x, y);
    const ni = map(x + c.i[n][0], y + c.i[n][1]);
    const no = map(x + c.o[n][0], y + c.o[n][1]);
    v.push(nv);
    i.push([ni[0] - nv[0], ni[1] - nv[1]]);
    o.push([no[0] - nv[0], no[1] - nv[1]]);
  }
  return { c: c.closed, v, i, o };
}

// ---------- keyframes ----------
// see project-composite-debug memory: lottie-web wants o+i on every keyframe
// except the last, and none on the last.
const LINEAR_O = { x: [0.333], y: [0.333] };
const LINEAR_I = { x: [0.667], y: [0.667] };
const SAMPLE_TIMES = [];
for (let t = 0; t <= CYCLE; t += SAMPLE_STEP) SAMPLE_TIMES.push(t);
const BEND_MAPS = SAMPLE_TIMES.map((t) =>
  makeBendMap(((BEND_AMPLITUDE_DEG * Math.PI) / 180) * Math.sin((2 * Math.PI * t) / BEND_PERIOD))
);

function animated(values) {
  return {
    a: 1,
    k: values.map((s, idx) =>
      idx === values.length - 1 ? { t: SAMPLE_TIMES[idx], s } : { t: SAMPLE_TIMES[idx], s, o: LINEAR_O, i: LINEAR_I }
    ),
  };
}

function makeGradientFill(gradId) {
  const grad = resolveGradient(gradId);
  const gs = grad.stops.slice().sort((a, b) => a.offset - b.offset).map((s) => ({ offset: s.offset, rgb: hexToRgb1(s.color) }));
  const k = [];
  for (const s of gs) k.push(s.offset, ...s.rgb);
  // gradient endpoints ride the same bend so the colours stay glued to the shape
  return {
    ty: "gf", nm: "gradient-fill", o: { a: 0, k: 100 }, t: 1,
    s: animated(BEND_MAPS.map((map) => map(grad.x1, grad.y1))),
    e: animated(BEND_MAPS.map((map) => map(grad.x2, grad.y2))),
    g: { p: gs.length, k: { a: 0, k } },
  };
}

function shapeItemFor(el) {
  const contours = svgPathToLottieShape(el.d);
  const it = contours.map((c, n) => ({
    ty: "sh", nm: "path-" + n,
    // shape keyframe values are wrapped in an array: s: [{ c, v, i, o }]
    ks: animated(BEND_MAPS.map((map) => [bendContour(c, map)])),
  }));
  it.push(fillItemFor(el.fill));
  it.push(identityTransform());
  return { ty: "gr", nm: el.id, it };
}

// ---------- assemble layers, preserving exact original document z-order ----------
const orderedElements = allElements.slice().reverse(); // topmost-in-SVG first
const layers = orderedElements.map((el, n) => ({
  ddd: 0, ty: 4, nm: el.id, sr: 1, ks: baseLayerTransform(), ao: 0,
  ip: 0, op: CYCLE, st: 0, ind: n + 1, shapes: [shapeItemFor(el)],
}));

// The motion repeats exactly every CYCLE frames, so only one cycle is stored
// (in a precomp) and copies of it are laid end to end to fill the 30s
// timeline -- the file shrinks by OP / CYCLE with no visible change.
function cycleLayers() {
  return Array.from({ length: OP / CYCLE }, (_, k) => ({
    ddd: 0, ty: 0, nm: "cycle-" + (k + 1), refId: "cycle", sr: 1, ks: baseLayerTransform(), ao: 0,
    w: CANVAS_W, h: CANVAS_H, ip: k * CYCLE, op: (k + 1) * CYCLE, st: k * CYCLE, ind: k + 1,
  }));
}

const lottie = {
  v: "5.7.0", fr: FPS, ip: 0, op: OP, w: CANVAS_W, h: CANVAS_H,
  nm: "Sprout Healthy - Bend (" + BEND_AMPLITUDE_DEG + "deg, " + BEND_PERIOD + "f period)",
  assets: [{ id: "cycle", nm: "one motion cycle (" + CYCLE + "f)", layers }], layers: cycleLayers(),
};

fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
// 3 decimals: sub-pixel for coordinates, finer than 1/255 for colour channels
fs.writeFileSync(OUT_JSON, JSON.stringify(lottie, (k, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v)));
console.log("Wrote", OUT_JSON, "| layers:", layers.length, "| keyframes per shape:", SAMPLE_TIMES.length,
  "| size:", (fs.statSync(OUT_JSON).size / 1024).toFixed(0) + "KB");
