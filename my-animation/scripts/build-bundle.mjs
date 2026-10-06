// Assembles a clean, engineering-team-ready delivery bundle out of the
// finished animation stages (the shared background scene + tree stages 01-05),
// and zips it. Re-run any time a stage changes; a new stage is just one more
// entry in STAGES below, nothing else in this script needs to change.
//
// Output: exports/bundle/tree-growth-bundle-<YYYY-MM-DD>/  (staging folder)
//         exports/bundle/tree-growth-bundle-<YYYY-MM-DD>.zip  (what you hand off)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const today = new Date().toISOString().slice(0, 10);
const BUNDLE_NAME = `tree-growth-bundle-${today}`;
const STAGE_DIR = path.join(ROOT, "exports", "bundle", BUNDLE_NAME);
const ZIP_PATH = path.join(ROOT, "exports", "bundle", `${BUNDLE_NAME}.zip`);
// what the previews-mp4/ videos are, shown on the preview page and in the
// README -- keep in sync with the ffmpeg recipe in public/_export_frames_stage.html
const MP4_SPEC = "1000×1000、30fps、H.264 (CRF 20)，已含背景";
const MP4_PURPOSE = "備用方案：Lottie JSON 無法播放時改播這些影片，尺寸與 Lottie 原畫布相同";
// user's call: one looping video per stage, accepting that the withered
// stages' leaves come back each cycle in the MP4 fallback
const MP4_WITHERED_NOTE = "提醒：04、05 枯萎的 MP4 是整支循環播放，每一輪開頭葉子會長回來、再重新掉落一次，這點和 Lottie 版「掉葉後永久保留」不同";

// ---------- stage manifest: add a new object here for every future
// completed stage and everything below (file copy, preview mp4 pick-up,
// README, preview page) updates automatically. ----------
const STAGES = [
  {
    key: "background",
    label: "共用背景 (background scene)",
    fps: 30, frames: 900, size: "1000x1000",
    playback: "loop",
    files: [{ src: "public/projects/tree-growth/scene-1/lottie.json", dest: "background/scene-1.json" }],
  },
  {
    key: "tree-01-healthy",
    label: "01 種子 - 健康狀態 (緩慢呼吸 + 小根輕擺;種子只有健康狀態)",
    fps: 30, frames: 900, size: "1000x1000",
    playback: "loop",
    files: [{ src: "public/_test_seed.json", dest: "tree-01-seed/healthy.json" }],
  },
  {
    key: "tree-02-healthy",
    label: "02 嫩芽 - 健康狀態 (整株弧形彎曲擺動)",
    fps: 30, frames: 900, size: "1000x1000",
    playback: "loop",
    files: [{ src: "public/_test_bend_sprout.json", dest: "tree-02-sprout/healthy.json" }],
  },
  {
    key: "tree-02-withered",
    label: "02 嫩芽 - 枯萎狀態 (較慢較小的彎曲 + 葉子緩慢下垂)",
    fps: 30, frames: 900, size: "1000x1000",
    playback: "loop",
    files: [{ src: "public/_test_bend_sprout_withered.json", dest: "tree-02-sprout/withered.json" }],
  },
  {
    key: "tree-03-healthy",
    label: "03 大樹苗 - 健康狀態 (整株弧形彎曲擺動)",
    fps: 30, frames: 900, size: "1000x1000",
    playback: "loop",
    files: [{ src: "public/_test_bend_seedling_healthy.json", dest: "tree-03-seedling/healthy.json" }],
  },
  {
    key: "tree-03-withered",
    label: "03 大樹苗 - 枯萎狀態 (整株彎曲 + 葉片跟隨擺動與搖曳)",
    fps: 30, frames: 900, size: "1000x1000",
    playback: "loop",
    files: [{ src: "public/_test_bend_seedling_withered.json", dest: "tree-03-seedling/withered.json" }],
  },
  {
    key: "tree-04-healthy",
    label: "04 小樹 - 健康狀態 (leaf-sway)",
    fps: 30, frames: 900, size: "1000x1000",
    playback: "loop",
    files: [{ src: "public/_test_leaf_sway_full.json", dest: "tree-04-small/healthy.json" }],
  },
  {
    key: "tree-04-withered",
    label: "04 小樹 - 枯萎狀態 (leaf-sway + 接力掉葉,永久保留)",
    fps: 30, frames: 900, size: "1000x1000",
    playback: "play-once-then-loop-segment",
    steadyStart: 450,
    steadyEnd: 900,
    files: [{ src: "public/_test_leaf_sway_withered.json", dest: "tree-04-small/withered.json" }],
  },
  {
    key: "tree-05-healthy",
    label: "05 成熟樹 - 健康狀態 (leaf-sway, 3 團樹冠 + 30 片葉子)",
    fps: 30, frames: 900, size: "1000x1000",
    playback: "loop",
    files: [{ src: "public/_test_leaf_sway_tree05_healthy.json", dest: "tree-05-mature/healthy.json" }],
  },
  {
    key: "tree-05-withered",
    label: "05 成熟樹 - 枯萎狀態 (23 片在樹上的葉子 + 6 片美術預畫的地面落葉, 8 片接力掉葉永久保留)",
    fps: 30, frames: 1110, size: "1000x1000",
    playback: "play-once-then-loop-segment",
    steadyStart: 810,
    steadyEnd: 1110,
    files: [{ src: "public/_test_leaf_sway_tree05_withered.json", dest: "tree-05-mature/withered.json" }],
  },
];

