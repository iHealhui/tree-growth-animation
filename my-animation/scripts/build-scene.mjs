import fs from "node:fs";
import path from "node:path";
import {
  groupData,
  svgPathToLottieShape,
  pointsToLottieShape,
  fillItemFor,
} from "./svg-to-lottie.mjs";

const FPS = 30;
const OP = 900; // 30s master loop
const MARGIN = 25;
const CANVAS_W = 1000;
const CANVAS_H = 1000;
const OUT_DIR = "public/projects/tree-growth/scene-1";

// ---------- shape building ----------
function elementToContours(el) {
  if (el.type === "path") return svgPathToLottieShape(el.d);
  if (el.type === "polyline" || el.type === "polygon")
    return pointsToLottieShape(el.points);
  if (el.type === "rect") return null; // handled separately
  throw new Error("unhandled element type " + el.type);
}

function contourBbox(contour) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of contour.v) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

function groupBbox(group) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const el of group.elements) {
    if (el.type === "rect") {
      minX = Math.min(minX, el.x);
      maxX = Math.max(maxX, el.x + el.width);
      minY = Math.min(minY, el.y);
      maxY = Math.max(maxY, el.y + el.height);
      continue;
    }
    const contours = elementToContours(el);
    for (const c of contours) {
      const b = contourBbox(c);
      minX = Math.min(minX, b.minX);
      maxX = Math.max(maxX, b.maxX);
      minY = Math.min(minY, b.minY);
      maxY = Math.max(maxY, b.maxY);
    }
  }
  return { minX, maxX, minY, maxY };
}

function shapeItemGroup(el, idx) {
  if (el.type === "rect") {
    const rc = {
      ty: "rc",
      nm: "rect",
      p: { a: 0, k: [el.x + el.width / 2, el.y + el.height / 2] },
      s: { a: 0, k: [el.width, el.height] },
      r: { a: 0, k: 0 },
    };
    return {
      ty: "gr",
      nm: el.id || "rect-" + idx,
      it: [rc, fillItemFor(el.fill), identityTransform()],
    };
  }
  const contours = elementToContours(el);
  const it = contours.map((c, i) => ({
    ty: "sh",
    nm: "path-" + i,
    ks: { a: 0, k: { c: c.closed, v: c.v, i: c.i, o: c.o } },
  }));
  it.push(fillItemFor(el.fill));
  it.push(identityTransform());
  return { ty: "gr", nm: el.id || "shape-" + idx, it };
}

function identityTransform() {
  return {
    ty: "tr",
    p: { a: 0, k: [0, 0] },
    a: { a: 0, k: [0, 0] },
    s: { a: 0, k: [100, 100] },
    r: { a: 0, k: 0 },
    o: { a: 0, k: 100 },
  };
}

function baseLayerTransform() {
  return {
    o: { a: 0, k: 100 },
    r: { a: 0, k: 0 },
    p: { a: 0, k: [0, 0, 0] },
    a: { a: 0, k: [0, 0, 0] },
    s: { a: 0, k: [100, 100, 100] },
  };
}

function buildShapesForGroup(group) {
  // reverse so Lottie's reverse-stack rendering matches SVG paint order
  return group.elements.slice().reverse().map((el, i) => shapeItemGroup(el, i));
}

function makeLayer(group, ks, index) {
  return {
    ddd: 0,
    ty: 4,
    nm: group.id,
    sr: 1,
    ks,
    ao: 0,
    ip: 0,
    op: OP,
    st: 0,
    ind: index,
    shapes: buildShapesForGroup(group),
  };
}

// ---------- cloud animation ----------
function cloudBbox(id) {
  const group = groupData.find((g) => g.id === id);
  return groupBbox(group);
}

// lottie-web's SVG renderer (confirmed against bodymovin/lottie-web 5.12.2)
// needs every non-terminal keyframe to carry BOTH an "o" (out) and "i" (in)
// bezier handle, and the terminal keyframe to carry NEITHER -- the AE/spec
// convention of "o" on all-but-last + "i" on all-but-first (which is what
// e.g. the grass-sway rotation below also happens to follow) silently fails
// to render at all in this renderer if applied to a *position* property.
// LINEAR uses handles colinear with the diagonal, which is a mathematically
// exact linear ramp.
const LINEAR_O = { x: [0.333], y: [0.333] };
const LINEAR_I = { x: [0.667], y: [0.667] };

function withLinearHandles(keyframes) {
  const lastIdx = keyframes.length - 1;
  return keyframes.map((k, idx) => {
    if (idx === lastIdx) {
      const { o, i, ...rest } = k;
      return rest;
    }
    return { ...k, o: LINEAR_O, i: LINEAR_I };
  });
}

