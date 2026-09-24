// ==UserScript==
// @name         Threads 繁簡中文過濾器與圖片縮放
// @namespace    https://github.com/charles0506/threads-chinese-filter
// @version      1.2.0
// @description  自動隱藏 Threads 上不含中文字元的非中文推薦貼文；點開圖片支援鍵盤 +/-、滾輪與工具列按鈕放大縮小，支援拖曳平移
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
        filterTranslationPosts: true,// 命中 Threads 官方「翻譯」按鈕的外語貼文直接 100% 隱藏
        hidePureMedia: false,       // 是否隱藏完全無內文的純照片/影片貼文 (預設保留)
        showBadge: true,            // 是否顯示右下角浮動統計膠囊
        enableImageZoom: true       // 是否啟用點開圖片 +/- 放大縮小功能
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
            console.warn('[Threads Filter] 讀取設定失敗，使用預設值', e);
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
            console.warn('[Threads Filter] 儲存設定失敗', e);
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
    // 泰文、俄文西里爾字母、阿拉伯文
    const OTHER_NON_LATIN_SCRIPTS = /[\u0400-\u04ff\u0600-\u06ff\u0e00-\u0e7f]/;
    // 拉丁字母系統（英文、印尼文、馬來文、越南文、西班牙文等）
    const LATIN_WORDS_REGEX = /[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]{2,}/;

    // 介面系統詞彙與時間標記（避免誤將系統中文字元當作內文）
    const SYSTEM_UI_WORDS = /\b(翻譯|查看翻譯|顯示翻譯|已編輯|已编辑|贊助|推廣|See translation|Translate)\b/gi;
    const RELATIVE_TIME_REGEX = /\b\d+\s*([天時分秒週年月hdmsw]|小時|分鐘|秒鐘|周|週|個月|年)\b/gi;

    /**
     * 檢查貼文是否帶有 Threads 官方的「翻譯」按鈕
     */
    function hasTranslationTrigger(postEl) {
        const elements = postEl.querySelectorAll('div[role="button"], span[dir="auto"], a, span');
        for (const el of elements) {
            if (el.children.length === 0) {
                const text = el.innerText?.trim();
                if (text === '翻譯' || text === '查看翻譯' || text === '顯示翻譯' || text === 'See translation') {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * 清理貼文文字，剔除系統時間、按鈕文字、網址與 tag
     */
    function cleanPostContent(rawText) {
        if (!rawText) return '';
        return rawText
            .replace(/https?:\/\/\S+/gi, '')
            .replace(/[@#][\w\d_.-]+/g, '')
            .replace(SYSTEM_UI_WORDS, '')
            .replace(RELATIVE_TIME_REGEX, '')
            .trim();
    }

    /**
     * 判斷給定貼文是否屬於非中文語言（印尼文、英文、日文、韓文等）
     */
    function isNonChinesePost(postEl, rawText) {
        if (config.filterTranslationPosts && hasTranslationTrigger(postEl)) {
            return true;
        }

        const cleanText = cleanPostContent(rawText);

        if (cleanText.length === 0) {
            return config.hidePureMedia;
        }

        // 1. 韓文檢查
        if (config.filterKorean && KOREAN_HANGUL_REGEX.test(cleanText)) {
            return true;
        }

        // 2. 日文檢查：日文可能混有漢字，但假名累計出現 2 個以上即視為日文
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

        // 4. 中文檢查：檢查是否包含任何 CJK 漢字
        const hasChinese = CJK_UNIFIED_REGEX.test(cleanText);

        if (!hasChinese) {
            // 完全不含漢字，且具有實質拉丁字母（印尼文、英文、西文等）或長度 > 3
            if (LATIN_WORDS_REGEX.test(cleanText) || cleanText.length > 3) {
                return true;
            }
        }

        return false;
    }

    // ==========================================
    // 3. Threads 動態牆貼文解析與過濾
    // ==========================================
    function isUiElement(el) {
        if (el.closest('button')) return true;
        if (el.closest('time')) return true;

        const text = el.innerText?.trim();
        if (!text) return true;

        if (/^\d+\s*([天時分秒週年月hdmsw]|小時|分鐘|秒鐘|周|週|個月|年)$/i.test(text)) return true;
        if (/^(翻譯|查看翻譯|顯示翻譯|See translation|Translate)$/i.test(text)) return true;

        return false;
    }

    function extractPostText(postEl) {
        const textElements = postEl.querySelectorAll('span[dir="auto"], div[dir="auto"]');
        const textSegments = [];

        textElements.forEach((el) => {
            if (isUiElement(el)) return;
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

    function getTopLevelPostElements() {
        const results = [];
        const candidates = document.querySelectorAll('article, div[data-pressable-container="true"]');

        candidates.forEach((el) => {
            if (el.parentElement && el.parentElement.closest('div[data-pressable-container="true"]')) {
                return;
            }
            results.push(el);
        });

        return results;
    }

    function processFeed() {
        if (!config.enabled) {
            document.querySelectorAll('[data-threads-hidden="true"]').forEach((el) => {
                el.style.display = '';
                delete el.dataset.threadsHidden;
            });
            updateBadge();
            return;
        }

        const posts = getTopLevelPostElements();

        posts.forEach((post) => {
            if (post.dataset.threadsFiltered) return;

            const contentText = extractPostText(post);
            const shouldHide = isNonChinesePost(post, contentText);

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
    // 4. 浮動統計徽章 (動態牆過濾 UI)
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

        badgeEl.addEventListener('click', () => {
            config.enabled = !config.enabled;
            saveConfig(config);
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
    // 5. 圖片彈窗 +/- 放大縮小與拖曳平移 (Image Zoom Engine)
    // ==========================================
    let currentZoomImg = null;
    let currentScale = 1;
    let translateX = 0;
    let translateY = 0;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;

    /**
     * 尋找當前畫面中開啟的圖片彈窗 (Modal/Dialog)
     */
    function findModalImage() {
        if (!config.enableImageZoom) return null;

        // 1. 優先搜尋 role="dialog" 或 aria-modal="true"
        const dialogs = document.querySelectorAll('div[role="dialog"], div[aria-modal="true"]');
        for (const dialog of dialogs) {
            if (dialog.offsetParent === null && window.getComputedStyle(dialog).display === 'none') continue;
            const imgs = dialog.querySelectorAll('img');
            for (const img of imgs) {
                const rect = img.getBoundingClientRect();
                if (rect.width >= 120 && rect.height >= 120) {
                    return { container: dialog, img: img };
                }
            }
        }

        // 2. 備援：fixed 覆蓋層 (z-index 較高且包含大圖)
        const fixedLayers = document.querySelectorAll('div[style*="fixed"]');
        for (const el of fixedLayers) {
            if (el.id === 'threads-lang-filter-badge' || el.id === 'threads-zoom-hud') continue;
            const style = window.getComputedStyle(el);
            if (style.position === 'fixed' && parseInt(style.zIndex, 10) >= 10) {
                const imgs = el.querySelectorAll('img');
                for (const img of imgs) {
                    const rect = img.getBoundingClientRect();
                    if (rect.width >= 200 && rect.height >= 200) {
                        return { container: el, img: img };
                    }
                }
            }
        }

        return null;
    }

    function applyImageTransform() {
        if (!currentZoomImg) return;

        currentZoomImg.style.transform = `translate(${translateX}px, ${translateY}px) scale(${currentScale})`;
        currentZoomImg.style.transformOrigin = 'center center';
        currentZoomImg.style.transition = isDragging ? 'none' : 'transform 0.15s cubic-bezier(0.2, 0, 0, 1)';
        currentZoomImg.style.cursor = currentScale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default';

        renderZoomHud();
    }

    function zoomIn(step = 0.25) {
        currentScale = Math.min(5.0, Math.round((currentScale + step) * 100) / 100);
        applyImageTransform();
    }

    function zoomOut(step = 0.25) {
        currentScale = Math.max(0.5, Math.round((currentScale - step) * 100) / 100);
        if (currentScale <= 1) {
            translateX = 0;
            translateY = 0;
        }
        applyImageTransform();
    }

    function resetZoom() {
        currentScale = 1;
        translateX = 0;
        translateY = 0;
        applyImageTransform();
    }

    function resetZoomState(img) {
        if (img) {
            img.style.transform = '';
            img.style.transformOrigin = '';
            img.style.transition = '';
            img.style.cursor = '';
        }
        currentScale = 1;
        translateX = 0;
        translateY = 0;
        isDragging = false;
    }

    /**
     * 綁定圖片互動事件 (拖曳平移、雙擊切換、滾輪縮放)
     */
    function attachImageInteractions(img) {
        if (img.dataset.threadsZoomBound) return;
        img.dataset.threadsZoomBound = 'true';

        // 滑鼠拖曳平移 (當 scale > 1)
        img.addEventListener('mousedown', (e) => {
            if (currentScale <= 1 || e.button !== 0) return;
            isDragging = true;
            dragStartX = e.clientX - translateX;
            dragStartY = e.clientY - translateY;
            img.style.cursor = 'grabbing';
            e.preventDefault();
        });

        // 雙擊：在 100% 與 200% 之間快速切換
        img.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (currentScale > 1) {
                resetZoom();
            } else {
                currentScale = 2.0;
                translateX = 0;
                translateY = 0;
                applyImageTransform();
            }
        });

        // 滾輪縮放
        img.addEventListener(
            'wheel',
            (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.deltaY < 0) {
                    zoomIn(0.2);
                } else {
                    zoomOut(0.2);
                }
            },
            { passive: false }
        );
    }

    // 全域滑鼠拖曳監聽
    window.addEventListener('mousemove', (e) => {
        if (!isDragging || !currentZoomImg) return;
        translateX = e.clientX - dragStartX;
        translateY = e.clientY - dragStartY;
        applyImageTransform();
    });

    window.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            if (currentZoomImg) {
                currentZoomImg.style.cursor = currentScale > 1 ? 'grab' : 'default';
            }
        }
    });

    /**
     * 鍵盤快捷鍵監聽 (+, -, 0, Escape)
     */
    window.addEventListener(
        'keydown',
        (e) => {
            if (!config.enableImageZoom) return;

            // 忽略文字輸入框中的打字
            const tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) {
                return;
            }

            const modal = findModalImage();
            if (!modal) return;

            if (modal.img !== currentZoomImg) {
                if (currentZoomImg) resetZoomState(currentZoomImg);
                currentZoomImg = modal.img;
                attachImageInteractions(currentZoomImg);
            }

            // '+' 或 '=' 或數字鍵盤 '+'
            if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
                e.preventDefault();
                e.stopPropagation();
                zoomIn();
            }
            // '-' 或 '_' 或數字鍵盤 '-'
            else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
                e.preventDefault();
                e.stopPropagation();
                zoomOut();
            }
            // '0' 或數字鍵盤 '0'：重設縮放
            else if (e.key === '0' || e.code === 'Numpad0') {
                e.preventDefault();
                e.stopPropagation();
                resetZoom();
            }
            // Escape：如果已放大，先還原為 100%（不直接關閉彈窗）
            else if (e.key === 'Escape' && currentScale > 1) {
                e.preventDefault();
                e.stopPropagation();
                resetZoom();
            }
        },
        true // capture phase 優先攔截
    );

    /**
     * 渲染圖片縮放專用浮動控制條 (HUD)
     */
    function renderZoomHud() {
        let hud = document.getElementById('threads-zoom-hud');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'threads-zoom-hud';
            hud.setAttribute(
                'style',
                `
                position: fixed;
                bottom: 28px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 1000000;
                background: rgba(18, 18, 18, 0.88);
                color: #ffffff;
                backdrop-filter: blur(14px);
                -webkit-backdrop-filter: blur(14px);
                padding: 6px 14px;
                border-radius: 9999px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 13px;
                font-weight: 600;
                border: 1px solid rgba(255, 255, 255, 0.2);
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
                display: flex;
                align-items: center;
                gap: 10px;
                user-select: none;
                pointer-events: auto;
                transition: opacity 0.2s ease;
            `
            );

            hud.innerHTML = `
                <button id="tz-btn-out" title="縮小 (快捷鍵: -)" style="background:none;border:none;color:#fff;font-size:18px;line-height:1;cursor:pointer;padding:2px 8px;border-radius:6px;transition:background 0.15s;">−</button>
                <span id="tz-zoom-text" style="min-width:48px;text-align:center;font-variant-numeric:tabular-nums;color:#4ade80;">100%</span>
                <button id="tz-btn-in" title="放大 (快捷鍵: +)" style="background:none;border:none;color:#fff;font-size:18px;line-height:1;cursor:pointer;padding:2px 8px;border-radius:6px;transition:background 0.15s;">+</button>
                <span style="opacity:0.25;margin:0 2px;">|</span>
                <button id="tz-btn-reset" title="重設縮放 (快捷鍵: 0)" style="background:none;border:none;color:#bbb;font-size:13px;cursor:pointer;padding:2px 8px;border-radius:6px;transition:all 0.15s;">↺ 重設</button>
            `;

            document.body.appendChild(hud);

            hud.querySelector('#tz-btn-out').addEventListener('click', (e) => {
                e.stopPropagation();
                zoomOut();
            });
            hud.querySelector('#tz-btn-in').addEventListener('click', (e) => {
                e.stopPropagation();
                zoomIn();
            });
            hud.querySelector('#tz-btn-reset').addEventListener('click', (e) => {
                e.stopPropagation();
                resetZoom();
            });

            hud.querySelectorAll('button').forEach((btn) => {
                btn.addEventListener('mouseenter', () => (btn.style.background = 'rgba(255, 255, 255, 0.15)'));
                btn.addEventListener('mouseleave', () => (btn.style.background = 'none'));
            });
        }

        const textEl = document.getElementById('tz-zoom-text');
        if (textEl) {
            textEl.innerText = `${Math.round(currentScale * 100)}%`;
            textEl.style.color = currentScale > 1 ? '#38bdf8' : (currentScale < 1 ? '#f87171' : '#4ade80');
        }
    }

    function removeZoomHud() {
        const hud = document.getElementById('threads-zoom-hud');
        if (hud) hud.remove();
    }

    /**
     * 檢查當前彈窗狀態並同步 HUD
     */
    function updateModalImageWatcher() {
        const modal = findModalImage();
        if (modal) {
            if (currentZoomImg !== modal.img) {
                if (currentZoomImg) resetZoomState(currentZoomImg);
                currentZoomImg = modal.img;
                attachImageInteractions(currentZoomImg);
                renderZoomHud();
            }
        } else {
            if (currentZoomImg) {
                resetZoomState(currentZoomImg);
                currentZoomImg = null;
                removeZoomHud();
            }
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
            config.enableImageZoom ? '🔍 圖片 +/- 縮放：[開啟]（點擊切換）' : '❌ 圖片 +/- 縮放：[關閉]（點擊切換）',
            () => {
                config.enableImageZoom = !config.enableImageZoom;
                saveConfig(config);
                location.reload();
            }
        );

        GM_registerMenuCommand(
            config.filterTranslationPosts ? '✅ 帶翻譯按鈕外語：[一律隱藏]（點擊切換）' : '❌ 帶翻譯按鈕外語：[關閉]（點擊切換）',
            () => {
                config.filterTranslationPosts = !config.filterTranslationPosts;
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
                updateModalImageWatcher();
                scheduled = false;
            });
        }
    }

    function init() {
        createBadge();
        registerMenuCommands();
        processFeed();
        updateModalImageWatcher();

        const observer = new MutationObserver((mutations) => {
            let hasNewNodes = false;
            for (const m of mutations) {
                if (m.addedNodes.length > 0 || m.removedNodes.length > 0) {
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