function rimraf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyFile(relSrc, relDest) {
  const src = path.join(ROOT, relSrc);
  const dest = path.join(STAGE_DIR, relDest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return fs.statSync(dest).size;
}

// ---------- 1. clean + copy stage files ----------
rimraf(STAGE_DIR);
fs.mkdirSync(STAGE_DIR, { recursive: true });

const manifestForReadme = [];
for (const stage of STAGES) {
  const copied = stage.files.map((f) => {
    const size = copyFile(f.src, f.dest);
    return { ...f, size };
  });
  // each stage's fallback video is picked up by convention from the tracked
  // previews-mp4/<key>.mp4 (committed, unlike exports/, so the GitHub Pages
  // build has them too). One video per stage, always looped. Regenerate with
  // public/_export_frames_stage.html + scripts/frame-server.mjs + ffmpeg (see
  // that page's header comment).
  let mp4Copied = null;
  const mp4Src = `previews-mp4/${stage.key}.mp4`;
  if (fs.existsSync(path.join(ROOT, mp4Src))) {
    mp4Copied = { dest: mp4Src, size: copyFile(mp4Src, mp4Src) };
  }
  manifestForReadme.push({ ...stage, copiedFiles: copied, mp4Copied });
  console.log("Staged:", stage.key, "->", copied.map((c) => c.dest).join(", "), mp4Copied ? `+ ${mp4Copied.dest}` : "");
}

// ---------- 2. preview/index.html: self-contained gallery, correct
// playback rule per stage (plain loop vs. play-once-then-lock-loop-segment)
// so engineering can open this straight from the zip and see the real
// intended behavior before wiring it into any site. ----------
const treeStages = manifestForReadme.filter((s) => s.key !== "background");
const treeStagesJs = JSON.stringify(
  treeStages.map((s) => ({
    key: s.key, label: s.label, playback: s.playback, path: s.files[0].dest,
    steadyStart: s.steadyStart, steadyEnd: s.steadyEnd,
    jsonDownload: s.files[0].dest,
    jsonDownloadName: `${s.key}.json`,
    mp4Download: s.mp4Copied ? s.mp4Copied.dest : null,
  })),
  null, 2
);
const buttonsHtml = treeStages.map((s) => `  <button data-stage="${s.key}">${s.label.split(" (")[0]}</button>`).join("\n");

const previewHtml = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<title>Tree Growth Animation - Preview</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/bodymovin/5.12.2/lottie.min.js"></script>
<style>
  html, body { margin: 0; padding: 0; background: #111; color: #eee; font-family: -apple-system, "Segoe UI", "Microsoft JhengHei", sans-serif; }
  .info { padding: 12px 16px; font-size: 13px; line-height: 1.6; background: #1a1a1a; border-bottom: 1px solid #333; }
  .info b { color: #ffd76b; }
  .controls { display: flex; gap: 10px; align-items: center; padding: 10px 16px; background: #1a1a1a; border-bottom: 1px solid #333; flex-wrap: wrap; }
  button { background: #2a2a2a; color: #eee; border: 1px solid #444; border-radius: 4px; padding: 6px 12px; font-size: 13px; cursor: pointer; }
  button.active { background: #3a6; border-color: #4c7; }
  button:hover { background: #3a3a3a; }
  button.active:hover { background: #4b8; }
  .stage-wrap { display: flex; justify-content: center; padding: 20px; }
  .stage {
    position: relative; width: 700px; height: 700px;
    background: linear-gradient(45deg, #333 25%, transparent 25%), linear-gradient(-45deg, #333 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #333 75%), linear-gradient(-45deg, transparent 75%, #333 75%);
    background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
    background-color: #222; border: 1px solid #444;
  }
  .layer { position: absolute; inset: 0; width: 100%; height: 100%; }
  #stateLabel { font-size: 12px; color: #8f8; }
  .controls label { font-size: 13px; display: flex; align-items: center; gap: 6px; }
  #video-layer { display: none; object-fit: contain; }
  .downloads { display: flex; gap: 10px; align-items: center; padding: 10px 16px; background: #1a1a1a; border-bottom: 1px solid #333; flex-wrap: wrap; }
  .downloads a { color: #eee; background: #2a4a2a; border: 1px solid #4a7a4a; border-radius: 4px; padding: 6px 12px; font-size: 13px; text-decoration: none; }
  .downloads a:hover { background: #3a6a3a; }
  .downloads a.disabled { opacity: 0.4; pointer-events: none; }
  .downloads .sep { width: 1px; height: 18px; background: #444; }
  .downloads .note { font-size: 12px; color: #aaa; }
  .downloads .note .warn { color: #ffd76b; font-weight: normal; }
</style>
</head>
<body>

<div class="info">
  <b>Tree Growth Animation Bundle</b> 預覽頁。切換下方按鈕檢視各階段動畫疊加在共用背景上的效果。
  04、05 枯萎狀態的葉子是<b>接力掉落後永久保留</b>(不會自動復原)：完整播放一次後只會循環搖曳段，只有重新整理本頁面才會回到滿葉狀態，這是刻意設計，細節見 README.md。
</div>

<div class="controls">
  <span>疊加圖層:</span>
  <button data-stage="none" class="active">無</button>
${buttonsHtml}
  <label><input type="checkbox" id="useMp4"> 改用 MP4 備用方案播放</label>
  <span id="stateLabel"></span>
</div>

<div class="downloads">
  <span>下載:</span>
  <a id="dlJson" class="disabled" download>目前階段的 Lottie JSON</a>
  <a id="dlMp4" class="disabled" download>目前階段的 MP4 (備用)</a>
  <div class="sep"></div>
  <a id="dlZip" href="download/${BUNDLE_NAME}.zip" download="${BUNDLE_NAME}.zip">下載完整交付包 (.zip)</a>
  <span class="note">MP4 規格：${MP4_SPEC}，${MP4_PURPOSE}。<b class="warn">${MP4_WITHERED_NOTE}。</b></span>
</div>

<div class="stage-wrap">
  <div class="stage">
    <div id="bg-layer" class="layer"></div>
    <div id="tree-layer" class="layer"></div>
    <video id="video-layer" class="layer" muted playsinline></video>
  </div>
</div>

<script>
  const TREE_STAGES = ${treeStagesJs};
  const stateLabel = document.getElementById('stateLabel');
  const bgAnim = lottie.loadAnimation({
    container: document.getElementById('bg-layer'),
    renderer: 'svg', loop: true, autoplay: true,
    path: 'background/scene-1.json',
  });

  const dlJson = document.getElementById('dlJson');
  const dlMp4 = document.getElementById('dlMp4');
  function setLink(a, href, name) {
    if (href) { a.href = href; a.download = name; a.classList.remove('disabled'); }
    else { a.classList.add('disabled'); a.removeAttribute('href'); }
  }
  function updateDownloadLinks(stage) {
    setLink(dlJson, stage && stage.jsonDownload, stage && stage.jsonDownloadName);
    setLink(dlMp4, stage && stage.mp4Download, stage && stage.key + '.mp4');
  }

  const useMp4 = document.getElementById('useMp4');
  const video = document.getElementById('video-layer');
  const lottieLayers = [document.getElementById('bg-layer'), document.getElementById('tree-layer')];
  function showVideo(on) {
    video.style.display = on ? 'block' : 'none';
    lottieLayers.forEach((el) => { el.style.visibility = on ? 'hidden' : 'visible'; });
  }

  let treeAnim = null;
  function clearTree() {
    if (treeAnim) { treeAnim.destroy(); treeAnim = null; }
    document.getElementById('tree-layer').innerHTML = '';
    video.pause(); video.removeAttribute('src'); video.load();
    showVideo(false);
    stateLabel.textContent = '';
  }

  // MP4 fallback: the videos already include the background, so the Lottie
  // layers are hidden. Every stage is one looping video -- for the play-once
  // (withered 04/05) stages that means the leaves come back each cycle,
  // unlike the Lottie version (accepted trade-off, noted on the page).
  function loadStageVideo(stage) {
    showVideo(true);
    video.src = stage.mp4Download;
    video.loop = true;
    stateLabel.textContent = stage.playback === 'loop'
      ? 'MP4 備用方案:循環播放中'
      : 'MP4 備用方案:整支循環播放中(每一輪葉子會重新掉落,和 Lottie 版不同)';
    video.play();
  }

  let currentStage = null;
  function loadStage(stage) {
    clearTree();
    currentStage = stage;
    updateDownloadLinks(stage);
    if (useMp4.checked && stage.mp4Download) { loadStageVideo(stage); return; }
    if (stage.playback === 'loop') {
      treeAnim = lottie.loadAnimation({
        container: document.getElementById('tree-layer'),
        renderer: 'svg', loop: true, autoplay: true,
        path: stage.path,
      });
      stateLabel.textContent = '循環播放中';
      return;
    }
    // play-once-then-loop-segment: play the whole thing once (intro + relay
    // fall), then lock into looping ONLY the surviving-leaves' sway segment
    // forever -- never revisit frame 0, so fallen leaves never come back on
    // their own. Reloading this page is what resets everything.
    treeAnim = lottie.loadAnimation({
      container: document.getElementById('tree-layer'),
      renderer: 'svg', loop: false, autoplay: true,
      path: stage.path,
    });
    stateLabel.textContent = '播放中:完整序列(葉子依序掉落)';
    treeAnim.addEventListener('complete', () => {
      treeAnim.setLoop(true);
      treeAnim.playSegments([[stage.steadyStart, stage.steadyEnd]], true);
      stateLabel.textContent = '葉子已掉落並永久保留(只循環存活葉片搖曳,重整頁面才復原)';
    });
  }

  function setActive(btn) {
    document.querySelectorAll('.controls button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  }

  document.querySelectorAll('.controls button').forEach((btn) => {
    btn.addEventListener('click', () => {
      setActive(btn);
      const key = btn.dataset.stage;
      if (key === 'none') { clearTree(); currentStage = null; updateDownloadLinks(null); return; }
      loadStage(TREE_STAGES.find((s) => s.key === key));
    });
  });
  useMp4.addEventListener('change', () => { if (currentStage) loadStage(currentStage); });

  // default to the first tree stage
  const firstBtn = document.querySelector('.controls button[data-stage="${treeStages[0]?.key ?? "none"}"]');
  if (firstBtn) { setActive(firstBtn); loadStage(TREE_STAGES[0]); }
</script>

</body>
</html>
`;
fs.mkdirSync(path.join(STAGE_DIR, "preview"), { recursive: true });
// preview/index.html references paths like "background/scene-1.json" relative
// to itself, so symlink-free: just also copy every stage's own top-level
// folder next to it (derived from each file's dest, e.g.
// "tree-05-mature/withered.json" -> copy the "tree-05-mature" folder).
const copiedTopFolders = new Set();
for (const stage of STAGES) {
  for (const f of stage.files) {
    const topFolder = f.dest.split("/")[0];
    if (copiedTopFolders.has(topFolder)) continue;
    copiedTopFolders.add(topFolder);
    fs.cpSync(path.join(STAGE_DIR, topFolder), path.join(STAGE_DIR, "preview", topFolder), { recursive: true });
  }
}
// also copy previews-mp4/ next to the preview page so the per-stage MP4
// download link resolves without reaching outside the preview/ folder.
if (fs.existsSync(path.join(STAGE_DIR, "previews-mp4"))) {
  fs.cpSync(path.join(STAGE_DIR, "previews-mp4"), path.join(STAGE_DIR, "preview", "previews-mp4"), { recursive: true });
  copiedTopFolders.add("previews-mp4");
}
fs.writeFileSync(path.join(STAGE_DIR, "preview", "index.html"), previewHtml);
console.log("Wrote preview/index.html (+ copies of:", [...copiedTopFolders].join(", "), ")");

// ---------- 3. README.md ----------
function fmtBytes(n) {
  if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + " MB";
  return (n / 1024).toFixed(1) + " KB";
}

const readmeSections = manifestForReadme.map((s) => {
  const fileLines = s.copiedFiles.map((f) => `  - \`${f.dest}\` (${fmtBytes(f.size)})`).join("\n");
  const mp4Line = !s.mp4Copied ? "" : s.playback === "loop"
    ? `\n  - \`${s.mp4Copied.dest}\` (${fmtBytes(s.mp4Copied.size)}, MP4 備用, 剛好一輪, 直接循環播放)`
    : `\n  - \`${s.mp4Copied.dest}\` (${fmtBytes(s.mp4Copied.size)}, MP4 備用, 含掉葉過程, 整支循環播放 -- **每一輪葉子會長回再重新掉落**, 和 Lottie 版不同)`;
  let playbackNote;
  if (s.playback === "loop") {
    playbackNote = `播放方式: 簡單無限循環 (\`loop: true\`)，${s.frames} frame 首尾已對齊，直接循環不會有跳動。`;
  } else if (s.playback === "play-once-then-loop-segment") {
    playbackNote = [
      "播放方式: **不能單純無限循環整段** (那樣掉落的葉子每次循環都會跳回原位，等於自動復原，跟設計意圖相反)。",
      "",
      "正確做法:",
      "```js",
      "const anim = lottie.loadAnimation({",
      "  container, renderer: 'svg',",
      "  loop: false, autoplay: true,   // 先完整播放一次 (含掉葉序列)",
      `  path: '${s.files[0].dest}',`,
      "});",
      "// 播放到底 (frame 0 -> " + s.frames + ") 後，改成只循環存活葉片搖曳的那一段，",
      "// 掉落的葉子從此不會再回來，直到整個頁面重新載入(重新建立這個 Lottie 實例)。",
      "anim.addEventListener('complete', () => {",
      "  anim.setLoop(true);",
      `  anim.playSegments([[${s.steadyStart}, ${s.steadyEnd}]], true);`,
      "});",
      "```",
      "",
      `這代表「掉葉後永久保留」是一個**頁面狀態**，不是影片/動畫檔本身能表現的效果 -- 純粹循環播放這支 JSON 檔案(例如當成背景影片或用預設的 loop:true 播放器)會讓葉子每 ${s.frames / s.fps}s 重新長出來一次，跟設計不符。務必照上面的邏輯接。`,
    ].join("\n");
  }
  return `## ${s.label}\n\n- 規格: ${s.size}px, ${s.fps}fps, ${s.frames} frames (${(s.frames / s.fps).toFixed(1)}s)\n- 檔案:\n${fileLines}${mp4Line}\n\n${playbackNote}\n`;
});

const readme = `# Tree Growth Animation Bundle

產生時間: ${new Date().toISOString()}
來源: tree-growth-animation 專案 (\`my-animation/scripts/build-bundle.mjs\`)

## 這份交付包裡有什麼

- 所有動畫都是標準 Lottie/Bodymovin JSON，可以用 \`lottie-web\`(網頁)、\`lottie-react-native\`、After Effects Bodymovin 外掛等任何支援 Lottie 的播放器開啟。
- \`preview/index.html\`：獨立、可直接雙擊在瀏覽器打開的預覽頁(內含 lottie-web CDN 連結，需要網路)，可以切換各階段疊加在背景上的效果，並且正確示範了枯萎樹「掉葉永久保留」的播放邏輯。勾選「改用 MP4 備用方案播放」可以看備用影片的實際效果。
- \`previews-mp4/\`：每個階段的 MP4 備用影片(${MP4_SPEC})。${MP4_PURPOSE}。用法見下方「MP4 備用方案」。

## MP4 備用方案

正式顯示請用 Lottie JSON；**JSON 無法播放時**(例如播放器不支援、載入失敗)才改播 \`previews-mp4/\` 裡的影片。

- 影片已經把背景和樹合成在一起，所以只要一個 \`<video>\`，不用另外疊背景。
- 每個階段一支影片，直接循環播放(\`loop\`)。
- 一般階段的影片剛好一輪，頭尾無縫。影片壓縮在接縫處造成的差異跟影片中段本來就有的關鍵影格差不多，播放時看不出來。
- **${MP4_WITHERED_NOTE}。** 04 枯萎一輪 30 秒；05 枯萎一輪 37 秒，跟背景的 30 秒循環長度不同，所以 05 枯萎每一輪開頭背景的雲也會跳一下。

\`\`\`js
video.src = 'previews-mp4/tree-01-healthy.mp4';
video.loop = true;
video.play();
\`\`\`

\`<video>\` 請加上 \`muted playsinline\`，手機瀏覽器才允許自動播放。

## 各階段動畫

${readmeSections.join("\n---\n\n")}

## 疊圖方式

所有動畫畫布都是 1000x1000、30fps、900 frames(05 枯萎為 1110 frames，見上方說明)，樹的動畫直接疊在背景動畫上方(兩個獨立的 Lottie 容器，CSS \`position:absolute; inset:0\` 疊在同一個畫布尺寸的容器裡)即可對齊，不需要額外座標偏移。範例見 \`preview/index.html\`。

## 之後更新或追加階段時

這份 README 跟 preview 頁是用 \`my-animation/scripts/build-bundle.mjs\` 產生的。某個階段的動畫更新後，重新執行 \`node scripts/build-bundle.mjs\` 即可；要追加新階段，只要在該腳本的 \`STAGES\` 陣列加一筆設定，就會自動產生新的交付包，不需要手動整理。
`;
fs.writeFileSync(path.join(STAGE_DIR, "README.md"), readme);
console.log("Wrote README.md");

// ---------- 4. zip ----------
rimraf(ZIP_PATH);
try {
  execFileSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    `Compress-Archive -Path '${STAGE_DIR}\\*' -DestinationPath '${ZIP_PATH}' -CompressionLevel Optimal`,
  ], { stdio: "inherit" });
  console.log("\nZipped:", ZIP_PATH, "(" + fmtBytes(fs.statSync(ZIP_PATH).size) + ")");

  // ---------- 5. copy the finished zip into preview/download/ so the
  // preview page's "download whole bundle" link resolves when the preview/
  // folder is served directly (e.g. serving it locally to browse) -- this
  // file is necessarily added AFTER zipping (can't contain itself), so it
  // won't appear in THIS run's zip, only in whatever preview folder is on
  // disk right now. Harmless, purely a browsing convenience. ----------
  const downloadDir = path.join(STAGE_DIR, "preview", "download");
  fs.mkdirSync(downloadDir, { recursive: true });
  fs.copyFileSync(ZIP_PATH, path.join(downloadDir, `${BUNDLE_NAME}.zip`));
  console.log("Copied zip into preview/download/ for direct browsing.");
} catch (err) {
  console.error("\nZip step failed (staging folder is still available unzipped at", STAGE_DIR + "):", err.message);
  process.exitCode = 1;
}
