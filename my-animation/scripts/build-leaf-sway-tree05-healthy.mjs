// Leaf-sway build for tree_fg_05_maturetree_healthy.svg (the mature tree,
// bigger/bushier than the tree_04 small tree). Does NOT touch the source SVG
// -- writes only to public/_test_leaf_sway_tree05_healthy.json.
//
// Structure differs from tree_04: the canopy "volume" is 3 puffy static crown
// clusters (crown_left_01/shadow/02, crown_upper_01/02/03/light_left/right,
// crown_right_01/shadow/02) plus trunk_main, all of which stay static; on top
// of that sit 30 individual leaf_01~30 groups (each _base+_half) which sway,
// same grass-style technique as tree_04. Unlike tree_04 healthy's 43-sway/
// 19-static split, ALL 30 leaves sway here -- there's already plenty of static
// visual mass from the 3 crown clusters, so no need to hold any leaves still.
import fs from "node:fs";
import path from "node:path";
import parseSvgPath from "parse-svg-path";
import absSvgPath from "abs-svg-path";

const SRC = "../tree-stages/tree_fg_05_maturetree_healthy.svg";
const OUT_JSON = "public/_test_leaf_sway_tree05_healthy.json";
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
  const id = getAttr(raw, "id");
  const leafGroup = getAttr(raw, "data-leaf-group") || (/^leaf_\d+$/.test(id) ? id : null);
  allElements.push({ id, d: getAttr(raw, "d"), fill: getFill(raw), leafGroup });
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

// ---------- assemble layers, preserving exact original document z-order ----------
const orderedElements = allElements.slice().reverse(); // topmost-in-SVG first
const layers = orderedElements.map((el, i) => {
  const ks = el.leafGroup && SWAY_SET.has(el.leafGroup) ? SWAY_KS[el.leafGroup] : baseLayerTransform();
  return {
    ddd: 0, ty: 4, nm: el.id, sr: 1, ks, ao: 0,
    ip: 0, op: OP, st: 0, ind: i + 1, shapes: [shapeItemFor(el)],
  };
});

const lottie = {
  v: "5.7.0", fr: FPS, ip: 0, op: OP, w: CANVAS_W, h: CANVAS_H,
  nm: "Tree05 Mature Tree Healthy - Leaf Sway (30/30 sway)",
  assets: [], layers,
};

fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(lottie, null, 2));
console.log("\nWrote", OUT_JSON, "| layers:", layers.length);
