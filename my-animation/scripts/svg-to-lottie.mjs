import fs from "node:fs";
import parseSvgPath from "parse-svg-path";
import absSvgPath from "abs-svg-path";

const SRC = "../Tree Growth_Background.svg";
const OUT_DIR = "public/projects/tree-growth/scene-1";
const svgText = fs.readFileSync(SRC, "utf8");

// ---------- attribute helpers ----------
function getAttr(tag, name) {
  // require a preceding whitespace so e.g. name="d" doesn't match inside id="..."
  const m = tag.match(new RegExp("\\s" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '="([^"]*)"'));
  return m ? m[1] : null;
}

// ---------- gradients ----------
const defsMatch = svgText.match(/<defs>([\s\S]*?)<\/defs>/);
const defsText = defsMatch[1];
const gradientTags = defsText.match(
  /<linearGradient\b[^>]*\/>|<linearGradient\b[^>]*[^/]>[\s\S]*?<\/linearGradient>/g
);

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
      stops.push({
        offset: parseFloat(getAttr(s, "offset")),
        color: getAttr(s, "stop-color"),
      });
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
  // supports "translate(x y)" "translate(x)" "scale(x y)" chained
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
  if (g.href && stops.length === 0) {
    stops = resolveGradient(g.href).stops;
  }
  if (x1 === null) {
    const base = resolveGradient(g.href);
    x1 = base.x1; y1 = base.y1; x2 = base.x2; y2 = base.y2;
  }
  const { tx, ty, sx, sy } = parseTransform(g.gradientTransform);
  x1 = x1 * sx + tx;
  y1 = y1 * sy + ty;
  x2 = x2 * sx + tx;
  y2 = y2 * sy + ty;
  return { x1, y1, x2, y2, stops };
}

function hexToRgb1(hex) {
  hex = hex.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  return [r, g, b];
}

// ---------- path -> lottie shape ----------
function svgPathToLottieShape(d) {
  const segs = absSvgPath(parseSvgPath(d)); // absolute M L H V C S Z (H/V expanded to L by abs-svg-path)
  const subpaths = [];
  let current = null;
  let cx = 0, cy = 0;
  let sx = 0, sy = 0;
  let prevCtrl = null; // for S reflection
  let prevType = null;

  function pushVertex(x, y) {
    current.vertices.push({ v: [x, y], i: [0, 0], o: [0, 0] });
  }
  function setOutOfLast(dx, dy) {
    current.vertices[current.vertices.length - 1].o = [dx, dy];
  }

  for (const seg of segs) {
    const type = seg[0];
    if (type === "M") {
      current = { vertices: [], closed: false };
      subpaths.push(current);
      cx = seg[1]; cy = seg[2];
      sx = cx; sy = cy;
      pushVertex(cx, cy);
      prevType = "M";
    } else if (type === "L") {
      const x = seg[1], y = seg[2];
      pushVertex(x, y);
      cx = x; cy = y;
      prevType = "L";
    } else if (type === "H") {
      const x = seg[1];
      pushVertex(x, cy);
      cx = x;
      prevType = "H";
    } else if (type === "V") {
      const y = seg[1];
      pushVertex(cx, y);
      cy = y;
      prevType = "V";
    } else if (type === "C") {
      const [x1, y1, x2, y2, x, y] = seg.slice(1);
      setOutOfLast(x1 - cx, y1 - cy);
      current.vertices.push({ v: [x, y], i: [x2 - x, y2 - y], o: [0, 0] });
      prevCtrl = [x2, y2];
      cx = x; cy = y;
      prevType = "C";
    } else if (type === "S") {
      const [x2, y2, x, y] = seg.slice(1);
      let x1, y1;
      if (prevType === "C" || prevType === "S") {
        x1 = cx + (cx - prevCtrl[0]);
        y1 = cy + (cy - prevCtrl[1]);
      } else {
        x1 = cx; y1 = cy;
      }
      setOutOfLast(x1 - cx, y1 - cy);
      current.vertices.push({ v: [x, y], i: [x2 - x, y2 - y], o: [0, 0] });
      prevCtrl = [x2, y2];
      cx = x; cy = y;
      prevType = "S";
    } else if (type === "Z" || type === "z") {
      current.closed = true;
      cx = sx; cy = sy;
      prevType = "Z";
    } else {
      throw new Error("Unsupported segment type: " + type + " in path: " + d);
    }
  }

  // Lottie shape only supports one contour per "sh" item; if multiple
  // subpaths exist, caller should create one shape per subpath.
  return subpaths.map((sp) => ({
    closed: sp.closed,
    v: sp.vertices.map((pt) => pt.v),
    i: sp.vertices.map((pt) => pt.i),
    o: sp.vertices.map((pt) => pt.o),
  }));
}

