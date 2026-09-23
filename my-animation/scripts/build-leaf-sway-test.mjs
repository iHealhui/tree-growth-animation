// Standalone prototype: sway animation for 4 leaves on tree_fg_04_smalltree_healthy.svg.
// Does NOT touch the source SVG or any existing lottie.json — writes only to
// public/_test_leaf_sway.json (plus a debug HTML player alongside it).
import fs from "node:fs";
import path from "node:path";
import parseSvgPath from "parse-svg-path";
import absSvgPath from "abs-svg-path";

const SRC = "../tree-stages/tree_fg_04_smalltree_healthy.svg";
const OUT_JSON = "public/_test_leaf_sway.json";
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

function parseTransform(t) {
  if (!t) return { tx: 0, ty: 0, sx: 1, sy: 1 };
  let tx = 0, ty = 0, sx = 1, sy = 1;
  const translateM = t.match(/translate\(([^)]*)\)/);
  if (translateM) {
    const parts = translateM[1].trim().split(/[\s,]+/).map(Number);
    tx = parts[0] || 0;
    ty = parts[1] !== undefined ? parts[1] : 0;
  }
  const scaleM = t.match(/scale\(([^)]*)\)/);
  if (scaleM) {
    const parts = scaleM[1].trim().split(/[\s,]+/).map(Number);
    sx = parts[0];
    sy = parts[1] !== undefined ? parts[1] : parts[0];
  }
  return { tx, ty, sx, sy };
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
  const { tx, ty, sx, sy } = parseTransform(g.gradientTransform);
  return { x1: x1 * sx + tx, y1: y1 * sy + ty, x2: x2 * sx + tx, y2: y2 * sy + ty, stops };
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

function makeSingleElementLayer(el, index) {
  // one layer per static path (matches build-scene.mjs's per-group layer
  // pattern) instead of packing 100+ shapes into one layer -- lottie-web's
  // SVG renderer was observed to render a single giant multi-gradient shape
  // layer unreliably (blocked/partial paint), so keep each layer small.
  return {
    ddd: 0, ty: 4, nm: el.id, sr: 1, ks: baseLayerTransform(), ao: 0,
    ip: 0, op: OP, st: 0, ind: index, shapes: [shapeItemFor(el)],
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

// ---------- target leaves ----------
const LEAF_IDS = {
  leaf_01: ["leaf_01_base", "leaf_01_shade"],
  leaf_17: ["leaf_17_base", "leaf_17_shade"],
  leaf_30: ["leaf_30_base", "leaf_30_shade"],
  leaf_54: ["leaf_54"],
};
const allTargetIds = new Set(Object.values(LEAF_IDS).flat());

const backgroundElements = allElements.filter((el) => !allTargetIds.has(el.id));
const leafElements = {};
for (const [leaf, ids] of Object.entries(LEAF_IDS)) {
  // preserve original document order for correct base/shade stacking (shade drawn
  // later in the source SVG in every case, so it paints on top of base)
  leafElements[leaf] = ids
    .map((id) => allElements.find((el) => el.id === id))
    .filter(Boolean);
}

// ---------- leaf sway (rotation-only, pivoting at the petiole/branch anchor) ----------
// Same "two extremes per half-cycle + ease bezier" pendulum technique as
// grass_01~07 in build-scene.mjs, just slower and with a much smaller amplitude
// so it reads as a gentle sway consistent with the background scene's pacing.
const LEAF_T = 300; // 10s per full back-and-forth cycle (grass is 60f/2s -- leaves are ~5x slower)
const LEAF_HALF = LEAF_T / 2;
const ease = { o: { x: [0.42], y: [0] }, i: { x: [0.58], y: [1] } };

const ANCHORS = {
  leaf_01: { x: 488.6, y: 194.8 },
  leaf_17: { x: 404.1, y: 285.8 },
  leaf_30: { x: 685.3, y: 395.7 },
  leaf_54: { x: 398.2, y: 488.3 },
};
// alternating start sign (like GRASS_PHASE) so neighbors don't swing in lockstep,
// plus a small per-leaf amplitude variation for a more organic, non-mechanical feel
const LEAF_SWAY = {
  leaf_01: { sign: 1, amplitude: 1.6 },
  leaf_17: { sign: -1, amplitude: 1.4 },
  leaf_30: { sign: 1, amplitude: 1.8 },
  leaf_54: { sign: -1, amplitude: 1.3 },
};

function leafRotationKs(anchor, startSign, amplitude) {
  const ks = baseLayerTransform();
  const anchorArr = [anchor.x, anchor.y, 0];
  ks.a = { a: 0, k: anchorArr };
  ks.p = { a: 0, k: anchorArr };
  const keyframes = [];
  let sign = startSign;
  for (let t = 0; t <= OP; t += LEAF_HALF) {
    const s = [sign * amplitude];
    keyframes.push(t === OP ? { t, s } : { t, s, ...ease });
    sign = -sign;
  }
  ks.r = { a: 1, k: keyframes };
  return ks;
}

function makeLeafLayer(leafName, index) {
  const elements = leafElements[leafName];
  const shapes = elements.slice().reverse().map(shapeItemFor); // shade (later in doc) on top of base
  const { sign, amplitude } = LEAF_SWAY[leafName];
  const ks = leafRotationKs(ANCHORS[leafName], sign, amplitude);
  return { ddd: 0, ty: 4, nm: leafName, sr: 1, ks, ao: 0, ip: 0, op: OP, st: 0, ind: index, shapes };
}

// ---------- assemble ----------
// Simplification note (prototype only): the 4 leaves are pulled out of the flat
// paint order and rendered as separate top-most layers so each can rotate
// independently. They no longer interleave with the surrounding static leaves'
// original z-order -- acceptable for validating the sway motion, but a
// production version would need to preserve exact paint order around them.
const leafCount = Object.keys(LEAF_IDS).length;
const layers = [
  ...Object.keys(LEAF_IDS).map((leafName, i) => makeLeafLayer(leafName, i + 1)),
  // reverse so later-in-document (topmost in SVG paint order) ends up first
  // in Lottie's layers array, matching build-scene.mjs's convention.
  ...backgroundElements.slice().reverse().map((el, i) => makeSingleElementLayer(el, leafCount + i + 1)),
];

const lottie = {
  v: "5.7.0", fr: FPS, ip: 0, op: OP, w: CANVAS_W, h: CANVAS_H,
  nm: "Leaf Sway Test (leaf_01, leaf_17, leaf_30, leaf_54)",
  assets: [], layers,
};

fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(lottie, null, 2));
console.log("Wrote", OUT_JSON, "| layers:", layers.length, "| background elements:", backgroundElements.length);
for (const leafName of Object.keys(LEAF_IDS)) {
  console.log(" ", leafName, "anchor:", ANCHORS[leafName], "sway:", LEAF_SWAY[leafName]);
}
