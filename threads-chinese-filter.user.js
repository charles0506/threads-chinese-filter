// ==UserScript==
// @name         Threads 繁簡中文過濾器與圖片縮放
// @namespace    https://github.com/charles0506/threads-chinese-filter
// @version      1.5.0
// @description  自動隱藏 Threads 上不含中文字元的非中文推薦貼文；嚴格限定僅在「點開圖片（燈箱彈窗）」時啟用滾輪與 +/- 縮放拖曳，首頁動態牆完全不干涉正常滾動
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
        enableImageZoom: true       // 是否啟用圖片縮放功能 (僅限點開圖片的燈箱模式)
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
    const CJK_UNIFIED_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
    const JAPANESE_KANA_REGEX = /[\u3040-\u309f\u30a0-\u30ff]/g;
    const KOREAN_HANGUL_REGEX = /[\uac00-\ud7af\u1100-\u11ff]/;
    const OTHER_NON_LATIN_SCRIPTS = /[\u0400-\u04ff\u0600-\u06ff\u0e00-\u0e7f]/;
    const LATIN_WORDS_REGEX = /[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]{2,}/;

    const SYSTEM_UI_WORDS = /\b(翻譯|查看翻譯|顯示翻譯|已編輯|已编辑|贊助|推廣|See translation|Translate)\b/gi;
    const RELATIVE_TIME_REGEX = /\b\d+\s*([天時分秒週年月hdmsw]|小時|分鐘|秒鐘|周|週|個月|年)\b/gi;

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

    function cleanPostContent(rawText) {
        if (!rawText) return '';
        return rawText
            .replace(/https?:\/\/\S+/gi, '')
            .replace(/[@#][\w\d_.-]+/g, '')
            .replace(SYSTEM_UI_WORDS, '')
            .replace(RELATIVE_TIME_REGEX, '')
            .trim();
    }

    function isNonChinesePost(postEl, rawText) {
        if (config.filterTranslationPosts && hasTranslationTrigger(postEl)) {
            return true;
        }

        const cleanText = cleanPostContent(rawText);

        if (cleanText.length === 0) {
            return config.hidePureMedia;
        }

        if (config.filterKorean && KOREAN_HANGUL_REGEX.test(cleanText)) {
            return true;
        }

        if (config.filterJapanese) {
            const kanaMatches = cleanText.match(JAPANESE_KANA_REGEX);
            if (kanaMatches && kanaMatches.length >= 2) {
                return true;
            }
        }

        if (config.filterOtherAlphabets && OTHER_NON_LATIN_SCRIPTS.test(cleanText)) {
            return true;
        }

        const hasChinese = CJK_UNIFIED_REGEX.test(cleanText);
        if (!hasChinese) {
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
    // 5. 點開圖片專用縮放引擎 v1.5 (嚴格限定燈箱彈窗，首頁 0 干擾)
    // ==========================================
    let currentZoomImg = null;
    let currentScale = 1;
    let translateX = 0;
    let translateY = 0;
    let isDragging = false;
    let hasDragged = false;
    let dragStartX = 0;
    let dragStartY = 0;

    /**
     * 判斷某張圖片是否位於「已點開的大圖燈箱/彈窗」內
     * 嚴格排除首頁動態牆貼文內的普通圖片
     */
    function isImageInsideLightbox(img) {
        if (!img) return false;

        let parent = img.parentElement;
        let depth = 0;

        while (parent && parent !== document.body && depth < 10) {
            if (parent.id === 'threads-lang-filter-badge' || parent.id === 'threads-zoom-hud') {
                return false;
            }

            // 1. 標準對話框容器
            const role = parent.getAttribute('role');
            if (role === 'dialog' || parent.getAttribute('aria-modal') === 'true') {
                return true;
            }

            // 2. Threads 全螢幕燈箱覆蓋層 (position: fixed 且覆蓋螢幕大部分面積)
            const s = window.getComputedStyle(parent);
            if (s.position === 'fixed') {
                const rect = parent.getBoundingClientRect();
                // 燈箱容器必須幾乎填滿視窗寬高（排除右上角小選單等）
                if (rect.width >= window.innerWidth * 0.65 && rect.height >= window.innerHeight * 0.65) {
                    return true;
                }
            }

            parent = parent.parentElement;
            depth++;
        }

        return false;
    }

    /**
     * 尋找當前畫面中已被點開的燈箱彈窗大圖
     */
    function getActiveLightbox() {
        if (!config.enableImageZoom) return null;

        // 1. 搜尋 role="dialog"
        const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
        for (const dialog of dialogs) {
            if (dialog.offsetParent === null && window.getComputedStyle(dialog).display === 'none') continue;
            const imgs = Array.from(dialog.querySelectorAll('img')).filter(img => img.naturalWidth > 120);
            if (imgs.length > 0) {
                imgs.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight));
                return { container: dialog, img: imgs[0] };
            }
        }

        // 2. 搜尋全螢幕 fixed 遮罩
        const allFixed = document.querySelectorAll('div');
        for (const el of allFixed) {
            if (el.id === 'threads-lang-filter-badge' || el.id === 'threads-zoom-hud') continue;
            const s = window.getComputedStyle(el);
            if (s.position === 'fixed' && parseInt(s.zIndex, 10) >= 1) {
                const rect = el.getBoundingClientRect();
                if (rect.width >= window.innerWidth * 0.7 && rect.height >= window.innerHeight * 0.7) {
                    const imgs = Array.from(el.querySelectorAll('img')).filter(img => img.naturalWidth > 150 && img.offsetWidth > 150);
                    if (imgs.length > 0) {
                        imgs.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight));
                        return { container: el, img: imgs[0] };
                    }
                }
            }
        }

        return null;
    }

    function adjustParentOverflow(img, allow) {
        let parent = img.parentElement;
        let depth = 0;
        while (parent && parent !== document.body && depth < 6) {
            if (allow) {
                const s = window.getComputedStyle(parent);
                if (s.overflow === 'hidden' || s.overflowX === 'hidden' || s.overflowY === 'hidden') {
                    if (!parent.dataset.threadsOrigOverflow) {
                        parent.dataset.threadsOrigOverflow = parent.style.overflow || 'hidden';
                    }
                    parent.style.overflow = 'visible';
                }
            } else {
                if (parent.dataset.threadsOrigOverflow) {
                    parent.style.overflow = parent.dataset.threadsOrigOverflow;
                    delete parent.dataset.threadsOrigOverflow;
                }
            }
            parent = parent.parentElement;
            depth++;
        }
    }

    function applyImageTransform(animate = true) {
        if (!currentZoomImg) return;

        adjustParentOverflow(currentZoomImg, currentScale > 1);

        currentZoomImg.style.transform = `translate(${translateX}px, ${translateY}px) scale(${currentScale})`;
        currentZoomImg.style.transformOrigin = 'center center';
        currentZoomImg.style.transition = (isDragging || !animate) ? 'none' : 'transform 0.12s cubic-bezier(0.2, 0, 0, 1)';
        currentZoomImg.style.cursor = currentScale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default';
        currentZoomImg.style.zIndex = currentScale > 1 ? '99999' : '';
        currentZoomImg.style.position = currentScale > 1 ? 'relative' : '';

        renderZoomHud();
    }

    function zoomIn(step = 0.25) {
        currentScale = Math.min(6.0, Math.round((currentScale + step) * 100) / 100);
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
            adjustParentOverflow(img, false);
            img.style.transform = '';
            img.style.transformOrigin = '';
            img.style.transition = '';
            img.style.cursor = '';
            img.style.zIndex = '';
            img.style.position = '';
        }
        currentScale = 1;
        translateX = 0;
        translateY = 0;
        isDragging = false;
        hasDragged = false;
    }

    function zoomAtPoint(zoomDelta, clientX, clientY) {
        if (!currentZoomImg) return;

        const oldScale = currentScale;
        let newScale = Math.round((currentScale + zoomDelta) * 100) / 100;
        newScale = Math.min(6.0, Math.max(0.5, newScale));

        if (newScale === oldScale) return;

        const rect = currentZoomImg.getBoundingClientRect();
        const mouseX = clientX - (rect.left + rect.width / 2);
        const mouseY = clientY - (rect.top + rect.height / 2);

        if (newScale > 1) {
            const scaleRatio = 1 - newScale / oldScale;
            translateX += mouseX * scaleRatio;
            translateY += mouseY * scaleRatio;
        } else {
            translateX = 0;
            translateY = 0;
        }

        currentScale = newScale;
        applyImageTransform(true);
    }

    // ==========================================
    // 嚴格事件監聽：首頁 0 干涉，僅在點開圖片時生效
    // ==========================================

    // 1. 滑鼠滾輪縮放（首頁完全不攔截）
    window.addEventListener(
        'wheel',
        (e) => {
            if (!config.enableImageZoom) return;

            // 取得游標下的圖片
            const elements = document.elementsFromPoint(e.clientX, e.clientY);
            let targetImg = elements.find(el => el.tagName === 'IMG' && el.naturalWidth > 80);

            // 若游標在燈箱黑色背景上，尋找燈箱當前大圖
            if (!targetImg) {
                const lightbox = getActiveLightbox();
                if (lightbox) targetImg = lightbox.img;
            }

            // 【關鍵防線】：如果這張圖片不在「點開的燈箱」內，絕對不攔截，直接放行給瀏覽器正常捲動動態牆！
            if (!targetImg || !isImageInsideLightbox(targetImg)) {
                return;
            }

            // 確認已在燈箱內，才進行圖片縮放
            if (currentZoomImg !== targetImg) {
                if (currentZoomImg) resetZoomState(currentZoomImg);
                currentZoomImg = targetImg;
            }

            e.preventDefault();
            e.stopPropagation();

            const delta = e.deltaY < 0 ? 0.25 : -0.25;
            zoomAtPoint(delta, e.clientX, e.clientY);
        },
        { capture: true, passive: false }
    );

    // 2. 滑鼠左鍵拖曳平移 (僅在燈箱且已放大時)
    window.addEventListener(
        'mousedown',
        (e) => {
            if (currentScale <= 1 || e.button !== 0 || !currentZoomImg) return;
            if (!isImageInsideLightbox(currentZoomImg)) return;

            const elements = document.elementsFromPoint(e.clientX, e.clientY);
            const isTargetOrDescendant = elements.includes(currentZoomImg) || elements.some(el => el.contains(currentZoomImg));

            if (isTargetOrDescendant) {
                isDragging = true;
                hasDragged = false;
                dragStartX = e.clientX - translateX;
                dragStartY = e.clientY - translateY;
                currentZoomImg.style.cursor = 'grabbing';
                e.preventDefault();
                e.stopPropagation();
            }
        },
        true
    );

    window.addEventListener(
        'mousemove',
        (e) => {
            if (!isDragging || !currentZoomImg) return;
            hasDragged = true;
            translateX = e.clientX - dragStartX;
            translateY = e.clientY - dragStartY;
            applyImageTransform(false);
        },
        true
    );

    window.addEventListener(
        'mouseup',
        () => {
            if (isDragging) {
                isDragging = false;
                if (currentZoomImg) {
                    currentZoomImg.style.cursor = currentScale > 1 ? 'grab' : 'default';
                }
            }
        },
        true
    );

    window.addEventListener(
        'click',
        (e) => {
            if (hasDragged) {
                e.preventDefault();
                e.stopPropagation();
                hasDragged = false;
            }
        },
        true
    );

    // 3. 雙擊快速縮放 (僅限燈箱內)
    window.addEventListener(
        'dblclick',
        (e) => {
            if (!config.enableImageZoom) return;

            const elements = document.elementsFromPoint(e.clientX, e.clientY);
            const targetImg = elements.find(el => el.tagName === 'IMG' && el.naturalWidth > 80);

            if (!targetImg || !isImageInsideLightbox(targetImg)) return;

            e.preventDefault();
            e.stopPropagation();

            if (currentZoomImg !== targetImg) {
                if (currentZoomImg) resetZoomState(currentZoomImg);
                currentZoomImg = targetImg;
            }

            if (currentScale > 1) {
                resetZoom();
            } else {
                zoomAtPoint(1.25, e.clientX, e.clientY);
            }
        },
        true
    );

    // 4. 鍵盤快捷鍵 (+, -, 0, Escape) - 僅限燈箱模式
    window.addEventListener(
        'keydown',
        (e) => {
            if (!config.enableImageZoom) return;

            const tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) {
                return;
            }

            const isZoomKey = e.key === '+' || e.key === '=' || e.code === 'NumpadAdd' ||
                              e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract' ||
                              e.key === '0' || e.code === 'Numpad0' ||
                              (e.key === 'Escape' && currentScale > 1);

            if (!isZoomKey) return;

            // 必須在已點開的燈箱內才響應按鍵
            const lightbox = getActiveLightbox();
            if (!lightbox) return;

            const targetImg = currentZoomImg || lightbox.img;
            if (!targetImg || !isImageInsideLightbox(targetImg)) return;

            if (currentZoomImg !== targetImg) {
                if (currentZoomImg) resetZoomState(currentZoomImg);
                currentZoomImg = targetImg;
            }

            if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
                e.preventDefault();
                e.stopPropagation();
                zoomIn();
            } else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
                e.preventDefault();
                e.stopPropagation();
                zoomOut();
            } else if (e.key === '0' || e.code === 'Numpad0') {
                e.preventDefault();
                e.stopPropagation();
                resetZoom();
            } else if (e.key === 'Escape' && currentScale > 1) {
                e.preventDefault();
                e.stopPropagation();
                resetZoom();
            }
        },
        true
    );

    // ==========================================
    // 浮動控制條 (HUD - 僅在燈箱開啟時顯示)
    // ==========================================
    function renderZoomHud() {
        if (!getActiveLightbox() && currentScale === 1) {
            removeZoomHud();
            return;
        }

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
                padding: 6px 16px;
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
                <button id="tz-btn-out" title="縮小 (快捷鍵: - / 滾輪向下)" style="background:none;border:none;color:#fff;font-size:18px;line-height:1;cursor:pointer;padding:2px 8px;border-radius:6px;transition:background 0.15s;">−</button>
                <span id="tz-zoom-text" style="min-width:48px;text-align:center;font-variant-numeric:tabular-nums;color:#4ade80;">100%</span>
                <button id="tz-btn-in" title="放大 (快捷鍵: + / 滾輪向上)" style="background:none;border:none;color:#fff;font-size:18px;line-height:1;cursor:pointer;padding:2px 8px;border-radius:6px;transition:background 0.15s;">+</button>
                <span style="opacity:0.25;margin:0 2px;">|</span>
                <button id="tz-btn-reset" title="重設縮放 (快捷鍵: 0)" style="background:none;border:none;color:#bbb;font-size:13px;cursor:pointer;padding:2px 8px;border-radius:6px;transition:all 0.15s;">↺ 重設</button>
                <span style="opacity:0.25;margin:0 2px;">|</span>
                <span style="font-size:11px;font-weight:400;color:#94a3b8;">🖱️ 滾輪縮放 · 拖曳平移</span>
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

    function checkActiveImageLifecycle() {
        const lightbox = getActiveLightbox();
        if (!lightbox) {
            // 燈箱已關閉，立刻完全重設狀態並移除 HUD，確保首頁完全乾淨
            if (currentZoomImg) {
                resetZoomState(currentZoomImg);
                currentZoomImg = null;
            }
            removeZoomHud();
        } else if (lightbox.img && currentZoomImg !== lightbox.img && currentScale === 1) {
            currentZoomImg = lightbox.img;
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
            config.enableImageZoom ? '🔍 點開圖片縮放：[開啟]（點擊切換）' : '❌ 點開圖片縮放：[關閉]（點擊切換）',
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
                checkActiveImageLifecycle();
                scheduled = false;
            });
        }
    }

    function init() {
        createBadge();
        registerMenuCommands();
        processFeed();
        checkActiveImageLifecycle();

        const observer = new MutationObserver((mutations) => {
            let hasNodes = false;
            for (const m of mutations) {
                if (m.addedNodes.length > 0 || m.removedNodes.length > 0) {
                    hasNodes = true;
                    break;
                }
            }
            if (hasNodes) {
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
