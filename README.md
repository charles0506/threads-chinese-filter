# Threads 繁簡中文過濾器 (threads-chinese-filter)

Tampermonkey / Violentmonkey 使用者腳本。在 [Threads](https://www.threads.net/) 電腦網頁版上自動隱藏非中文語言（英文、日文、韓文、俄文、阿拉伯文、泰文等）的推薦貼文，讓動態牆只保留中文與純影音內容。

![版本](https://img.shields.io/badge/version-1.0.0-blue)
![授權](https://img.shields.io/badge/license-MIT-green)

---

## 快速安裝

1. 先在瀏覽器安裝 [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)
2. 點擊此處直接安裝：
   👉 **[threads-chinese-filter.user.js](https://raw.githubusercontent.com/charles0506/threads-chinese-filter/main/threads-chinese-filter.user.js)**

腳本已設定 `@updateURL` 與 `@downloadURL`，未來推上 GitHub 更新版本時會自動提醒與同步更新。

---

## 為什麼需要？

Threads 演算法常在「為你推薦」中插入各國語言的貼文（常見英文迷因、日文推文、韓文娛樂等）。官方目前沒有提供「僅顯示繁/簡中文」的設定開關，本腳本透過前端 DOM 解析與文字特徵判定，在貼文載入時即時判斷並隱藏非中文內容。

---

## 主要功能

- **精準語言特徵過濾**：
  - **日文過濾**：日文貼文即使夾帶漢字，只要平假名/片假名累計達閥值（$\ge 2$ 個）即自動判定為日文並隱藏。
  - **韓文過濾**：含韓文字母（諺文）直接隱藏。
  - **英文與歐美語言**：完全不含任何 CJK 漢字且具實質拉丁字母字詞者自動隱藏。
  - **其他字母系統**：包含俄文西里爾字母、阿拉伯文、泰文等外文貼文一併過濾。
  - **純圖片/影片貼文**：預設保留（可透過設定選擇是否連純照片貼文也一併隱藏）。
- **右下角精緻浮動統計膠囊**：
  - 即時顯示目前已過濾的貼文數量（例：`🉐 過濾中 · 已隱藏 15 則`）。
  - **點擊膠囊**可一鍵快速切換「暫停過濾」或「恢復過濾」，不需重整頁面。
- **Tampermonkey 選單快速設定**：
  - 支援從擴充套件選單切換開關、日文過濾、韓文過濾、無文字純影音過濾等設定，偏好自動記憶。
- **極低資源消耗**：
  - 採用 `MutationObserver` 搭配 `requestAnimationFrame`（rAF）節流渲染，不卡頓滾動頁面。

---

## 運作原理

1. **抓取貼文卡片**：鎖定 Threads feed 的頂層卡片容器（`article` 與最外層 `div[data-pressable-container="true"]`）。
2. **提取內文純文字**：自動排除作者暱稱、個人檔案連結、時間戳記與底部讚數/轉發數等干擾資訊，精準抽取貼文主要內文。
3. **特徵判定與隱藏**：命中非中文條件者設定 `display: none`，標記已處理狀態，避免重複計算。純前端隱藏，不修改任何網站原始 API。

---

## License

[MIT](LICENSE)
