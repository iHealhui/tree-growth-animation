# Tree Growth Animation（樹木成長動畫素材）

這是樹木成長動畫素材的**製作專案**，用來產生動畫檔交付給工程端使用。

> **要拿動畫素材的話，不需要 clone 或執行這個專案。**
> 請直接到預覽頁下載做好的交付包。

## 下載動畫素材

**預覽頁：https://ihealhui.github.io/tree-growth-animation/**

- 可以切換各階段，看樹木動畫疊在背景上的實際效果
- 「下載完整交付包 (.zip)」：所有動畫檔加使用說明，**通常下載這個就夠了**
- 也可以只下載目前選擇階段的 Lottie JSON 或 MP4

預覽頁在每次更新專案後會自動重新產生，下載到的永遠是最新版本。

## 交付包裡有什麼

| 內容 | 說明 |
|---|---|
| `background/` | 共用背景動畫（雲朵飄動） |
| `tree-01-seed/` ~ `tree-05-mature/` | 01 種子、02 嫩芽、03 大樹苗、04 小樹、05 成熟樹。01 只有健康狀態，02~05 各有健康 `healthy.json` 與枯萎 `withered.json` |
| `previews-mp4/` | 每個階段一支 MP4 備用影片（已含背景） |
| `preview/` | 離線版預覽頁，雙擊 `index.html` 即可開啟 |
| `README.md` | **完整使用說明**：各檔案規格與播放方式 |

## 使用方式（重點）

詳細說明請看交付包裡的 `README.md`，以下是最重要的幾點：

1. **動畫格式是 Lottie JSON**，用 `lottie-web`（網頁）、`lottie-react-native` 等支援 Lottie 的播放器播放。
2. **背景和樹是分開的兩層**：所有畫布都是 1000×1000、30fps。把樹的動畫疊在背景動畫正上方（兩個容器都用 `position:absolute; inset:0`）就會自動對齊，不需要調整座標。
3. **大部分動畫直接循環播放即可**（`loop: true`），頭尾已經接好，不會跳動。
4. **⚠ 04、05 枯萎狀態不能直接循環整段。** 這兩支有「葉子掉落後就不會回來」的設計，必須先完整播放一次，再改成只循環後段。直接循環的話，葉子每一輪都會長回來。正確寫法見交付包 `README.md`。
5. **MP4 只是備用方案**：正式請用 Lottie JSON，只有在 JSON 無法播放時才改播 MP4。請注意 04、05 枯萎的 MP4 每一輪葉子都會長回來，這點和 Lottie 版不同。

各階段什麼時候切換、怎麼切換，由產品端自行決定，這份素材不包含切換邏輯。

## 這個專案裡有什麼（製作端用）

以下是製作動畫用的原始檔，**使用素材的人不需要理會**。

| 位置 | 內容 |
|---|---|
| `tree-stages/` | 各階段樹木的原始向量圖 (SVG) |
| `Tree Growth_Background.svg` | 背景原始向量圖 |
| `my-animation/scripts/` | 把向量圖轉成動畫的程式，`build-bundle.mjs` 負責產生交付包和預覽頁 |
| `my-animation/previews-mp4/` | MP4 備用影片 |
| `my-animation/public/` | 製作過程中的測試頁與測試檔 |
| `.github/workflows/` | 自動產生交付包並發布預覽頁的設定 |

`my-animation/` 是以開源工具 Text-to-Lottie 為基礎建立的，裡面的 `my-animation/README.md` 是**該工具原本的說明**，跟這份動畫素材無關。

### 重新產生交付包

```bash
cd my-animation
npm install
npm run bundle
```

產出位置：`my-animation/exports/bundle/tree-growth-bundle-<日期>/`，以及同名的 `.zip`。
這個資料夾不會上傳到 GitHub；push 到 `master` 後，GitHub 會自動重新產生並更新預覽頁。
