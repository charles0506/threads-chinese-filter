// ==UserScript==
// @name         Threads 繁簡中文過濾器
// @namespace    https://github.com/charles0506/threads-chinese-filter
// @version      1.0.0
// @description  自動隱藏 Threads 上不含中文字元的非中文推薦貼文，保留含中文與純影音貼文，具備即時過濾統計與一鍵切換開關
// @author       charles0506
// @match        https://*.threads.net/*
// @match        https://*.threads.com/*
// @match        https://threads.net/*
// @match        https://threads.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/charles0506/threads-chinese-filter/main/threads-chinese-filter.user.js
// @updateURL    https://raw.githubusercontent.com/charles0506/threads-chinese-filter/main/threads-chinese-filter.user.js
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // ==========================================
    // 1. 設定與儲存管理 (相容 GM API 與 localStorage)
    // ==========================================
    const STORAGE_KEY = 'threads_chinese_filter_config';

    const DEFAULT_CONFIG = {
        enabled: true,              // 是否啟用過濾
        filterJapanese: true,       // 是否過濾日文貼文（含假名者）
        filterKorean: true,         // 是否過濾韓文貼文
        filterOtherAlphabets: true, // 是否過濾泰文、俄文、阿拉伯文等非拉丁字母語言
        hidePureMedia: false,       // 是否隱藏完全無內文的純照片/影片貼文 (預設保留)
        showBadge: true             // 是否顯示右下角浮動統計膠囊
    };

    function loadConfig() {
        try {
            if (typeof GM_getValue === 'function') {
                const stored = GM_getValue(STORAGE_KEY, null);
                if (stored) return Object.assign({}, DEFAULT_CONFIG, typeof stored === 'string' ? JSON.parse(stored) : stored);
            }
            const local = localStorage.getItem(STORAGE_KEY);
            if (local) return Object.assign({}, DEFAULT_CONFIG, JSON.parse(local));
        } catch (e) {
            console.warn('[Threads Chinese Filter] 讀取設定失敗，使用預設值', e);
        }
        return Object.assign({}, DEFAULT_CONFIG);
    }

    function saveConfig(cfg) {
        try {
            if (typeof GM_setValue === 'function') {
                GM_setValue(STORAGE_KEY, cfg);
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
        } catch (e) {
            console.warn('[Threads Chinese Filter] 儲存設定失敗', e);
        }
    }

    let config = loadConfig();
    let hiddenCount = 0;
    let badgeEl = null;

    // ==========================================
    // 2. 語言偵測與正則判斷
    // ==========================================
    // CJK 統一漢字（繁體/簡體中文）
    const CJK_UNIFIED_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
    // 日文平假名與片假名
    const JAPANESE_KANA_REGEX = /[\u3040-\u309f\u30a0-\u30ff]/g;
    // 韓文字母
    const KOREAN_HANGUL_REGEX = /[\uac00-\ud7af\u1100-\u11ff]/;
    // 其他非拉丁語言（泰文、俄文西里爾字母、阿拉伯文）
    const OTHER_NON_LATIN_SCRIPTS = /[\u0400-\u04ff\u0600-\u06ff\u0e00-\u0e7f]/;

    /**
     * 判斷給定貼文文字是否屬於非中文語言
     * @param {string} text 貼文內文
     * @returns {boolean} true 表示為非中文，應予隱藏
     */
    function isNonChinesePost(text) {
        if (!text || text.trim().length === 0) {
            return config.hidePureMedia;
        }

        // 清除網址、@帳號、#標籤與數字標點符號後再判定
        const cleanText = text
            .replace(/https?:\/\/\S+/gi, '')
            .replace(/[@#][\w\d_.-]+/g, '')
            .trim();

        if (cleanText.length === 0) {
            return config.hidePureMedia;
        }

        // 1. 韓文檢查
        if (config.filterKorean && KOREAN_HANGUL_REGEX.test(cleanText)) {
            return true;
        }

        // 2. 日文檢查：日文可能混有漢字，但假名出現 2 個以上即視為日文
        if (config.filterJapanese) {
            const kanaMatches = cleanText.match(JAPANESE_KANA_REGEX);
            if (kanaMatches && kanaMatches.length >= 2) {
                return true;
            }
        }

        // 3. 泰文、俄文、阿拉伯文等非拉丁字母語言
        if (config.filterOtherAlphabets && OTHER_NON_LATIN_SCRIPTS.test(cleanText)) {
            return true;
        }

        // 4. 中文判定：如果不含任何漢字，且包含實質英文字母或長度 > 5
        const hasChinese = CJK_UNIFIED_REGEX.test(cleanText);
        if (!hasChinese) {
            const hasLatinWords = /[a-zA-Z\u00C0-\u024F]{3,}/.test(cleanText);
            if (hasLatinWords || cleanText.length > 5) {
                return true;
            }
        }

        return false;
    }

    // ==========================================
    // 3. Threads DOM 節點解析與抽取
    // ==========================================
    /**
     * 從貼文元素中提取主要內文（避開作者暱稱欄、時間戳記與按鈕計數）
     */
    function extractPostText(postEl) {
        const textElements = postEl.querySelectorAll('span[dir="auto"], div[dir="auto"]');
        const textSegments = [];

        textElements.forEach((el) => {
            // 忽略按鈕內的文字（如讚數、回覆數）
            if (el.closest('button')) return;
            // 忽略作者欄位或頭像連結
            if (el.closest('header') || el.closest('a[role="link"][href^="/@"]')) return;

            const t = el.innerText?.trim();
            if (t && t.length > 0) {
                textSegments.push(t);
            }
        });

        if (textSegments.length > 0) {
            return textSegments.join('\n');
        }

        return postEl.innerText || '';
    }

    /**
     * 尋找 Threads 動態牆中的貼文頂層容器
     */
    function getTopLevelPostElements() {
        const results = [];
        // Threads 主要以 article 或最外層 data-pressable-container 作為貼文卡片
        const candidates = document.querySelectorAll('article, div[data-pressable-container="true"]');

        candidates.forEach((el) => {
            // 確保是最外層的卡片，而不是按鈕等內層可點擊元件
            if (el.parentElement && el.parentElement.closest('div[data-pressable-container="true"]')) {
                return;
            }
            results.push(el);
        });

        return results;
    }

    // ==========================================
    // 4. 過濾邏輯執行
    // ==========================================
    function processFeed() {
        if (!config.enabled) {
            // 若關閉過濾，將先前隱藏的貼文全部還原
            document.querySelectorAll('[data-threads-hidden="true"]').forEach((el) => {
                el.style.display = '';
                delete el.dataset.threadsHidden;
            });
            updateBadge();
            return;
        }

        const posts = getTopLevelPostElements();

        posts.forEach((post) => {
            // 已經檢查過的貼文略過
            if (post.dataset.threadsFiltered) return;

            const contentText = extractPostText(post);
            const shouldHide = isNonChinesePost(contentText);

            if (shouldHide) {
                post.style.display = 'none';
                post.dataset.threadsHidden = 'true';
                hiddenCount++;
            }

            post.dataset.threadsFiltered = shouldHide ? 'hidden' : 'kept';
        });

        updateBadge();
    }

    // ==========================================
    // 5. 浮動統計徽章 (UI)
    // ==========================================
    function createBadge() {
        if (!config.showBadge || badgeEl) return;

        badgeEl = document.createElement('div');
        badgeEl.id = 'threads-lang-filter-badge';
        badgeEl.setAttribute(
            'style',
            `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 999999;
            background: rgba(18, 18, 18, 0.88);
            color: #ffffff;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            padding: 6px 14px;
            border-radius: 9999px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 13px;
            font-weight: 500;
            border: 1px solid rgba(255, 255, 255, 0.15);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
            cursor: pointer;
            user-select: none;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        `
        );

        badgeEl.addEventListener('mouseenter', () => {
            badgeEl.style.transform = 'translateY(-2px) scale(1.03)';
            badgeEl.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.45)';
        });

        badgeEl.addEventListener('mouseleave', () => {
            badgeEl.style.transform = 'translateY(0) scale(1)';
            badgeEl.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.35)';
        });

        // 點擊直接切換開關
        badgeEl.addEventListener('click', () => {
            config.enabled = !config.enabled;
            saveConfig(config);
            // 清除標記並重新套用
            document.querySelectorAll('[data-threads-filtered]').forEach((el) => {
                delete el.dataset.threadsFiltered;
            });
            hiddenCount = 0;
            processFeed();
        });

        document.body.appendChild(badgeEl);
        updateBadge();
    }

    function updateBadge() {
        if (!badgeEl) return;

        if (!config.enabled) {
            badgeEl.innerHTML = '⏸️ <span style="opacity: 0.85;">中文過濾已暫停</span>';
            badgeEl.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            badgeEl.style.background = 'rgba(40, 40, 40, 0.85)';
            badgeEl.title = '點擊恢復過濾';
        } else {
            badgeEl.innerHTML = `🉐 <span style="color: #4ade80;">過濾中</span> · 已隱藏 <b>${hiddenCount}</b> 則`;
            badgeEl.style.borderColor = 'rgba(74, 222, 128, 0.3)';
            badgeEl.style.background = 'rgba(18, 18, 18, 0.88)';
            badgeEl.title = '點擊暫停過濾';
        }
    }

    // ==========================================
    // 6. 油猴選單指令註冊 (Tampermonkey Menu)
    // ==========================================
    function registerMenuCommands() {
        if (typeof GM_registerMenuCommand !== 'function') return;

        GM_registerMenuCommand(
            config.enabled ? '🟢 過濾開關：[啟用中]（點擊切換）' : '⚪ 過濾開關：[已暫停]（點擊切換）',
            () => {
                config.enabled = !config.enabled;
                saveConfig(config);
                location.reload();
            }
        );

        GM_registerMenuCommand(
            config.filterJapanese ? '✅ 日文過濾：[開啟]（點擊切換）' : '❌ 日文過濾：[關閉]（點擊切換）',
            () => {
                config.filterJapanese = !config.filterJapanese;
                saveConfig(config);
                location.reload();
            }
        );

        GM_registerMenuCommand(
            config.filterKorean ? '✅ 韓文過濾：[開啟]（點擊切換）' : '❌ 韓文過濾：[關閉]（點擊切換）',
            () => {
                config.filterKorean = !config.filterKorean;
                saveConfig(config);
                location.reload();
            }
        );

        GM_registerMenuCommand(
            config.hidePureMedia ? '✅ 無文字純影音：[隱藏]（點擊切換）' : '❌ 無文字純影音：[保留]（點擊切換）',
            () => {
                config.hidePureMedia = !config.hidePureMedia;
                saveConfig(config);
                location.reload();
            }
        );
    }

    // ==========================================
    // 7. 監聽滾動與 DOM 變動 (MutationObserver + rAF 節流)
    // ==========================================
    let scheduled = false;
    function scheduleProcess() {
        if (!scheduled) {
            scheduled = true;
            requestAnimationFrame(() => {
                processFeed();
                scheduled = false;
            });
        }
    }

    function init() {
        createBadge();
        registerMenuCommands();
        processFeed();

        const observer = new MutationObserver((mutations) => {
            let hasNewNodes = false;
            for (const m of mutations) {
                if (m.addedNodes.length > 0) {
                    hasNewNodes = true;
                    break;
                }
            }
            if (hasNewNodes) {
                scheduleProcess();
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