function pointsToLottieShape(pointsStr) {
  const nums = pointsStr.trim().split(/[\s,]+/).map(Number);
  const v = [];
  for (let i = 0; i < nums.length; i += 2) v.push([nums[i], nums[i + 1]]);
  return [{ closed: true, v, i: v.map(() => [0, 0]), o: v.map(() => [0, 0]) }];
}

function makeShapePathItem(contour, nm) {
  return {
    ty: "sh",
    nm,
    ks: {
      a: 0,
      k: { c: contour.closed, v: contour.v, i: contour.i, o: contour.o },
    },
  };
}

function makeSolidFill(hex) {
  const [r, g, b] = hexToRgb1(hex);
  return { ty: "fl", nm: "fill", c: { a: 0, k: [r, g, b, 1] }, o: { a: 0, k: 100 } };
}

function makeGradientFill(gradId) {
  const grad = resolveGradient(gradId);
  const gs = grad.stops
    .slice()
    .sort((a, b) => a.offset - b.offset)
    .map((s) => ({ offset: s.offset, rgb: hexToRgb1(s.color) }));
  const k = [];
  for (const s of gs) k.push(s.offset, ...s.rgb);
  return {
    ty: "gf",
    nm: "gradient-fill",
    o: { a: 0, k: 100 },
    t: 1, // linear
    s: { a: 0, k: [grad.x1, grad.y1] },
    e: { a: 0, k: [grad.x2, grad.y2] },
    g: { p: gs.length, k: { a: 0, k } },
  };
}

function fillItemFor(fillAttr) {
  if (!fillAttr) return makeSolidFill("#000000");
  const urlMatch = fillAttr.match(/url\(#(.*)\)/);
  if (urlMatch) return makeGradientFill(urlMatch[1]);
  return makeSolidFill(fillAttr);
}

// ---------- CSS class fills (Illustrator SVG export uses class="stN" + <style>) ----------
const styleMatch = svgText.match(/<style>([\s\S]*?)<\/style>/);
const classFillMap = {};
if (styleMatch) {
  const ruleRe = /\.(\S+)\s*\{([^}]*)\}/g;
  let rm;
  while ((rm = ruleRe.exec(styleMatch[1]))) {
    const fillMatch = rm[2].match(/fill:\s*([^;]+);?/);
    if (fillMatch) classFillMap[rm[1]] = fillMatch[1].trim();
  }
}

function getFill(raw) {
  const fillAttr = getAttr(raw, "fill");
  if (fillAttr) return fillAttr;
  const className = getAttr(raw, "class");
  if (className && classFillMap[className]) return classFillMap[className];
  return null;
}

// ---------- group extraction ----------
const groupTags = [
  ...svgText.matchAll(/<g id="([^"]+)">([\s\S]*?)<\/g>/g),
];

const groups = groupTags.map((m) => ({ id: m[1], inner: m[2] }));

function extractShapeElements(inner) {
  const elements = [];
  const re = /<(rect|path|polyline|polygon)\b([^>]*?)\/>/g;
  let m;
  while ((m = re.exec(inner))) {
    elements.push({ tag: m[1], raw: m[0], attrs: m[2] });
  }
  return elements;
}

const groupData = groups.map((g) => {
  const elements = extractShapeElements(g.inner).map((el) => {
    const fill = getFill(el.raw);
    if (el.tag === "path") {
      return { type: "path", id: getAttr(el.raw, "id"), d: getAttr(el.raw, "d"), fill };
    }
    if (el.tag === "rect") {
      return {
        type: "rect",
        id: getAttr(el.raw, "id"),
        x: parseFloat(getAttr(el.raw, "x") || "0"),
        y: parseFloat(getAttr(el.raw, "y") || "0"),
        width: parseFloat(getAttr(el.raw, "width")),
        height: parseFloat(getAttr(el.raw, "height")),
        fill,
      };
    }
    if (el.tag === "polyline" || el.tag === "polygon") {
      return { type: el.tag, id: getAttr(el.raw, "id"), points: getAttr(el.raw, "points"), fill };
    }
    return null;
  });
  return { id: g.id, elements };
});

export { groupData, svgPathToLottieShape, pointsToLottieShape, makeShapePathItem, fillItemFor, resolveGradient, hexToRgb1 };

// quick sanity dump when run directly
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  for (const g of groupData) {
    console.log(g.id, g.elements.map((e) => e && e.id).join(","));
  }
}