function cloudPositionKs(id, phaseFrames) {
  const bbox = cloudBbox(id);
  const width = bbox.maxX - bbox.minX;
  const xStart = -MARGIN - bbox.maxX; // delta so right edge sits at -MARGIN
  const xEnd = CANVAS_W + MARGIN - bbox.minX; // delta so left edge sits at W+MARGIN
  const D = xEnd - xStart;

  const ks = baseLayerTransform();
  if (phaseFrames === 0) {
    ks.p = {
      a: 1,
      k: withLinearHandles([
        { t: 0, s: [xStart, 0, 0] },
        { t: OP, s: [xEnd, 0, 0] },
      ]),
    };
  } else {
    // value of the periodic ramp at local time `lt` (frames into own 0..OP cycle)
    const valueAt = (lt) => xStart + (D * (lt % OP)) / OP;
    const startVal = valueAt(phaseFrames);
    const wrapFrame = OP - phaseFrames; // master frame where local cycle wraps
    ks.p = {
      a: 1,
      k: withLinearHandles([
        { t: 0, s: [startVal, 0, 0] },
        { t: wrapFrame, s: [xEnd, 0, 0], h: 1 },
        { t: wrapFrame + 1, s: [xStart, 0, 0] },
        { t: OP, s: [startVal, 0, 0] },
      ]),
    };
  }
  return ks;
}

// ---------- grass animation ----------
// One breeze sway cycle = GRASS_T frames (must divide OP for a seamless
// master loop). Only the two extremes (+/-3deg) are keyframed -- the 0deg
// crossing is NOT a keyframe, so ease-in-out slows down at the turnarounds
// only and passes through center at full speed, like a real pendulum/breeze
// instead of pausing at three stops (left/center/right) per cycle.
const GRASS_T = 60; // 2s per full back-and-forth cycle -> 15 repeats in 900f
const GRASS_HALF = GRASS_T / 2; // 30f per swing from one extreme to the other
const GRASS_AMPLITUDE_DEFAULT = 3;

function grassRotationKs(group, startSign, amplitude) {
  const bbox = groupBbox(group);
  const anchor = [(bbox.minX + bbox.maxX) / 2, bbox.maxY, 0];
  const ks = baseLayerTransform();
  ks.a = { a: 0, k: anchor };
  ks.p = { a: 0, k: anchor };
  const ease = { o: { x: [0.42], y: [0] }, i: { x: [0.58], y: [1] } };
  const keyframes = [];
  let sign = startSign;
  for (let t = 0; t <= OP; t += GRASS_HALF) {
    const s = [sign * amplitude];
    keyframes.push(t === OP ? { t, s } : { t, s, ...ease });
    sign = -sign;
  }
  ks.r = { a: 1, k: keyframes };
  return ks;
}

// ---------- assemble ----------
const CLOUD_PHASE = { cloud_01: 0, cloud_02: 300 };
// starting sign (+1 / -1) per blade so neighbors swing opposite ways
const GRASS_PHASE = {
  grass_01: 1,
  grass_02: -1,
  grass_03: 1,
  grass_04: -1,
  grass_05: 1,
  grass_06: -1,
  grass_07: 1,
};
// per-blade amplitude override (degrees). grass_04 sits right at the mound's
// edge, so its default swing exposed the soil behind its root -- keep it small.
const GRASS_AMPLITUDE = {
  grass_04: 0.4,
};

const orderedGroups = groupData.slice().reverse(); // topmost first for Lottie layers[]
const layers = orderedGroups.map((group, i) => {
  let ks;
  if (group.id in CLOUD_PHASE) {
    ks = cloudPositionKs(group.id, CLOUD_PHASE[group.id]);
  } else if (group.id in GRASS_PHASE) {
    const amplitude = GRASS_AMPLITUDE[group.id] ?? GRASS_AMPLITUDE_DEFAULT;
    ks = grassRotationKs(group, GRASS_PHASE[group.id], amplitude);
  } else {
    ks = baseLayerTransform();
  }
  return makeLayer(group, ks, i + 1);
});

const lottie = {
  v: "5.7.0",
  fr: FPS,
  ip: 0,
  op: OP,
  w: CANVAS_W,
  h: CANVAS_H,
  nm: "Tree Growth Background",
  assets: [],
  layers,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "lottie.json"), JSON.stringify(lottie, null, 2));
console.log("Wrote", path.join(OUT_DIR, "lottie.json"), "layers:", layers.length);

// print cloud metrics for verification
for (const id of Object.keys(CLOUD_PHASE)) {
  const bbox = cloudBbox(id);
  console.log(id, bbox, "width:", bbox.maxX - bbox.minX);
}
