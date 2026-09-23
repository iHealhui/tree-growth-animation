// Debug-only: renders the raw source SVG with small numbered red dot markers
// at each computed sway-leaf anchor, so anchors can be eyeballed in one shot
// instead of one-by-one. Reads scripts/build-leaf-sway-full.mjs's own anchor
// computation by re-running it (console output is not reused; this is a
// standalone visual check, writes only public/_debug_leaf_anchors.html).
import fs from "node:fs";
import path from "node:path";
import parseSvgPath from "parse-svg-path";
import absSvgPath from "abs-svg-path";

const SRC = "../tree-stages/tree_fg_04_smalltree_healthy.svg";
const OUT_HTML = "public/_debug_leaf_anchors.html";

const svgText = fs.readFileSync(SRC, "utf8");
const defsEnd = svgText.indexOf("</defs>") + "</defs>".length;
const bodyText = svgText.slice(defsEnd);

function getAttr(tag, name) {
  const m = tag.match(new RegExp("\\s" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '="([^"]*)"'));
  return m ? m[1] : null;
}

function svgPathVerts(d) {
  const segs = absSvgPath(parseSvgPath(d));
  const verts = [];
  let cx = 0, cy = 0;
  for (const seg of segs) {
    const type = seg[0];
    if (type === "M" || type === "L") { cx = seg[1]; cy = seg[2]; verts.push([cx, cy]); }
    else if (type === "H") { cx = seg[1]; verts.push([cx, cy]); }
    else if (type === "V") { cy = seg[1]; verts.push([cx, cy]); }
    else if (type === "C") { cx = seg[5]; cy = seg[6]; verts.push([cx, cy]); }
    else if (type === "S") { cx = seg[3]; cy = seg[4]; verts.push([cx, cy]); }
  }
  return verts;
}

const pathRe = /<path\b([^>]*?)\/>/g;
const allElements = [];
let m;
while ((m = pathRe.exec(bodyText))) {
  const raw = m[0];
  const id = getAttr(raw, "id");
  const leafGroup = getAttr(raw, "data-leaf-group") || (/^leaf_\d+$/.test(id) ? id : null);
  allElements.push({ id, d: getAttr(raw, "d"), leafGroup });
}

const SWAY_IDS = [
  "leaf_01", "leaf_02", "leaf_03", "leaf_04", "leaf_05", "leaf_06", "leaf_07", "leaf_08", "leaf_09",
  "leaf_10", "leaf_11", "leaf_12", "leaf_13", "leaf_16", "leaf_17", "leaf_19", "leaf_20", "leaf_25",
  "leaf_26", "leaf_30", "leaf_31", "leaf_35", "leaf_37", "leaf_39", "leaf_40", "leaf_43", "leaf_44",
  "leaf_46", "leaf_47", "leaf_48", "leaf_49", "leaf_50", "leaf_52", "leaf_53", "leaf_54", "leaf_55",
  "leaf_56", "leaf_57", "leaf_58", "leaf_59", "leaf_60", "leaf_61",
];
const REF_IDS = new Set(["trunk_main", "branch_01", "branch_02", "branch_03", "branch_04", "branch_05", "branch_06", "branch_07"]);

const refVerts = [];
for (const el of allElements.filter((e) => REF_IDS.has(e.id))) {
  for (const v of svgPathVerts(el.d)) refVerts.push(v);
}

function leafVertices(leafGroup) {
  const verts = [];
  for (const el of allElements.filter((e) => e.leafGroup === leafGroup)) {
    for (const v of svgPathVerts(el.d)) verts.push(v);
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
  return best;
}

const anchors = SWAY_IDS.map((leafGroup) => {
  const [x, y] = findAnchor(leafGroup);
  return { leafGroup, x, y };
});

const markers = anchors.map(({ leafGroup, x, y }) => `
  <circle cx="${x}" cy="${y}" r="4" fill="red" stroke="white" stroke-width="0.8"/>
  <text x="${x + 6}" y="${y - 4}" font-size="10" fill="black" stroke="white" stroke-width="2" paint-order="stroke">${leafGroup.replace('leaf_', '')}</text>
  <text x="${x + 6}" y="${y - 4}" font-size="10" fill="black">${leafGroup.replace('leaf_', '')}</text>
`).join("\n");

const svgWithMarkers = svgText.replace("</svg>", markers + "\n</svg>");

const html = `<!DOCTYPE html>
<html><head><title>Leaf anchor preview</title></head>
<body style="margin:0;background:#eef6ea;">
${svgWithMarkers.replace('<svg ', '<svg style="width:100vw;height:100vh;display:block" ')}
</body></html>`;

fs.mkdirSync(path.dirname(OUT_HTML), { recursive: true });
fs.writeFileSync(OUT_HTML, html);
console.log("Wrote", OUT_HTML, "with", anchors.length, "anchor markers");
