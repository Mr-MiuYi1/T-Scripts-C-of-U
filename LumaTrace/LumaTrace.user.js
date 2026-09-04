// ==UserScript==
// @name         LumaTrace - 通用网页抓取与快速测试工作台
// @namespace    miuyi.lumatrace.web.capture
// @version      3.3.0
// @description  全网站抓取诊断与精细扫描：独立悬浮球事件层、选区扫描、后台降载、排除规则、探针健康检查、历史会话与操作链复盘。
// @match        http://*/*
// @match        https://*/*
//
// @updateURL    https://raw.githubusercontent.com/Mr-MiuYi1/T-Scripts-C-of-U/main/LumaTrace/LumaTrace.meta.js
// @downloadURL  https://raw.githubusercontent.com/Mr-MiuYi1/T-Scripts-C-of-U/main/LumaTrace/LumaTrace.user.js
//
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '3.3.0';
    const INSTANCE_KEY = '__MIUYI_WEB_CAPTURE_V3__';
    if (window[INSTANCE_KEY]) return;
    Object.defineProperty(window, INSTANCE_KEY, { configurable: true, value: true });

    const TOP = window === window.top;
    const ORIGIN = (() => { try { return location.origin; } catch { return 'unknown'; } })();
    const SITE_KEY = `miuyi-wct-v3:${ORIGIN}`;
    const SESSION = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const FRAME = TOP ? 'top' : `frame-${Math.random().toString(36).slice(2, 8)}`;
    const UI_HOST_ID = 'miuyi-wct-v3-host';
    const MESSAGE_MARK = 'MIUYI_WCT_V3_RECORD';
    const MESSAGE_CONTROL = 'MIUYI_WCT_V3_CONTROL';

    const DEFAULTS = {
        mode: 'safe',
        autoStart: true,
        collapsed: true,
        autoCollapseSeconds: 10,
        opacity: 0.96,
        ballSize: 46,
        position: { right: 16, top: 120 },
        continuousScan: {
            enabled: true,
            mode: 'smart',
            baselineDelay: 1500,
            routeRescan: true,
            ephemeralPriority: true,
            dedupe: true,
            captureRemoved: true,
            cssChanges: false,
            pauseWhenHidden: true,
            excludeSelectors: '[data-lumatrace-ignore]',
            idleBudgetMs: 6,
            patrolInterval: 30
        },
        persistence: {
            enabled: true,
            maxSessions: 12,
            retentionDays: 14,
            maxRecordsPerSession: 6000,
            actionWindowMs: 4500
        },
        modules: {
            errors: true,
            events: true,
            dom: true,
            network: false,
            performance: true,
            route: true,
            components: false,
            css: false,
            shadowClosed: false
        },
        limits: {
            errors: 150,
            events: 500,
            dom: 300,
            network: 300,
            performance: 150,
            components: 3000,
            css: 1500,
            text: 1600,
            html: 6000,
            body: 18000,
            response: 24000,
            renderRows: 180,
            mutationsPerSecond: 1500,
            queue: 3000
        },
        privacy: {
            captureRequestBody: true,
            captureResponseBody: true,
            maskUrlValues: false
        }
    };

    const MODE_PRESETS = {
        safe: { errors: true, events: true, dom: true, network: false, performance: true, route: true, components: false, css: false, shadowClosed: false },
        standard: { errors: true, events: true, dom: true, network: true, performance: true, route: true, components: false, css: false, shadowClosed: false },
        complete: { errors: true, events: true, dom: true, network: true, performance: true, route: true, components: true, css: true, shadowClosed: true }
    };

    const SENSITIVE_RE = /(authorization|cookie|set-cookie|token|password|passwd|pwd|secret|session|jwt|csrf|xsrf|api[_-]?key|idcard|identity|phone|mobile)/i;
    const RECORD_TYPES = ['events', 'dom', 'network', 'errors', 'performance', 'components', 'css', 'routes'];

    function cloneDefaults() { return JSON.parse(JSON.stringify(DEFAULTS)); }
    function mergeConfig(base, extra) {
        if (!extra || typeof extra !== 'object') return base;
        for (const [k, v] of Object.entries(extra)) {
            if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') mergeConfig(base[k], v);
            else base[k] = v;
        }
        return base;
    }
    function loadConfig() {
        const cfg = cloneDefaults();
        try { return mergeConfig(cfg, JSON.parse(localStorage.getItem(SITE_KEY) || '{}')); }
        catch { return cfg; }
    }
    let config = loadConfig();
    function saveConfig() {
        try { localStorage.setItem(SITE_KEY, JSON.stringify(config)); } catch {}
    }

    const state = {
        phase: config.autoStart ? 'starting' : 'paused',
        capturePaused: !config.autoStart,
        displayPaused: false,
        hardStopped: false,
        overloaded: false,
        overloadReason: '',
        overloadToken: 0,
        currentRoute: location.href,
        routeStage: 1,
        selected: null,
        selectedOutline: null,
        pickerActive: false,
        panel: 'none',
        records: Object.fromEntries(RECORD_TYPES.map(x => [x, []])),
        counters: Object.fromEntries(RECORD_TYPES.map(x => [x, 0])),
        unreadErrors: 0,
        mutationsThisSecond: 0,
        lastMutationSecond: Math.floor(Date.now() / 1000),
        domQueue: [],
        domQueueScheduled: false,
        observers: [],
        listeners: [],
        persistentListeners: [],
        originals: {},
        installed: new Set(),
        observedRoots: new WeakSet(),
        closedRoots: new Set(),
        ui: null,
        uiTimer: 0,
        listTimer: 0,
        autoCollapseTimer: 0,
        drag: null,
        componentScan: { running: false, cancel: false, scanned: 0 },
        continuous: {
            active: false,
            suspended: false,
            phase: config.continuousScan.enabled ? '等待建立基线' : '未开启',
            baselineDone: false,
            generation: 0,
            queue: [],
            queuedItems: new WeakMap(),
            processing: false,
            backgroundDirty: false,
            epoch: 0,
            index: new Map(),
            seenElements: new WeakSet(),
            elementKeys: new WeakMap(),
            timers: new Set(),
            counters: { scanned: 0, newComponents: 0, duplicateHits: 0, ephemeral: 0, removed: 0, cssChanges: 0 }
        },
        action: { seq: 0, id: '', rootRecordId: '', target: '', label: '', startedAt: 0, expiresAt: 0 },
        persistence: {
            db: null, ready: false, failed: false, opening: null, queue: new Map(), flushTimer: 0,
            sessionMeta: null, viewingSessionId: '', viewRecords: null, sessionsCache: []
        },
        diagnostics: {
            ballIsolation: 'pending', lastRecordAt: '', lastErrorAt: '',
            trimmed: Object.fromEntries(RECORD_TYPES.map(type => [type, 0])),
            dropped: { domQueue: 0, continuousQueue: 0, persistenceLimit: 0, backgroundChanges: 0, excludedRoots: 0 }
        },
        scanExclusionCache: { source: '', selectors: [] },
        cssTestNode: null
    };

    // =========================
    // 本地会话保存（每个网站源独立存储）
    // =========================

    const DB_NAME = 'LumaTraceCaptureDB';
    const DB_VERSION = 1;
    function idbRequest(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('IndexedDB请求失败'));
        });
    }
    function transactionDone(tx) {
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('IndexedDB事务失败'));
            tx.onabort = () => reject(tx.error || new Error('IndexedDB事务已中止'));
        });
    }
    async function initPersistence() {
        const persistence = state.persistence;
        if (!TOP || !config.persistence.enabled || !window.indexedDB || persistence.ready || persistence.failed) return;
        if (persistence.opening) { await persistence.opening; return; }
        let releaseOpening;
        persistence.opening = new Promise(resolve => { releaseOpening = resolve; });
        try {
            const open = indexedDB.open(DB_NAME, DB_VERSION);
            open.onupgradeneeded = () => {
                const db = open.result;
                if (!db.objectStoreNames.contains('sessions')) {
                    const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
                    sessions.createIndex('startedAt', 'startedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('records')) {
                    const records = db.createObjectStore('records', { keyPath: 'id' });
                    records.createIndex('sessionId', 'sessionId', { unique: false });
                    records.createIndex('type', 'type', { unique: false });
                    records.createIndex('time', 'time', { unique: false });
                }
            };
            const db = await idbRequest(open);
            state.persistence.db = db; state.persistence.ready = true;
            state.persistence.sessionMeta = {
                id: SESSION, startedAt: iso(), updatedAt: iso(), endedAt: '', status: 'active',
                title: document.title, url: safeUrl(location.href), host: location.hostname,
                toolVersion: VERSION, recordCount: 0, truncated: false
            };
            const maxRecords = Math.max(500, Number(config.persistence.maxRecordsPerSession) || 6000);
            if (state.persistence.queue.size > maxRecords) {
                state.diagnostics.dropped.persistenceLimit += state.persistence.queue.size - maxRecords;
                state.persistence.queue = new Map([...state.persistence.queue].slice(0, maxRecords));
                state.persistence.sessionMeta.truncated = true;
            }
            state.persistence.sessionMeta.recordCount = state.persistence.queue.size;
            await persistSessionMeta();
            await cleanupPersistedSessions();
            state.persistence.sessionsCache = await listPersistedSessions();
            bindPersistent(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') flushPersistQueue(); }, true);
            bindPersistent(window, 'pagehide', () => { updatePersistedSessionStatus('closed'); flushPersistQueue(); }, true);
            if (state.persistence.queue.size) flushPersistQueue();
            scheduleUI(true);
        } catch (e) {
            state.persistence.failed = true;
            pushRecord('errors', { source: 'persistence', message: `会话保存不可用：${clip(e?.message || e, 1000)}` });
        } finally {
            releaseOpening?.();
            state.persistence.opening = null;
        }
    }
    async function persistSessionMeta() {
        const p = state.persistence;
        if (!p.ready || !p.db || !p.sessionMeta) return;
        try {
            p.sessionMeta.updatedAt = iso();
            const tx = p.db.transaction('sessions', 'readwrite');
            tx.objectStore('sessions').put({ ...p.sessionMeta });
            await transactionDone(tx);
        } catch {}
    }
    function queuePersistRecord(record, isNew = false) {
        const p = state.persistence;
        if (!TOP || !config.persistence.enabled || p.failed || !record) return;
        if (isNew && p.sessionMeta) {
            if (p.sessionMeta.recordCount >= Number(config.persistence.maxRecordsPerSession || 6000)) {
                p.sessionMeta.truncated = true; state.diagnostics.dropped.persistenceLimit++; return;
            }
            p.sessionMeta.recordCount++;
        }
        p.queue.set(record.id, record);
        if (!p.flushTimer) p.flushTimer = setTimeout(flushPersistQueue, 600);
    }
    async function flushPersistQueue() {
        const p = state.persistence;
        clearTimeout(p.flushTimer); p.flushTimer = 0;
        if (!p.ready || !p.db || !p.queue.size) return;
        const batch = [...p.queue.values()]; p.queue.clear();
        try {
            const tx = p.db.transaction(['records', 'sessions'], 'readwrite');
            const store = tx.objectStore('records');
            for (const record of batch) store.put({ ...record, sessionId: SESSION });
            if (p.sessionMeta) {
                p.sessionMeta.updatedAt = iso(); p.sessionMeta.title = document.title; p.sessionMeta.url = safeUrl(location.href);
                tx.objectStore('sessions').put({ ...p.sessionMeta });
            }
            await transactionDone(tx);
        } catch (e) {
            for (const record of batch) p.queue.set(record.id, record);
            state.persistence.failed = true;
        }
    }
    async function updatePersistedSessionStatus(status) {
        const meta = state.persistence.sessionMeta;
        if (!meta) return;
        meta.status = status; meta.endedAt = status === 'active' ? '' : iso();
        await persistSessionMeta();
    }
    async function listPersistedSessions() {
        const p = state.persistence;
        if (!p.ready || !p.db) return [];
        try {
            const tx = p.db.transaction('sessions', 'readonly');
            const list = await idbRequest(tx.objectStore('sessions').getAll());
            return list.sort((a, b) => str(b.startedAt).localeCompare(str(a.startedAt)));
        } catch { return []; }
    }
    async function readPersistedSession(sessionId) {
        const p = state.persistence;
        if (!p.ready || !p.db || !sessionId) return [];
        try {
            const tx = p.db.transaction('records', 'readonly');
            const list = await idbRequest(tx.objectStore('records').index('sessionId').getAll(IDBKeyRange.only(sessionId)));
            return list.sort((a, b) => str(b.time).localeCompare(str(a.time)));
        } catch { return []; }
    }
    async function deletePersistedSession(sessionId, keepMeta = false) {
        const p = state.persistence;
        if (!p.ready || !p.db || !sessionId) return;
        const tx = p.db.transaction(['records', 'sessions'], 'readwrite');
        const index = tx.objectStore('records').index('sessionId');
        const cursorRequest = index.openCursor(IDBKeyRange.only(sessionId));
        cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (cursor) { cursor.delete(); cursor.continue(); }
        };
        if (!keepMeta) tx.objectStore('sessions').delete(sessionId);
        else if (sessionId === SESSION && p.sessionMeta) {
            p.sessionMeta.recordCount = 0; p.sessionMeta.truncated = false; tx.objectStore('sessions').put({ ...p.sessionMeta, updatedAt: iso() });
        }
        try { await transactionDone(tx); } catch {}
    }
    async function cleanupPersistedSessions() {
        const list = await listPersistedSessions();
        const max = Math.max(1, Number(config.persistence.maxSessions) || 12);
        const cutoff = Date.now() - Math.max(1, Number(config.persistence.retentionDays) || 14) * 86400000;
        const remove = list.filter((x, i) => x.id !== SESSION && (i >= max || Date.parse(x.startedAt || 0) < cutoff));
        for (const session of remove) await deletePersistedSession(session.id);
    }

    // =========================
    // 操作链：把用户动作及随后发生的DOM、网络、异常关联起来。
    // =========================

    function activeActionId() {
        return state.action.id && Date.now() <= state.action.expiresAt ? state.action.id : '';
    }
    function activeActionRootId() {
        return activeActionId() ? state.action.rootRecordId : '';
    }
    function actionWindowMs() { return Math.max(1000, Math.min(15000, Number(config.persistence.actionWindowMs) || 4500)); }
    function beginAction(event, target) {
        const nowMs = Date.now();
        const targetSelector = selectorFor(target);
        const eventName = event?.type || 'action';
        if (activeActionId() && state.action.target === targetSelector && nowMs - state.action.startedAt < 900) {
            state.action.expiresAt = nowMs + actionWindowMs();
            return state.action.id;
        }
        const key = event?.key ? `:${event.key}` : '';
        const seq = state.action.seq + 1;
        state.action = {
            seq,
            id: `${SESSION}-action-${seq}`,
            rootRecordId: '', target: targetSelector,
            label: `${eventName}${key} · ${targetSelector || target?.tagName || '页面'}`,
            startedAt: nowMs, expiresAt: nowMs + actionWindowMs()
        };
        return state.action.id;
    }
    function extendCurrentAction(ms = actionWindowMs()) {
        if (activeActionId()) state.action.expiresAt = Date.now() + ms;
        return activeActionId();
    }

    function str(v) { try { return String(v ?? ''); } catch { return ''; } }
    function clip(v, n = config.limits.text) {
        const x = str(v);
        return x.length > n ? `${x.slice(0, n)}…[截断${x.length - n}]` : x;
    }
    function iso() { return new Date().toISOString(); }
    function sensitive(k) { return SENSITIVE_RE.test(str(k)); }
    function safeUrl(value) {
        try {
            const u = new URL(str(value), location.href);
            for (const [k] of u.searchParams) {
                if (sensitive(k) || config.privacy.maskUrlValues) u.searchParams.set(k, '[已隐藏]');
            }
            return u.href;
        } catch { return clip(value, 4000); }
    }
    function safeHeaders(input) {
        const out = {};
        try {
            if (input instanceof Headers) input.forEach((v, k) => { out[k] = sensitive(k) ? '[已隐藏]' : clip(v, 2000); });
            else if (Array.isArray(input)) input.slice(0, 60).forEach(x => { if (x?.length >= 2) out[x[0]] = sensitive(x[0]) ? '[已隐藏]' : clip(x[1], 2000); });
            else if (input && typeof input === 'object') Object.entries(input).slice(0, 60).forEach(([k, v]) => { out[k] = sensitive(k) ? '[已隐藏]' : clip(v, 2000); });
        } catch {}
        return out;
    }
    function safeObject(value, depth = 0, seen = new WeakSet()) {
        if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
        if (typeof value === 'string') return clip(value, 4000);
        if (typeof value === 'bigint') return `${value}n`;
        if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
        if (depth > 2) return `[${Object.prototype.toString.call(value).slice(8, -1)}]`;
        if (typeof value === 'object') {
            try { if (seen.has(value)) return '[循环引用]'; seen.add(value); } catch {}
        }
        try {
            if (value instanceof Element) return describeElement(value, false);
            if (value instanceof FormData || value instanceof URLSearchParams) {
                const out = {}; let count = 0;
                value.forEach((v, k) => { if (++count <= 50) out[k] = sensitive(k) ? '[已隐藏]' : safeObject(v, depth + 1, seen); });
                return out;
            }
            if (value instanceof Headers) return safeHeaders(value);
            if (value instanceof Blob) return `[Blob:${value.size};${value.type || ''}]`;
            if (value instanceof ArrayBuffer) return `[ArrayBuffer:${value.byteLength}]`;
            if (Array.isArray(value)) return value.slice(0, 50).map(v => safeObject(v, depth + 1, seen));
            if (typeof value === 'object') {
                const out = {};
                for (const k of Object.keys(value).slice(0, 60)) out[k] = sensitive(k) ? '[已隐藏]' : safeObject(value[k], depth + 1, seen);
                return out;
            }
        } catch {}
        return clip(value, 4000);
    }
    function parseBody(body) {
        if (!config.privacy.captureRequestBody) return '[已关闭请求体抓取]';
        try {
            if (body == null) return null;
            if (typeof body === 'string') {
                const text = clip(body, config.limits.body);
                try { return safeObject(JSON.parse(text)); } catch { return text; }
            }
            return safeObject(body);
        } catch { return '[请求体读取失败]'; }
    }
    function cssEscape(v) {
        try { return CSS.escape(str(v)); }
        catch { return str(v).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }
    }
    function selectorFor(el) {
        try {
            if (!(el instanceof Element)) return '';
            if (el.id) return `#${cssEscape(el.id)}`;
            const test = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-qa');
            if (test) return `${el.tagName.toLowerCase()}[data-testid="${cssEscape(test)}"]`;
            const role = el.getAttribute('role');
            const name = el.getAttribute('name');
            if (role && name) return `${el.tagName.toLowerCase()}[role="${cssEscape(role)}"][name="${cssEscape(name)}"]`;
            const parts = []; let node = el;
            for (let i = 0; node && i < 6; i++, node = node.parentElement) {
                let p = node.tagName.toLowerCase();
                const stable = [...node.classList].filter(x => x && x.length < 70 && !/^(css-|sc-|ant-|el-).*[a-f0-9]{6,}/i.test(x)).slice(0, 2);
                if (stable.length) p += `.${stable.map(cssEscape).join('.')}`;
                if (!stable.length && node.parentElement) {
                    const siblings = [...node.parentElement.children].filter(x => x.tagName === node.tagName);
                    if (siblings.length > 1) p += `:nth-of-type(${siblings.indexOf(node) + 1})`;
                }
                parts.unshift(p);
                if (node.id) break;
            }
            return parts.join(' > ');
        } catch { return ''; }
    }
    function describeElement(el, detailed = false) {
        if (!(el instanceof Element)) return null;
        const attrs = {};
        try {
            [...el.attributes].slice(0, 35).forEach(a => { attrs[a.name] = sensitive(a.name) ? '[已隐藏]' : clip(a.value, 1200); });
        } catch {}
        const out = {
            tag: el.tagName.toLowerCase(), id: el.id || '', className: clip(el.className, 1600),
            role: el.getAttribute('role') || '', name: el.getAttribute('name') || '', type: el.getAttribute('type') || '',
            text: clip(el.textContent || '', detailed ? 2400 : 500), attrs, selector: selectorFor(el), connected: !!el.isConnected
        };
        if (detailed) {
            try { out.html = clip(el.outerHTML, config.limits.html); } catch {}
            try { const r = el.getBoundingClientRect(); out.rect = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; } catch {}
        }
        return out;
    }
    function isToolOwnedNode(node) {
        try {
            return node instanceof Element && (node.id === UI_HOST_ID || node.hasAttribute('data-miuyi-wct-outline') || node.hasAttribute('data-miuyi-wct-flash'));
        } catch { return false; }
    }
    function scanExcludeSelectors() {
        const raw = str(config.continuousScan.excludeSelectors || '');
        const cache = state.scanExclusionCache;
        if (cache.source === raw) return cache.selectors;
        cache.source = raw;
        cache.selectors = raw.split(/\r?\n/).map(x => x.trim()).filter(Boolean).filter(selector => {
            try { document.documentElement?.matches(selector); return true; } catch { return false; }
        }).slice(0, 40);
        return cache.selectors;
    }
    function invalidScanExcludeSelectors(raw) {
        const invalid = [];
        for (const selector of str(raw).split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, 100)) {
            try { document.documentElement?.matches(selector); } catch { invalid.push(selector); }
        }
        return invalid;
    }
    function isScanExcluded(node) {
        if (!(node instanceof Element)) return false;
        if (isToolOwnedNode(node)) return true;
        for (const selector of scanExcludeSelectors()) {
            try { if (node.matches(selector) || node.closest(selector)) return true; } catch {}
        }
        return false;
    }

    function limitFor(type) {
        if (type === 'routes') return 100;
        return Number(config.limits[type] || 300);
    }
    function pushRecord(type, payload, options = {}) {
        if (!state.records[type] || state.capturePaused || state.hardStopped) return null;
        const actionId = payload?.actionId || options.actionId || activeActionId();
        const actionRootId = payload?.actionRootId || options.actionRootId || activeActionRootId();
        const item = {
            id: `${SESSION}-${type}-${++state.counters[type]}`,
            sessionId: SESSION, type, time: iso(), pageStage: state.routeStage,
            frameId: options.frameId || FRAME, frameUrl: options.frameUrl || safeUrl(location.href),
            actionId, actionRootId, ...payload
        };
        state.records[type].unshift(item);
        const max = limitFor(type);
        if (state.records[type].length > max) {
            state.diagnostics.trimmed[type] += state.records[type].length - max;
            state.records[type].length = max;
        }
        state.diagnostics.lastRecordAt = item.time;
        if (type === 'errors') { state.unreadErrors++; state.diagnostics.lastErrorAt = item.time; }
        if (!TOP) sendToTop(type, item);
        else queuePersistRecord(item, true);
        scheduleUI();
        return item;
    }
    function receiveFrameRecord(data) {
        if (!TOP || state.capturePaused || state.hardStopped || !data || !state.records[data.type]) return;
        const item = { ...data.item, sourceSessionId: data.item.sessionId || '', sessionId: SESSION, remote: true };
        state.records[data.type].unshift(item);
        if (state.records[data.type].length > limitFor(data.type)) {
            state.diagnostics.trimmed[data.type] += state.records[data.type].length - limitFor(data.type);
            state.records[data.type].length = limitFor(data.type);
        }
        state.counters[data.type]++;
        if (data.type === 'errors') state.unreadErrors++;
        state.diagnostics.lastRecordAt = item.time;
        if (data.type === 'errors') state.diagnostics.lastErrorAt = item.time;
        queuePersistRecord(item, true);
        scheduleUI();
    }
    function sendToTop(type, item) {
        try { window.top.postMessage({ mark: MESSAGE_MARK, type, item }, '*'); } catch {}
    }
    function publicConfig() {
        return { mode: config.mode, continuousScan: { ...config.continuousScan }, persistence: { actionWindowMs: config.persistence.actionWindowMs }, modules: { ...config.modules }, limits: { ...config.limits }, privacy: { ...config.privacy } };
    }
    function broadcastToFrames(message) {
        try { for (const frame of document.querySelectorAll('iframe')) frame.contentWindow?.postMessage(message, '*'); } catch {}
    }
    function installFrameBridge() {
        if (state.frameBridgeInstalled) return;
        state.frameBridgeInstalled = true;
        const fn = e => {
            const data = e.data;
            if (data?.mark === MESSAGE_MARK) { receiveFrameRecord(data); return; }
            if (data?.mark !== MESSAGE_CONTROL) return;
            if (data.action === 'hello') {
                try { e.source?.postMessage({ mark: MESSAGE_CONTROL, action: 'config', config: publicConfig(), paused: state.capturePaused, stopped: state.hardStopped }, '*'); } catch {}
                return;
            }
            if (data.action === 'emergency' && TOP) { hardStop(); return; }
            if (data.action === 'config' && !TOP) {
                config = mergeConfig(config, data.config || {});
                state.capturePaused = !!data.paused;
                if (data.stopped) hardStop(true);
                else reconfigureProbes();
                broadcastToFrames(data);
                return;
            }
            if (data.action === 'pause' && !TOP) { state.capturePaused = true; state.phase = 'paused'; broadcastToFrames(data); return; }
            if (data.action === 'resume' && !TOP) { if (state.hardStopped) restart(true); state.capturePaused = false; state.phase = 'capturing'; broadcastToFrames(data); return; }
            if (data.action === 'stop' && !TOP) hardStop(true);
        };
        bindPersistent(window, 'message', fn, true);
        if (!TOP) try { window.parent.postMessage({ mark: MESSAGE_CONTROL, action: 'hello' }, '*'); } catch {}
    }

    function bind(target, type, fn, options) {
        try { target.addEventListener(type, fn, options); state.listeners.push([target, type, fn, options]); } catch {}
    }
    function bindPersistent(target, type, fn, options) {
        try { target.addEventListener(type, fn, options); state.persistentListeners.push([target, type, fn, options]); } catch {}
    }
    function removeBoundListeners(filter) {
        const keep = [];
        for (const item of state.listeners) {
            if (!filter || filter(item)) { try { item[0].removeEventListener(item[1], item[2], item[3]); } catch {} }
            else keep.push(item);
        }
        state.listeners = filter ? keep : [];
    }

    function installErrors() {
        if (state.installed.has('errors') || !config.modules.errors) return;
        state.installed.add('errors');
        const onError = e => {
            if (e.target instanceof Element && e.target !== window) pushRecord('errors', { source: 'resource', message: '资源加载失败', element: describeElement(e.target) });
            else pushRecord('errors', { source: 'window', message: clip(e.message || e.error, 4000), filename: safeUrl(e.filename || ''), line: e.lineno, column: e.colno, stack: clip(e.error?.stack || '', 8000) });
        };
        const onReject = e => pushRecord('errors', { source: 'promise', message: clip(e.reason?.message || e.reason, 4000), stack: clip(e.reason?.stack || '', 8000) });
        bind(window, 'error', onError, true);
        bind(window, 'unhandledrejection', onReject, true);
    }

    function installEvents() {
        if (state.installed.has('events') || !config.modules.events) return;
        state.installed.add('events');
        const types = ['click', 'dblclick', 'focusin', 'focusout', 'beforeinput', 'input', 'change', 'keydown', 'keyup', 'submit', 'pointerdown'];
        const handler = e => {
            if (state.pickerActive || isUiEvent(e)) return;
            const t = e.target instanceof Element ? e.target : null;
            const startsAction = e.type === 'pointerdown' || (e.type === 'click' && !activeActionId()) || e.type === 'dblclick' || e.type === 'submit' || e.type === 'focusin' || (e.type === 'keydown' && ['Enter', ' ', 'Tab'].includes(e.key));
            const actionId = startsAction ? beginAction(e, t) : extendCurrentAction();
            const value = t && ('value' in t) ? (sensitive(t.name) || t.type === 'password' ? '[已隐藏]' : clip(t.value, 1000)) : undefined;
            const record = pushRecord('events', {
                actionId,
                event: e.type, target: describeElement(t), value,
                key: 'key' in e ? e.key : undefined, code: 'code' in e ? e.code : undefined,
                button: 'button' in e ? e.button : undefined,
                modifiers: { ctrl: !!e.ctrlKey, alt: !!e.altKey, shift: !!e.shiftKey, meta: !!e.metaKey }
            });
            if (startsAction && record && !state.action.rootRecordId) {
                state.action.rootRecordId = record.id;
                record.actionRootId = record.id;
                queuePersistRecord(record, false);
            }
        };
        types.forEach(type => bind(document, type, handler, true));
    }

    function isUiEvent(e) {
        try { return TOP && state.ui?.host && e.composedPath?.().includes(state.ui.host); }
        catch { return false; }
    }

    // =========================
    // 智能持续扫描器
    // 基线只做一次，后续只扫描新增/变化子树；瞬时浮层走高优先级快照。
    // =========================

    const EPHEMERAL_SELECTOR = [
        '[role="dialog"]', '[role="listbox"]', '[role="menu"]', '[role="tooltip"]',
        '[aria-modal="true"]', '[data-state="open"]', '[data-popup-placement]',
        '.ant-dropdown', '.ant-popover', '.ant-tooltip', '.ant-modal', '.ant-drawer', '.ant-select-dropdown',
        '.el-popper', '.el-dialog', '.el-drawer', '.v-popper__popper',
        '.MuiPopover-root', '.MuiModal-root', '.MuiTooltip-popper',
        '.dropdown-menu', '.popover', '.tooltip', '.modal', '.drawer', '.context-menu'
    ].join(',');

    function stableClasses(el) {
        try {
            return [...el.classList]
                .filter(x => x && x.length < 80)
                .filter(x => !/^(css-|sc-|jss-|emotion-|_[a-z]).*[a-f0-9]{6,}/i.test(x))
                .filter(x => !/^[a-f0-9]{8,}$/i.test(x))
                .sort().slice(0, 14);
        } catch { return []; }
    }
    function componentFingerprint(el) {
        try {
            const tag = el.tagName.toLowerCase();
            const role = el.getAttribute('role') || '';
            const type = el.getAttribute('type') || '';
            const marker = el.getAttribute('data-component') || el.getAttribute('data-testid') || el.getAttribute('data-test') || '';
            const children = [...el.children].slice(0, 12).map(x => `${x.tagName.toLowerCase()}:${x.getAttribute('role') || ''}`).join(',');
            return `${tag}|${role}|${type}|${marker}|${stableClasses(el).join('.')}|${children}`;
        } catch { return `unknown|${Date.now()}|${Math.random()}`; }
    }
    function describeComponentSample(el) {
        if (!(el instanceof Element)) return null;
        const attrs = {};
        try {
            for (const a of [...el.attributes].slice(0, 20)) {
                if (sensitive(a.name)) attrs[a.name] = '[已隐藏]';
                else if (/^(id|class|role|type|name|title|placeholder|aria-|data-)/i.test(a.name)) attrs[a.name] = clip(a.value, 600);
            }
        } catch {}
        let ownText = '';
        try {
            ownText = [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.nodeValue || '').join(' ').replace(/\s+/g, ' ').trim();
            ownText ||= el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || '';
        } catch {}
        return {
            tag: el.tagName.toLowerCase(), id: el.id || '', className: clip(el.className, 1200),
            role: el.getAttribute('role') || '', type: el.getAttribute('type') || '',
            selector: selectorFor(el), ownText: clip(ownText, 500), attrs, connected: !!el.isConnected
        };
    }
    function isEphemeralElement(el) {
        if (!(el instanceof Element) || isToolOwnedNode(el)) return false;
        try {
            if (el.matches(EPHEMERAL_SELECTOR)) return true;
            const style = el.getAttribute('style') || '';
            return /position\s*:\s*(fixed|absolute)/i.test(style) && /(z-index|inset|top|left)/i.test(style);
        } catch { return false; }
    }
    function addUniqueSample(list, value, limit) {
        if (!value || list.length >= limit) return;
        const key = typeof value === 'string' ? value : JSON.stringify(value);
        if (!list.some(x => (typeof x === 'string' ? x : JSON.stringify(x)) === key)) list.push(value);
    }
    function captureContinuousComponent(el, options = {}) {
        const c = state.continuous;
        if (!(el instanceof Element) || isToolOwnedNode(el) || state.hardStopped || !config.continuousScan.enabled) return null;
        const removed = !!options.removed;
        const knownKey = c.elementKeys.get(el);
        const key = knownKey || componentFingerprint(el);
        let record = c.index.get(key);

        if (removed) {
            if (!config.continuousScan.captureRemoved) return record;
            if (!record) {
                record = pushRecord('components', {
                    actionId: options.actionId || activeActionId(), actionRootId: options.actionRootId || activeActionRootId(),
                    kind: 'continuous', fingerprint: key, signature: key, count: 1, hits: 1,
                    firstSeen: iso(), lastSeen: iso(), presentCount: 0, removedCount: 1,
                    status: 'removed', reasons: [options.reason || 'DOM移除'], stages: [state.routeStage],
                    ephemeral: isEphemeralElement(el), sample: describeElement(el, true)
                });
                if (record) c.index.set(key, record);
            } else {
                record.removedCount = (record.removedCount || 0) + 1;
                record.presentCount = Math.max(0, (record.presentCount || 0) - 1);
                record.status = record.presentCount > 0 ? 'present' : 'removed';
                record.lastSeen = iso(); record.lastRemoved = iso();
                addUniqueSample(record.reasons ||= [], options.reason || 'DOM移除', 12);
            }
            c.counters.removed++;
            if (record) {
                addUniqueSample(record.actionIds ||= [], options.actionId || activeActionId(), 12);
                queuePersistRecord(record, false);
            }
            scheduleUI();
            return record;
        }

        const wasKnownElement = !!knownKey;
        if (wasKnownElement && !options.force) return record;
        c.elementKeys.set(el, key);
        c.seenElements.add(el);
        const ephemeral = !!options.ephemeral || isEphemeralElement(el);
        const detailed = ephemeral || !!options.detailed;
        const sample = detailed ? describeElement(el, true) : (!record ? describeComponentSample(el) : null);

        if (!record || !config.continuousScan.dedupe) {
            record = pushRecord('components', {
                actionId: options.actionId || activeActionId(), actionRootId: options.actionRootId || activeActionRootId(),
                kind: ephemeral ? 'ephemeral' : 'continuous', fingerprint: key, signature: key,
                count: 1, hits: 1, firstSeen: iso(), lastSeen: iso(), presentCount: 1, removedCount: 0,
                status: 'present', reasons: [options.reason || '持续扫描'], stages: [state.routeStage],
                ephemeral, sample: sample || describeComponentSample(el), samples: detailed && sample ? [sample] : []
            });
            if (record && config.continuousScan.dedupe) c.index.set(key, record);
            if (record) c.counters.newComponents++;
        } else {
            record.hits = (record.hits || 1) + 1;
            record.count = record.hits;
            if (!wasKnownElement) record.presentCount = (record.presentCount || 0) + 1;
            record.status = 'present'; record.lastSeen = iso();
            addUniqueSample(record.reasons ||= [], options.reason || '持续扫描', 12);
            addUniqueSample(record.stages ||= [], state.routeStage, 12);
            addUniqueSample(record.actionIds ||= [], options.actionId || activeActionId(), 12);
            if (detailed && sample) addUniqueSample(record.samples ||= [], sample, 4);
            c.counters.duplicateHits++;
            queuePersistRecord(record, false);
        }
        if (ephemeral) c.counters.ephemeral++;
        c.counters.scanned++;
        scheduleUI();
        return record;
    }
    function captureEphemeralSubtree(root, reason, deep = false) {
        if (!config.continuousScan.enabled || !config.continuousScan.ephemeralPriority || !(root instanceof Element) || isScanExcluded(root)) return;
        let count = 0, visited = 0;
        try {
            if (deep) {
                if (isEphemeralElement(root)) captureContinuousComponent(root, { reason, ephemeral: true, detailed: true, force: true });
                for (const el of root.querySelectorAll(EPHEMERAL_SELECTOR)) {
                    if (isScanExcluded(el)) continue;
                    captureContinuousComponent(el, { reason, ephemeral: true, detailed: true, force: true });
                    if (++count >= 20) break;
                }
                return;
            }
            const walker = (root.ownerDocument || document).createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
            let el = walker.currentNode;
            while (el && visited++ < 120 && count < 8) {
                if (isScanExcluded(el)) { el = walker.nextNode(); continue; }
                if (isEphemeralElement(el)) {
                    captureContinuousComponent(el, { reason, ephemeral: true, detailed: true, force: true });
                    count++;
                }
                el = walker.nextNode();
            }
        } catch {}
    }
    function captureDynamicStyleElement(el, reason) {
        if (!config.continuousScan.enabled || !config.continuousScan.cssChanges || !(el instanceof Element)) return;
        try {
            const tag = el.tagName.toLowerCase();
            if (tag !== 'style' && !(tag === 'link' && /stylesheet/i.test(el.getAttribute('rel') || ''))) return;
            pushRecord('css', {
                kind: 'dynamic', operation: reason, tag, href: safeUrl(el.href || el.getAttribute('href') || ''),
                media: el.getAttribute('media') || '', cssText: tag === 'style' ? clip(el.textContent || '', 20000) : ''
            });
            state.continuous.counters.cssChanges++;
        } catch {}
    }
    function queueContinuous(node, reason, options = {}) {
        const c = state.continuous;
        if (!config.continuousScan.enabled || c.suspended || state.capturePaused || state.hardStopped || !node) return;
        if (node.nodeType !== 1 && node.nodeType !== 11 && node.nodeType !== 9) return;
        if (node.nodeType === 1 && isScanExcluded(node)) { state.diagnostics.dropped.excludedRoots++; return; }
        if (config.continuousScan.pauseWhenHidden && document.visibilityState === 'hidden') {
            c.backgroundDirty = true; c.phase = '页面在后台，持续扫描已降载'; state.diagnostics.dropped.backgroundChanges++; scheduleUI(); return;
        }
        const existing = c.queuedItems.get(node);
        if (existing) {
            if (options.removed) existing.removed = true;
            if (options.force) existing.force = true;
            return;
        }
        if (c.queue.length >= config.limits.queue) {
            state.diagnostics.dropped.continuousQueue++;
            c.suspended = true; c.phase = '队列过载，已暂停持续扫描';
            state.overloaded = true; state.overloadReason = '持续扫描队列已满'; scheduleUI(true);
            const token = ++state.overloadToken;
            setTimeout(() => {
                if (state.overloadToken === token && config.continuousScan.enabled && !state.hardStopped) {
                    c.suspended = false; state.overloaded = false; state.overloadReason = ''; c.phase = '过载恢复，继续处理队列'; scheduleContinuousProcessing(); scheduleUI(true);
                }
            }, 5000);
            return;
        }
        const item = {
            node, reason, removed: !!options.removed, shallow: !!options.shallow, force: !!options.force,
            actionId: options.actionId || activeActionId(), actionRootId: options.actionRootId || activeActionRootId(), walker: null, current: null
        };
        c.queuedItems.set(node, item); c.queue.push(item);
        scheduleContinuousProcessing();
    }
    function scheduleContinuousProcessing() {
        const c = state.continuous;
        if (c.processing || c.suspended || !config.continuousScan.enabled || state.capturePaused || state.hardStopped) return;
        if (config.continuousScan.pauseWhenHidden && document.visibilityState === 'hidden') {
            c.backgroundDirty = true; c.phase = '页面在后台，持续扫描已降载'; scheduleUI(); return;
        }
        c.processing = true;
        const epoch = c.epoch;
        const run = () => { if (epoch === c.epoch) processContinuousQueue(); };
        if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 120 }); else setTimeout(run, 20);
    }
    function processContinuousQueue() {
        const c = state.continuous;
        const started = performance.now();
        const budget = Math.max(2, Math.min(16, Number(config.continuousScan.idleBudgetMs) || 6));
        try {
            while (c.queue.length && performance.now() - started < budget && !c.suspended && !state.capturePaused && !state.hardStopped && !(config.continuousScan.pauseWhenHidden && document.visibilityState === 'hidden')) {
                const item = c.queue[0];
                const root = item.node;
                if (!item.initialized) {
                    item.initialized = true;
                    if (!item.shallow) try { item.walker = (root.ownerDocument || document).createTreeWalker(root, NodeFilter.SHOW_ELEMENT); } catch {}
                    item.current = root instanceof Element ? root : item.walker?.nextNode();
                }

                const el = item.current;
                if (!el) {
                    c.queue.shift(); try { c.queuedItems.delete(root); } catch {} continue;
                }
                item.current = item.shallow ? null : item.walker?.nextNode();
                if (isScanExcluded(el)) continue;
                captureContinuousComponent(el, { reason: item.reason, removed: item.removed, force: item.force, actionId: item.actionId, actionRootId: item.actionRootId });
                if (!item.removed) {
                    try {
                        if (el.shadowRoot) { observeRoot(el.shadowRoot); queueContinuous(el.shadowRoot, 'Shadow DOM增量扫描'); }
                        if (el.tagName === 'IFRAME' && el.contentDocument?.documentElement) queueContinuous(el.contentDocument.documentElement, '同源iframe增量扫描');
                    } catch {}
                    captureDynamicStyleElement(el, item.reason);
                }
            }
        } catch (e) { pushRecord('errors', { source: 'continuous-scan', message: clip(e?.message || e, 3000), stack: clip(e?.stack || '', 5000) }); }
        c.processing = false;
        if (c.queue.length && !c.suspended && !state.hardStopped) scheduleContinuousProcessing();
        else if (!c.queue.length && config.continuousScan.enabled) {
            c.active = true; c.baselineDone = true; c.phase = '智能持续扫描中'; scheduleUI(true);
        }
    }
    function continuousRescan(reason = '手动补扫', resetSeen = false) {
        const c = state.continuous;
        if (!config.continuousScan.enabled || state.hardStopped) return;
        if (resetSeen) c.seenElements = new WeakSet();
        c.active = true; c.suspended = false; c.phase = reason; c.generation++;
        queueContinuous(document.documentElement, reason, { force: resetSeen });
        for (const root of state.closedRoots) queueContinuous(root, `${reason} · 关闭式Shadow DOM`, { force: resetSeen });
        scheduleUI(true);
    }
    function clearContinuousTimers() {
        for (const timer of state.continuous.timers) { clearTimeout(timer); clearInterval(timer); }
        state.continuous.timers.clear();
    }
    function addContinuousTimer(timer) { state.continuous.timers.add(timer); return timer; }
    function scheduleContinuousTimeout(fn, delay) {
        let timer = 0;
        timer = setTimeout(() => { state.continuous.timers.delete(timer); fn(); }, delay);
        state.continuous.timers.add(timer);
        return timer;
    }
    function startContinuousScheduler() {
        clearContinuousTimers();
        const c = state.continuous;
        if (!config.continuousScan.enabled || state.hardStopped) { c.active = false; c.phase = '未开启'; return; }
        c.active = true; c.suspended = false; c.phase = '等待页面稳定后建立基线';
        const start = () => scheduleContinuousTimeout(() => continuousRescan('正在建立组件基线', true), Math.max(200, Number(config.continuousScan.baselineDelay) || 1500));
        if (document.readyState === 'complete') start(); else bind(window, 'load', start, { once: true });
        if (['patrol', 'full'].includes(config.continuousScan.mode)) {
            const seconds = Math.max(10, Number(config.continuousScan.patrolInterval) || 30);
            addContinuousTimer(setInterval(() => {
                if (document.visibilityState === 'visible' && !state.capturePaused) continuousRescan('定时巡检', config.continuousScan.mode === 'full');
            }, seconds * 1000));
        }
        bind(document, 'visibilitychange', () => {
            if (!config.continuousScan.pauseWhenHidden || !config.continuousScan.enabled) return;
            if (document.visibilityState === 'hidden') {
                c.backgroundDirty = true; c.phase = '页面在后台，持续扫描已降载'; scheduleUI(true);
            } else if (c.backgroundDirty) {
                c.backgroundDirty = false; continuousRescan('恢复前台自动补扫', false);
            } else scheduleContinuousProcessing();
        }, true);
        scheduleUI(true);
    }
    function stopContinuousScan(save = true) {
        config.continuousScan.enabled = false;
        clearContinuousTimers();
        const c = state.continuous; c.active = false; c.suspended = false; c.phase = '未开启'; c.queue = []; c.queuedItems = new WeakMap(); c.processing = false;
        c.epoch++;
        if (save) saveConfig(); scheduleUI(true);
    }
    function toggleContinuousScan() {
        if (config.continuousScan.enabled) { stopContinuousScan(); reconfigureProbes(); toast('智能持续扫描已关闭'); }
        else {
            config.continuousScan.enabled = true; saveConfig(); reconfigureProbes(); continuousRescan('正在建立组件基线', true); toast('智能持续扫描已开启');
        }
    }

    function mutationRate(count) {
        const sec = Math.floor(Date.now() / 1000);
        if (sec !== state.lastMutationSecond) {
            state.mutationsThisSecond = 0;
            state.lastMutationSecond = sec;
        }
        state.mutationsThisSecond += count;
        if (state.mutationsThisSecond > config.limits.mutationsPerSecond) {
            state.overloaded = true;
            state.overloadReason = `DOM变化过快：${state.mutationsThisSecond}/秒`;
            state.continuous.suspended = true;
            state.continuous.phase = 'DOM变化过快，持续扫描已降级暂停';
            const token = ++state.overloadToken;
            setTimeout(() => {
                if (state.overloadToken === token && state.domQueue.length < 50) {
                    state.overloaded = false; state.overloadReason = '';
                    if (config.continuousScan.enabled) {
                        state.continuous.suspended = false; state.continuous.phase = '智能持续扫描中'; scheduleContinuousProcessing();
                    }
                    scheduleUI(true);
                }
            }, 5000);
        }
    }
    function enqueueDom(node, reason) {
        if (!(node instanceof Element) || isToolOwnedNode(node)) return;
        if (state.domQueue.length >= config.limits.queue) { state.diagnostics.dropped.domQueue++; return; }
        try {
            if (node.shadowRoot) observeRoot(node.shadowRoot);
            else if (node.tagName?.includes('-')) setTimeout(() => discoverOpenShadowRoots(node), 0);
        } catch {}
        if (!config.modules.dom) return;
        state.domQueue.push({ node, reason, actionId: activeActionId(), actionRootId: activeActionRootId() });
        if (!state.domQueueScheduled) {
            state.domQueueScheduled = true;
            setTimeout(processDomQueue, 80);
        }
    }
    async function processDomQueue() {
        const started = performance.now();
        while (state.domQueue.length && performance.now() - started < 6) {
            const { node, reason, actionId, actionRootId } = state.domQueue.shift();
            pushRecord('dom', { reason, actionId, actionRootId, element: describeElement(node, false) });
        }
        state.domQueueScheduled = false;
        if (state.domQueue.length && !state.hardStopped) {
            state.domQueueScheduled = true;
            setTimeout(processDomQueue, state.overloaded ? 250 : 50);
        }
    }
    function observeRoot(root) {
        if (!root || (!config.modules.dom && !config.continuousScan.enabled) || state.observedRoots.has(root)) return;
        const obs = new MutationObserver(mutations => {
            if (state.capturePaused || state.hardStopped) return;
            mutationRate(mutations.length);
            let budget = state.overloaded ? 6 : 40;
            for (const m of mutations) {
                if (m.type === 'childList') {
                    if (m.target instanceof Element) captureDynamicStyleElement(m.target, 'CSS节点内容变化');
                    for (const n of m.addedNodes) if (n instanceof Element) {
                        captureEphemeralSubtree(n, '瞬时组件出现');
                        queueContinuous(n, '新增DOM增量扫描');
                        captureDynamicStyleElement(n, '新增CSS节点');
                        if (budget-- > 0) enqueueDom(n, '新增DOM');
                    }
                    for (const n of m.removedNodes) if (n instanceof Element) {
                        queueContinuous(n, '组件从页面移除', { removed: true });
                        if (budget-- > 0) enqueueDom(n, '移除DOM');
                    }
                } else if (m.type === 'attributes' && m.target instanceof Element) {
                    queueContinuous(m.target, `属性变化:${m.attributeName || ''}`, { shallow: true, force: true });
                    if (budget-- > 0) enqueueDom(m.target, `属性变化:${m.attributeName || ''}`);
                }
            }
        });
        try {
            obs.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'disabled', 'aria-hidden', 'aria-expanded', 'data-state', 'data-status'] });
            state.observedRoots.add(root);
            state.observers.push(obs);
        } catch {}
    }
    async function discoverOpenShadowRoots(root) {
        if (!root || state.hardStopped || (!config.modules.dom && !config.continuousScan.enabled)) return;
        try {
            const doc = root.ownerDocument || document;
            const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
            let node = root instanceof Element ? walker.currentNode : walker.nextNode(), batch = 0;
            while (node && !state.hardStopped && (config.modules.dom || config.continuousScan.enabled)) {
                if (!isToolOwnedNode(node) && node.shadowRoot) observeRoot(node.shadowRoot);
                node = walker.nextNode();
                if (++batch >= 250) { batch = 0; await idle(); }
            }
        } catch {}
    }
    function installDom() {
        if (state.installed.has('dom') || (!config.modules.dom && !config.continuousScan.enabled) || !document.documentElement) return;
        state.installed.add('dom');
        observeRoot(document.documentElement);
        for (const root of state.closedRoots) observeRoot(root);
        setTimeout(() => discoverOpenShadowRoots(document.documentElement), document.readyState === 'complete' ? 200 : 1200);
    }

    function installShadowHook() {
        if (state.installed.has('shadow') || !config.modules.shadowClosed) return;
        const proto = Element.prototype;
        if (!proto.attachShadow || proto.attachShadow.__miuyiWctV3) return;
        state.installed.add('shadow');
        const raw = proto.attachShadow;
        state.originals.attachShadow = raw;
        function wrapped(init) {
            const root = raw.apply(this, arguments);
            state.closedRoots.add(root);
            if ((config.modules.dom || config.continuousScan.enabled) && state.installed.has('dom')) observeRoot(root);
            return root;
        }
        Object.defineProperty(wrapped, '__miuyiWctV3', { value: true });
        proto.attachShadow = wrapped;
    }

    function installCssMutationHooks() {
        if (state.installed.has('css-hooks') || !config.continuousScan.enabled || !config.continuousScan.cssChanges) return;
        const P = window.CSSStyleSheet?.prototype;
        if (!P) return;
        state.installed.add('css-hooks');
        const hooks = {};
        const describeSheetChange = (sheet, operation, args) => {
            try {
                pushRecord('css', {
                    kind: 'cssom-change', operation, href: safeUrl(sheet.href || sheet.ownerNode?.href || ''),
                    owner: sheet.ownerNode instanceof Element ? describeElement(sheet.ownerNode, false) : null,
                    argument: clip(args?.[0] || '', 8000), ruleCount: (() => { try { return sheet.cssRules?.length ?? null; } catch { return null; } })()
                });
                state.continuous.counters.cssChanges++;
            } catch {}
        };
        for (const name of ['insertRule', 'deleteRule', 'replaceSync']) {
            if (typeof P[name] !== 'function') continue;
            const raw = P[name]; hooks[name] = raw;
            P[name] = function () { const out = raw.apply(this, arguments); describeSheetChange(this, name, arguments); return out; };
        }
        if (typeof P.replace === 'function') {
            const raw = P.replace; hooks.replace = raw;
            P.replace = function () {
                const out = raw.apply(this, arguments);
                Promise.resolve(out).then(() => describeSheetChange(this, 'replace', arguments), () => {});
                return out;
            };
        }
        state.originals.cssHooks = { P, hooks };
    }

    async function responseBody(resp) {
        if (!config.privacy.captureResponseBody) return '[已关闭响应体抓取]';
        try {
            const type = resp.headers?.get('content-type') || '';
            const len = Number(resp.headers?.get('content-length') || 0);
            if (len > config.limits.response) return `[响应体${len}字节，超过限制]`;
            if (!/json|text|xml|html|javascript|urlencoded/i.test(type) && type) return `[二进制响应:${type}]`;
            const text = clip(await resp.text(), config.limits.response);
            if (/json/i.test(type)) { try { return safeObject(JSON.parse(text)); } catch {} }
            return text;
        } catch (e) { return `[响应读取失败:${clip(e, 600)}]`; }
    }
    function installNetwork() {
        if (state.installed.has('network') || !config.modules.network) return;
        state.installed.add('network');
        const rawFetch = window.fetch;
        if (typeof rawFetch === 'function' && !rawFetch.__miuyiWctV3) {
            state.originals.fetch = rawFetch;
            function wrappedFetch(input, init) {
                const started = performance.now();
                const meta = {
                    channel: 'fetch', method: str(init?.method || input?.method || 'GET').toUpperCase(),
                    url: safeUrl(typeof input === 'string' || input instanceof URL ? input : input?.url),
                    requestHeaders: safeHeaders(init?.headers || input?.headers),
                    actionId: activeActionId(), actionRootId: activeActionRootId()
                };
                if (init?.body != null) meta.requestBody = parseBody(init.body);
                const originalPromise = rawFetch.apply(this, arguments);
                originalPromise.then(resp => {
                    const item = { ...meta, status: resp.status, ok: resp.ok, statusText: resp.statusText, responseUrl: safeUrl(resp.url), responseHeaders: safeHeaders(resp.headers), ms: Math.round((performance.now() - started) * 10) / 10 };
                    let clone = null; try { clone = resp.clone(); } catch {}
                    setTimeout(async () => { if (clone) item.responseBody = await responseBody(clone); pushRecord('network', item); }, 0);
                }, error => pushRecord('network', { ...meta, error: clip(error, 4000), ms: Math.round((performance.now() - started) * 10) / 10 }));
                return originalPromise;
            }
            Object.defineProperty(wrappedFetch, '__miuyiWctV3', { value: true });
            window.fetch = wrappedFetch;
        }
        const P = window.XMLHttpRequest?.prototype;
        if (P && !P.__miuyiWctV3) {
            const rawOpen = P.open, rawSend = P.send, rawHeader = P.setRequestHeader;
            state.originals.xhr = { P, rawOpen, rawSend, rawHeader };
            P.open = function (method, url) { this.__miuyiWctMeta = { channel: 'xhr', method: str(method).toUpperCase(), url: safeUrl(url), requestHeaders: {} }; return rawOpen.apply(this, arguments); };
            P.setRequestHeader = function (k, v) { if (this.__miuyiWctMeta) this.__miuyiWctMeta.requestHeaders[k] = sensitive(k) ? '[已隐藏]' : clip(v, 2000); return rawHeader.apply(this, arguments); };
            P.send = function (body) {
                const meta = this.__miuyiWctMeta; const started = performance.now();
                if (meta) {
                    meta.actionId = activeActionId(); meta.actionRootId = activeActionRootId();
                    meta.requestBody = parseBody(body);
                    this.addEventListener('loadend', () => {
                        let bodyOut = '';
                        if (!config.privacy.captureResponseBody) bodyOut = '[已关闭响应体抓取]';
                        else try { bodyOut = this.responseType === '' || this.responseType === 'text' ? clip(this.responseText, config.limits.response) : safeObject(this.response); } catch { bodyOut = '[响应不可读]'; }
                        pushRecord('network', { ...meta, status: this.status, statusText: this.statusText, responseUrl: safeUrl(this.responseURL), responseBody: bodyOut, ms: Math.round((performance.now() - started) * 10) / 10 });
                    }, { once: true });
                }
                return rawSend.apply(this, arguments);
            };
            Object.defineProperty(P, '__miuyiWctV3', { configurable: true, value: true });
        }
    }

    function installPerformance() {
        if (state.installed.has('performance') || !config.modules.performance || !window.PerformanceObserver) return;
        state.installed.add('performance');
        for (const type of ['resource', 'longtask']) {
            try {
                const po = new PerformanceObserver(list => {
                    for (const e of list.getEntries()) {
                        if (type === 'resource') pushRecord('performance', { metric: 'resource', name: safeUrl(e.name), initiatorType: e.initiatorType, duration: Math.round(e.duration * 10) / 10, transferSize: e.transferSize || 0 });
                        else pushRecord('performance', { metric: 'longtask', startTime: Math.round(e.startTime * 10) / 10, duration: Math.round(e.duration * 10) / 10 });
                    }
                });
                po.observe({ type, buffered: true }); state.observers.push(po);
            } catch {}
        }
    }

    function installRoute() {
        if (state.installed.has('route') || !config.modules.route) return;
        state.installed.add('route');
        const changed = source => {
            if (location.href === state.currentRoute) return;
            const from = state.currentRoute; state.currentRoute = location.href; state.routeStage++;
            pushRecord('routes', { source, from: safeUrl(from), to: safeUrl(location.href), title: document.title });
            if (config.continuousScan.enabled && config.continuousScan.routeRescan) {
                const early = scheduleContinuousTimeout(() => continuousRescan('路由切换初步补扫', true), 300);
                const late = scheduleContinuousTimeout(() => continuousRescan('路由异步组件补扫', false), 1500);
                void early; void late;
            }
        };
        for (const name of ['pushState', 'replaceState']) {
            const raw = history[name]; state.originals[name] = raw;
            history[name] = function () { const out = raw.apply(this, arguments); queueMicrotask(() => changed(name)); return out; };
        }
        bind(window, 'popstate', () => changed('popstate'), true);
        bind(window, 'hashchange', () => changed('hashchange'), true);
    }

    function setupProbes() {
        installShadowHook();
        installCssMutationHooks();
        installErrors();
        installEvents();
        installNetwork();
        installPerformance();
        installRoute();
        if (document.documentElement) installDom();
        else bind(document, 'readystatechange', () => { if (document.documentElement) installDom(); }, { once: true });
        startContinuousScheduler();
        state.phase = state.capturePaused ? 'paused' : 'capturing';
        scheduleUI(true);
    }
    function disconnectProbes() {
        state.observers.splice(0).forEach(o => { try { o.disconnect(); } catch {} });
        removeBoundListeners();
        restoreHooks();
        state.domQueue = [];
        state.domQueueScheduled = false;
        clearContinuousTimers();
        state.continuous.queue = [];
        state.continuous.queuedItems = new WeakMap();
        state.continuous.processing = false;
        state.continuous.epoch++;
        state.installed.clear();
        state.observedRoots = new WeakSet();
    }
    function reconfigureProbes() {
        if (state.hardStopped) return;
        disconnectProbes();
        setupProbes();
    }
    function restoreHooks() {
        try { if (state.originals.fetch && window.fetch?.__miuyiWctV3) window.fetch = state.originals.fetch; } catch {}
        try {
            const x = state.originals.xhr;
            if (x) { x.P.open = x.rawOpen; x.P.send = x.rawSend; x.P.setRequestHeader = x.rawHeader; try { delete x.P.__miuyiWctV3; } catch {} }
        } catch {}
        try { if (state.originals.attachShadow && Element.prototype.attachShadow?.__miuyiWctV3) Element.prototype.attachShadow = state.originals.attachShadow; } catch {}
        try {
            const css = state.originals.cssHooks;
            if (css?.P) for (const [name, raw] of Object.entries(css.hooks || {})) css.P[name] = raw;
        } catch {}
        for (const name of ['pushState', 'replaceState']) try { if (state.originals[name]) history[name] = state.originals[name]; } catch {}
    }
    function hardStop(remote = false) {
        state.hardStopped = true; state.capturePaused = true; state.phase = 'stopped';
        if (TOP) updatePersistedSessionStatus('stopped');
        broadcastToFrames({ mark: MESSAGE_CONTROL, action: 'stop' });
        disconnectProbes();
        state.continuous.active = false; state.continuous.phase = '已随工具急停';
        stopPicker(); scheduleUI(true); toast('已急停并恢复页面API');
    }
    function restart(remote = false) {
        if (!state.hardStopped) return;
        state.hardStopped = false; state.capturePaused = false; state.overloaded = false; state.overloadReason = '';
        if (TOP) updatePersistedSessionStatus('active');
        setupProbes();
        if (!remote) broadcastToFrames({ mark: MESSAGE_CONTROL, action: 'resume' });
        toast('抓取探针已重新启动');
    }
    function toggleCapture() {
        if (state.hardStopped) return restart();
        state.capturePaused = !state.capturePaused;
        state.phase = state.capturePaused ? 'paused' : 'capturing'; scheduleUI(true);
        if (!state.capturePaused) scheduleContinuousProcessing();
        broadcastToFrames({ mark: MESSAGE_CONTROL, action: state.capturePaused ? 'pause' : 'resume' });
    }

    async function scanComponents(scopeRoot = null, scopeLabel = '全页面') {
        if (state.componentScan.running) { state.componentScan.cancel = true; return; }
        state.componentScan = { running: true, cancel: false, scanned: 0 };
        scheduleUI(true); toast(`开始扫描：${scopeLabel}`);
        const seen = new Map();
        const roots = scopeRoot ? [scopeRoot] : [document.documentElement, ...state.closedRoots];
        try {
            while (roots.length && !state.componentScan.cancel) {
                const root = roots.shift(); if (!root) continue;
                const doc = root.ownerDocument || document;
                const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
                let el = root instanceof Element ? walker.currentNode : walker.nextNode();
                let batch = 0;
                while (el && !state.componentScan.cancel) {
                    const current = el; el = walker.nextNode();
                    if (isScanExcluded(current)) continue;
                    state.componentScan.scanned++;
                    try {
                        if (current.shadowRoot) roots.push(current.shadowRoot);
                        if (current.tagName === 'IFRAME' && current.contentDocument?.documentElement) roots.push(current.contentDocument.documentElement);
                    } catch {}
                    const key = `${current.tagName.toLowerCase()}|${current.getAttribute('role') || ''}|${[...current.classList].sort().slice(0, 12).join('.')}`;
                    let item = seen.get(key);
                    if (!item && seen.size < config.limits.components) {
                        item = { signature: key, count: 0, sample: describeElement(current, true) };
                        seen.set(key, item);
                    }
                    if (item) item.count++;
                    if (++batch >= 100) { batch = 0; scheduleUI(); await idle(); }
                }
            }
            for (const item of [...seen.values()].sort((a, b) => b.count - a.count)) pushRecord('components', item);
            if (config.modules.css) await scanCss();
            toast(`${scopeLabel}扫描完成：${seen.size}组`);
        } catch (e) { pushRecord('errors', { source: 'component-scan', message: clip(e?.message || e, 3000) }); }
        state.componentScan.running = false; scheduleUI(true);
    }
    function scanSelectedArea() {
        const selected = state.selected;
        if (!(selected instanceof Element) || !selected.isConnected) { toast('请先使用“选择元素”锁定要扫描的区域'); return; }
        pushRecord('dom', { reason: '选中区域手动快照', element: describeElement(selected, true) });
        scanComponents(selected, '选中区域');
    }
    function idle() {
        return new Promise(resolve => window.requestIdleCallback ? requestIdleCallback(() => resolve(), { timeout: 80 }) : setTimeout(resolve, 0));
    }
    async function scanCss() {
        let count = 0;
        for (const sheet of [...document.styleSheets]) {
            if (count >= config.limits.css) break;
            const item = { href: safeUrl(sheet.href || ''), media: str(sheet.media?.mediaText || ''), disabled: !!sheet.disabled, accessible: false, rules: [] };
            try {
                const rules = [...sheet.cssRules]; item.accessible = true;
                for (const rule of rules) {
                    if (count++ >= config.limits.css) break;
                    item.rules.push(clip(rule.cssText, 5000));
                }
            } catch (e) { item.error = clip(e?.message || e, 1000); }
            pushRecord('css', item); await idle();
        }
    }

    function exportData() {
        const viewedSessionId = state.persistence.viewingSessionId || SESSION;
        const viewedSessionMeta = viewedSessionId === SESSION ? state.persistence.sessionMeta : state.persistence.sessionsCache.find(x => x.id === viewedSessionId);
        return {
            meta: { tool: 'LumaTrace 网页抓取与快速测试工作台', version: VERSION, session: viewedSessionId, archived: viewedSessionId !== SESSION, sessionMeta: viewedSessionMeta || null, exportedAt: iso(), page: safeUrl(location.href), title: document.title, mode: config.mode, frame: FRAME },
            config: { ...config, privacy: { ...config.privacy } }, counters: state.counters,
            continuousScan: {
                phase: state.continuous.phase, active: state.continuous.active, suspended: state.continuous.suspended,
                baselineDone: state.continuous.baselineDone, generation: state.continuous.generation,
                indexedComponents: state.continuous.index.size, pendingRoots: state.continuous.queue.length,
                counters: { ...state.continuous.counters }
            },
            diagnostics: diagnosticSnapshot(),
            records: activeRecordSource()
        };
    }
    function downloadJson() {
        const blob = new Blob([JSON.stringify(exportData(), null, 2)], { type: 'application/json;charset=utf-8' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `LumaTrace_${location.hostname}_${state.persistence.viewingSessionId || SESSION}.json`; a.style.display = 'none';
        document.documentElement.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
        toast('抓取结果已导出');
    }
    function clearRecords() {
        for (const type of RECORD_TYPES) state.records[type] = [];
        state.persistence.queue.clear();
        if (TOP && state.persistence.ready) deletePersistedSession(SESSION, true);
        state.unreadErrors = 0; state.overloaded = false; state.overloadReason = '';
        state.continuous.index.clear(); state.continuous.seenElements = new WeakSet(); state.continuous.elementKeys = new WeakMap();
        state.continuous.backgroundDirty = false;
        state.continuous.counters = { scanned: 0, newComponents: 0, duplicateHits: 0, ephemeral: 0, removed: 0, cssChanges: 0 };
        state.diagnostics.lastRecordAt = ''; state.diagnostics.lastErrorAt = '';
        state.diagnostics.trimmed = Object.fromEntries(RECORD_TYPES.map(type => [type, 0]));
        state.diagnostics.dropped = { domQueue: 0, continuousQueue: 0, persistenceLimit: 0, backgroundChanges: 0, excludedRoots: 0 };
        scheduleUI(true); toast('当前会话记录已清空');
    }

    function ensureUi() {
        if (!TOP || state.ui || !document.documentElement) return;
        const host = document.createElement('div'); host.id = UI_HOST_ID;
        const shadow = state.originals.attachShadow ? state.originals.attachShadow.call(host, { mode: 'closed' }) : host.attachShadow({ mode: 'closed' });
        const style = document.createElement('style'); style.textContent = UI_CSS;
        const shell = document.createElement('div'); shell.innerHTML = UI_HTML;
        shadow.append(style, shell); document.documentElement.appendChild(host);
        state.ui = { host, shadow, shell };
        bindUi(); applyUiSettings(); scheduleUI(true);
    }

    const UI_CSS = `
        :host{all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#263548}
        *{box-sizing:border-box}button,input,select,textarea{font:inherit}.hidden{display:none!important}
        #ball{position:fixed;pointer-events:auto;width:46px;height:46px;border-radius:50%;border:1px solid rgba(255,255,255,.75);background:linear-gradient(145deg,#2563eb,#1d4ed8);box-shadow:0 8px 25px rgba(15,23,42,.28);color:#fff;display:grid;place-items:center;cursor:pointer;user-select:none;transition:opacity .15s,transform .15s;touch-action:none}
        #ball:hover{transform:scale(1.05)}#ball .dot{position:absolute;right:2px;top:2px;width:11px;height:11px;border-radius:50%;border:2px solid #fff;background:#22c55e}#ball .badge{position:absolute;left:-4px;top:-6px;min-width:18px;height:18px;padding:0 4px;border-radius:10px;background:#dc2626;color:#fff;font:700 10px/18px sans-serif;text-align:center}
        #ball.paused .dot{background:#f59e0b}#ball.stopped{background:#64748b}#ball.stopped .dot{background:#94a3b8}#ball.overload{background:#b91c1c}#ball.picker{background:#7c3aed}#ball.scanning .dot{background:#a855f7;animation:pulse 1s infinite}@keyframes pulse{50%{transform:scale(1.45);opacity:.55}}
        .card,.drawer,.tester{position:fixed;pointer-events:auto;background:rgba(255,255,255,.985);border:1px solid rgba(37,99,235,.18);box-shadow:0 16px 45px rgba(15,23,42,.24);color:#263548}
        .card{width:304px;border-radius:14px;padding:12px}.title{display:flex;align-items:center;gap:8px}.title b{flex:1;color:#1d4ed8}.muted{font-size:11px;color:#64748b}.summary{margin:9px 0;padding:8px;border-radius:9px;background:#f8fafc;line-height:1.6;font-size:11px}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}.btn{border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:8px;padding:8px 7px;cursor:pointer;font-weight:650;font-size:11px}.btn:hover{background:#f1f5f9}.btn.primary{border:0;background:#2563eb;color:#fff}.btn.danger{border:0;background:#dc2626;color:#fff}.btn.warn{border:0;background:#f59e0b;color:#fff}.btn:disabled{opacity:.45;cursor:not-allowed}
        .drawer{right:12px;top:12px;bottom:12px;width:min(620px,calc(100vw - 24px));border-radius:15px;display:flex;flex-direction:column;overflow:hidden}.drawer-head{display:flex;align-items:center;gap:8px;padding:11px 12px;border-bottom:1px solid #e2e8f0}.drawer-head b{flex:1;color:#1d4ed8}.icon{border:0;background:#eef2ff;border-radius:7px;padding:6px 9px;cursor:pointer}.tabs{display:flex;gap:4px;padding:8px 10px;overflow:auto;border-bottom:1px solid #eef2f7}.tab{white-space:nowrap;border:0;background:#f1f5f9;border-radius:8px;padding:6px 9px;cursor:pointer;font-size:11px}.tab.active{background:#2563eb;color:#fff}.toolbar{display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid #eef2f7}.toolbar input,.toolbar select{min-width:0;border:1px solid #cbd5e1;border-radius:7px;padding:7px 8px}.toolbar input{flex:1}.workspace{display:grid;grid-template-columns:minmax(230px,42%) 1fr;min-height:0;flex:1}.list{overflow:auto;border-right:1px solid #eef2f7}.row{padding:8px 10px;border-bottom:1px solid #f1f5f9;cursor:pointer}.row:hover,.row.active{background:#eff6ff}.row-time{font-size:10px;color:#64748b}.row-main{font-size:11px;font-weight:650;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.detail{overflow:auto;padding:12px}.detail pre{white-space:pre-wrap;word-break:break-word;font:11px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;margin:0}.empty{padding:28px 14px;text-align:center;color:#94a3b8;font-size:12px}
        .tester{width:min(360px,calc(100vw - 20px));border-radius:14px;padding:11px}.tester-head{display:flex;gap:7px;align-items:center;margin-bottom:8px}.tester-head b{flex:1;color:#7c3aed}.field{margin:8px 0}.field label{display:block;font-size:10px;color:#64748b;margin-bottom:4px}.field input,.field textarea{width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:8px}.field textarea{height:86px;resize:vertical;font:11px/1.4 ui-monospace,Consolas,monospace}.tester-actions{display:flex;gap:5px;flex-wrap:wrap}.tester-info{padding:7px;border-radius:8px;background:#f8fafc;font-size:10px;line-height:1.55;max-height:115px;overflow:auto}
        .settings{padding:12px;overflow:auto}.setting-group{margin-bottom:12px;padding:10px;border:1px solid #e2e8f0;border-radius:10px}.setting-group h3{font-size:12px;margin:0 0 8px;color:#1e40af}.checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.checks label{font-size:11px}.setting-line{display:flex;align-items:center;gap:8px;margin:7px 0;font-size:11px}.setting-line span{flex:1}.setting-line input,.setting-line select{width:120px;border:1px solid #cbd5e1;border-radius:7px;padding:5px}.setting-area{width:100%;min-height:66px;resize:vertical;border:1px solid #cbd5e1;border-radius:7px;padding:7px;font:11px/1.5 ui-monospace,Consolas,monospace}
        #toast{position:fixed;left:50%;top:54px;transform:translateX(-50%);pointer-events:none;background:rgba(15,23,42,.94);color:#fff;border-radius:8px;padding:8px 12px;font-size:11px;max-width:70vw}
        @media(max-width:720px){.workspace{grid-template-columns:1fr}.list{border-right:0;max-height:42vh}.detail{border-top:1px solid #eef2f7}.drawer{right:6px;left:6px;top:6px;bottom:6px;width:auto}.checks{grid-template-columns:1fr}}
    `;

    const UI_HTML = `
        <div id="ball" title="LumaTrace 工作台"><span>捕</span><i class="dot"></i><em class="badge hidden">0</em></div>
        <section id="quick" class="card hidden">
            <div class="title"><b>LumaTrace 工作台 <small>V${VERSION}</small></b><button class="icon" data-close="quick">×</button></div>
            <div id="quickStatus" class="muted"></div><div id="quickSummary" class="summary"></div>
            <div class="grid">
                <button id="captureBtn" class="btn primary">暂停记录</button><button id="snapshotBtn" class="btn">立即快照</button>
                <button id="pickerBtn" class="btn">选择元素</button><button id="testerBtn" class="btn">快速测试</button>
                <button id="viewerBtn" class="btn">查看结果</button><button id="scanBtn" class="btn">立即补扫</button>
                <button id="continuousBtn" class="btn primary">持续扫描：开</button><button id="snapshotBtn2" class="btn">捕获当前浮层</button>
                <button id="scopeScanBtn" class="btn">扫描选中区域</button><button id="diagnosticsBtn" class="btn">抓取诊断</button>
                <button id="settingsBtn" class="btn">精细设置</button><button id="stopBtn" class="btn danger">急停工具</button>
            </div>
        </section>
        <section id="drawer" class="drawer hidden">
            <header class="drawer-head"><b id="drawerTitle">抓取结果工作台</b><button id="displayPauseBtn" class="icon">暂停刷新</button><button id="exportBtn" class="icon">导出</button><button class="icon" data-close="drawer">×</button></header>
            <div id="resultView"><nav id="tabs" class="tabs"></nav><div class="toolbar"><input id="searchInput" placeholder="搜索结果"><select id="frameFilter"><option value="">所有页面框架</option></select><button id="chainFilterBtn" class="icon hidden">退出操作链</button><button id="currentSessionBtn" class="icon hidden">返回当前会话</button><button id="clearBtn" class="icon">清空</button></div><main class="workspace"><div id="recordList" class="list"></div><div id="recordDetail" class="detail"><div class="empty">选择一条记录查看详情</div></div></main></div>
            <div id="settingsView" class="settings hidden"></div>
        </section>
        <section id="tester" class="tester hidden">
            <div class="tester-head"><b>快速测试台</b><button id="repickBtn" class="icon">重新选择</button><button class="icon" data-close="tester">×</button></div>
            <div id="selectedInfo" class="tester-info">尚未选择页面元素</div>
            <div class="field"><label>CSS选择器</label><input id="selectorInput" placeholder="输入或拾取选择器"></div>
            <div class="tester-actions"><button id="selectorTestBtn" class="btn">测试并高亮</button><button id="scrollBtn" class="btn">滚动定位</button><button id="clickBtn" class="btn">单击</button><button id="focusBtn" class="btn">聚焦</button></div>
            <div class="field"><label>输入内容（密码框不会记录）</label><input id="inputValue" placeholder="输入测试文字"></div>
            <div class="tester-actions"><button id="inputBtn" class="btn">写入并触发Input</button><button id="changeBtn" class="btn">触发Change</button></div>
            <div class="field"><label>临时CSS</label><textarea id="cssInput" placeholder="color: red;\nbackground: #fff;"></textarea></div>
            <div class="tester-actions"><button id="applyCssBtn" class="btn primary">应用CSS</button><button id="resetCssBtn" class="btn">恢复CSS</button><button id="copySelectorBtn" class="btn">复制选择器</button></div>
        </section>
        <div id="toast" class="hidden"></div>
    `;

    function q(id) { return state.ui?.shadow.getElementById(id); }
    function bindUi() {
        installUiInteractionShield();
        const ball = q('ball');
        const isolatedBall = installIsolatedBall();
        if (!isolatedBall) {
            ball.addEventListener('pointerdown', startBallDrag);
            ball.addEventListener('click', e => { if (state.drag?.moved) return; togglePanel('quick'); e.stopPropagation(); });
        }
        state.ui.shadow.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closePanel(b.dataset.close)));
        q('captureBtn').onclick = toggleCapture;
        q('snapshotBtn').onclick = () => { pushRecord('dom', { reason: '手动页面快照', element: describeElement(document.activeElement, true), page: { title: document.title, url: safeUrl(location.href) } }); toast('已记录页面快照'); };
        q('pickerBtn').onclick = startPicker;
        q('testerBtn').onclick = () => { openPanel('tester'); if (!state.selected) startPicker(); };
        q('viewerBtn').onclick = () => openDrawer(false);
        q('scanBtn').onclick = () => { continuousRescan('手动立即补扫', true); toast('已开始补扫当前页面'); };
        q('continuousBtn').onclick = toggleContinuousScan;
        q('snapshotBtn2').onclick = () => { captureEphemeralSubtree(document.documentElement, '手动捕获当前浮层', true); toast('已优先捕获当前可识别浮层'); };
        q('scopeScanBtn').onclick = scanSelectedArea;
        q('diagnosticsBtn').onclick = () => { openDrawer(false); activeTab = 'diagnostics'; scheduleList(true); };
        q('settingsBtn').onclick = () => openDrawer(true);
        q('stopBtn').onclick = hardStop;
        q('displayPauseBtn').onclick = () => { state.displayPaused = !state.displayPaused; scheduleUI(true); };
        q('exportBtn').onclick = downloadJson;
        q('clearBtn').onclick = () => { if (confirm('清空当前会话内的全部抓取记录？')) clearRecords(); };
        q('chainFilterBtn').onclick = () => { chainFilter = ''; q('chainFilterBtn').classList.add('hidden'); state.displayPaused = false; scheduleList(true); };
        q('currentSessionBtn').onclick = returnToCurrentSession;
        q('searchInput').oninput = () => scheduleList(true);
        q('frameFilter').onchange = () => scheduleList(true);
        q('selectorTestBtn').onclick = testSelector;
        q('repickBtn').onclick = startPicker;
        q('scrollBtn').onclick = () => state.selected?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        q('clickBtn').onclick = () => { if (state.selected && confirm('确认对选中元素执行一次单击？')) state.selected.click(); };
        q('focusBtn').onclick = () => state.selected?.focus?.();
        q('inputBtn').onclick = () => setSelectedValue(false);
        q('changeBtn').onclick = () => setSelectedValue(true);
        q('applyCssBtn').onclick = applyTestCss;
        q('resetCssBtn').onclick = resetTestCss;
        q('copySelectorBtn').onclick = async () => { try { await navigator.clipboard.writeText(q('selectorInput').value); toast('选择器已复制'); } catch { toast('复制失败'); } };
        bindPersistent(document, 'pointerdown', e => {
            if (state.panel === 'quick' && !isUiEvent(e)) closePanel('quick');
        }, true);
    }
    function installUiInteractionShield() {
        const root = state.ui?.shadow;
        if (!root || state.ui.interactionShieldInstalled) return;
        state.ui.interactionShieldInstalled = true;

        // Shadow DOM 只能隔离样式，事件仍会继续冒泡到网站的 document。
        // 在工具内部完成按钮处理后阻断冒泡，避免网站把它当成“点击组件外部”。
        const stopTypes = [
            'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick',
            'contextmenu', 'touchstart', 'touchend', 'wheel', 'dragstart'
        ];
        for (const type of stopTypes) {
            root.addEventListener(type, event => {
                const originalTarget = event.composedPath?.()[0] || event.target;
                const tag = str(originalTarget?.tagName).toLowerCase();
                const editable = tag === 'input' || tag === 'textarea' || tag === 'select' || originalTarget?.isContentEditable;

                // 点击普通工具按钮时不夺走网页当前焦点，保护依赖 focusout/blur 的编辑器和浮层。
                if (!editable && type === 'mousedown') event.preventDefault();
                event.stopPropagation();
            }, false);
        }
    }
    function installIsolatedBall() {
        const ui = state.ui, ball = q('ball');
        if (!ui || !ball || ui.ballShield) return !!ui?.ballShield;
        try {
            const frame = document.createElement('iframe');
            frame.title = 'LumaTrace 悬浮球隔离层'; frame.tabIndex = -1;
            frame.setAttribute('aria-label', '打开 LumaTrace 工作台');
            frame.style.cssText = 'position:fixed;border:0;margin:0;padding:0;background:transparent;color-scheme:normal;pointer-events:auto;z-index:20;overflow:hidden;';
            ui.shadow.appendChild(frame);
            const doc = frame.contentDocument, win = frame.contentWindow;
            if (!doc || !win) { frame.remove(); state.diagnostics.ballIsolation = 'fallback'; return false; }
            doc.documentElement.style.cssText = 'margin:0;width:100%;height:100%;background:transparent;overflow:hidden;cursor:pointer;';
            if (doc.body) doc.body.style.cssText = 'margin:0;width:100%;height:100%;background:transparent;overflow:hidden;cursor:pointer;';
            const down = event => {
                event.preventDefault(); event.stopPropagation();
                const surface = event.target?.setPointerCapture ? event.target : doc.documentElement;
                startBallDrag(event, surface, () => togglePanel('quick'));
            };
            win.addEventListener('pointerdown', down, true);
            win.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); }, true);
            win.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); }, true);
            ui.ballShield = frame;
            ball.style.pointerEvents = 'none';
            state.diagnostics.ballIsolation = 'active';
            syncBallShield();
            return true;
        } catch { state.diagnostics.ballIsolation = 'fallback'; return false; }
    }
    function syncBallShield() {
        const ball = q('ball'), frame = state.ui?.ballShield;
        if (!ball || !frame) return;
        const rect = ball.getBoundingClientRect();
        frame.style.left = `${Math.round(rect.left)}px`; frame.style.top = `${Math.round(rect.top)}px`;
        frame.style.width = `${Math.round(rect.width)}px`; frame.style.height = `${Math.round(rect.height)}px`;
    }
    function applyUiSettings() {
        if (!state.ui) return;
        const ball = q('ball');
        ball.style.width = ball.style.height = `${Math.max(36, Math.min(64, Number(config.ballSize) || 46))}px`;
        ball.style.opacity = String(Math.max(.45, Math.min(1, Number(config.opacity) || .96)));
        ball.style.right = `${Math.max(0, Number(config.position.right) || 0)}px`;
        ball.style.top = `${Math.max(0, Number(config.position.top) || 0)}px`;
        requestAnimationFrame(syncBallShield);
    }
    function startBallDrag(e, surface = q('ball'), onTap = null) {
        if (e.button !== 0) return;
        const ball = q('ball'), r = ball.getBoundingClientRect();
        const pointerX = Number.isFinite(e.screenX) ? e.screenX : e.clientX;
        const pointerY = Number.isFinite(e.screenY) ? e.screenY : e.clientY;
        state.drag = { id: e.pointerId, sx: pointerX, sy: pointerY, left: r.left, top: r.top, moved: false };
        surface?.setPointerCapture?.(e.pointerId);
        const move = ev => {
            if (!state.drag || ev.pointerId !== state.drag.id) return;
            const currentX = Number.isFinite(ev.screenX) ? ev.screenX : ev.clientX;
            const currentY = Number.isFinite(ev.screenY) ? ev.screenY : ev.clientY;
            const dx = currentX - state.drag.sx, dy = currentY - state.drag.sy;
            if (Math.abs(dx) + Math.abs(dy) > 4) state.drag.moved = true;
            const left = Math.max(0, Math.min(innerWidth - ball.offsetWidth, state.drag.left + dx));
            const top = Math.max(0, Math.min(innerHeight - ball.offsetHeight, state.drag.top + dy));
            ball.style.left = `${left}px`; ball.style.right = 'auto'; ball.style.top = `${top}px`; syncBallShield(); positionFloatingPanels();
        };
        const up = ev => {
            if (!state.drag || ev.pointerId !== state.drag.id) return;
            surface?.removeEventListener?.('pointermove', move); surface?.removeEventListener?.('pointerup', up); surface?.removeEventListener?.('pointercancel', up);
            const wasMoved = state.drag.moved;
            const r2 = ball.getBoundingClientRect(); const snapLeft = r2.left + r2.width / 2 < innerWidth / 2;
            if (snapLeft) { ball.style.left = '8px'; ball.style.right = 'auto'; config.position.right = innerWidth - 8 - r2.width; }
            else { ball.style.right = '8px'; ball.style.left = 'auto'; config.position.right = 8; }
            config.position.top = Math.round(Math.max(0, Math.min(innerHeight - r2.height, r2.top))); saveConfig(); syncBallShield(); positionFloatingPanels();
            if (!wasMoved && ev.type === 'pointerup') onTap?.();
            setTimeout(() => { if (state.drag) state.drag.moved = false; }, 0);
        };
        surface?.addEventListener?.('pointermove', move); surface?.addEventListener?.('pointerup', up); surface?.addEventListener?.('pointercancel', up);
    }
    function positionFloatingPanels() {
        if (!state.ui) return;
        const ball = q('ball'), r = ball.getBoundingClientRect();
        for (const id of ['quick', 'tester']) {
            const el = q(id); if (!el || el.classList.contains('hidden')) continue;
            const width = el.offsetWidth || (id === 'quick' ? 304 : 360);
            const left = r.left + r.width / 2 < innerWidth / 2 ? r.right + 8 : r.left - width - 8;
            el.style.left = `${Math.max(6, Math.min(innerWidth - width - 6, left))}px`;
            el.style.top = `${Math.max(6, Math.min(innerHeight - (el.offsetHeight || 300) - 6, r.top))}px`;
        }
    }
    function openPanel(name) {
        if (!state.ui) return;
        if (name === 'quick') { q('quick').classList.remove('hidden'); state.panel = 'quick'; }
        if (name === 'tester') { q('tester').classList.remove('hidden'); q('quick').classList.add('hidden'); state.panel = 'tester'; }
        positionFloatingPanels(); resetAutoCollapse();
    }
    function closePanel(name) {
        q(name)?.classList.add('hidden');
        if (name === 'drawer') state.unreadErrors = 0;
        if (state.panel === name) state.panel = 'none';
        scheduleUI(true);
    }
    function togglePanel(name) { q(name)?.classList.contains('hidden') ? openPanel(name) : closePanel(name); }
    function openDrawer(settings) {
        q('drawer').classList.remove('hidden'); q('quick').classList.add('hidden'); q('tester').classList.add('hidden'); state.panel = 'drawer';
        q('resultView').classList.toggle('hidden', !!settings); q('settingsView').classList.toggle('hidden', !settings);
        q('drawerTitle').textContent = settings ? '精细化抓取设置' : '抓取结果工作台';
        q('displayPauseBtn').classList.toggle('hidden', !!settings); q('exportBtn').classList.toggle('hidden', !!settings);
        if (settings) renderSettings(); else { buildTabs(); scheduleList(true); }
    }
    function resetAutoCollapse() {
        clearTimeout(state.autoCollapseTimer);
        const seconds = Number(config.autoCollapseSeconds) || 0;
        if (seconds > 0 && state.panel === 'quick') state.autoCollapseTimer = setTimeout(() => closePanel('quick'), seconds * 1000);
    }

    function statusText() {
        if (state.hardStopped) return '已急停';
        if (state.overloaded) return `性能保护：${state.overloadReason}`;
        if (state.capturePaused) return '记录已暂停（探针仍保留）';
        return `${modeName(config.mode)} · ${config.continuousScan.enabled ? state.continuous.phase : '基础抓取中'}`;
    }
    function modeName(mode) { return ({ safe: '安全模式', standard: '标准模式', complete: '完整模式', custom: '自定义模式' })[mode] || mode; }
    function scheduleUI(force = false) {
        if (!TOP || !state.ui) return;
        if (force) { clearTimeout(state.uiTimer); state.uiTimer = 0; updateUi(); return; }
        if (!state.uiTimer) state.uiTimer = setTimeout(() => { state.uiTimer = 0; updateUi(); }, 300);
    }
    function updateUi() {
        if (!state.ui) return;
        const scanning = config.continuousScan.enabled && (state.continuous.processing || /基线|补扫|巡检/.test(state.continuous.phase));
        const ball = q('ball'); ball.className = state.pickerActive ? 'picker' : state.hardStopped ? 'stopped' : state.overloaded ? 'overload' : state.capturePaused ? 'paused' : scanning ? 'scanning' : '';
        const badge = ball.querySelector('.badge'); badge.textContent = state.unreadErrors > 99 ? '99+' : state.unreadErrors; badge.classList.toggle('hidden', !state.unreadErrors);
        q('quickStatus').textContent = statusText();
        const cc = state.continuous.counters;
        q('quickSummary').innerHTML = `网络 <b>${state.records.network.length}</b> · DOM <b>${state.records.dom.length}</b> · 事件 <b>${state.records.events.length}</b><br>组件族 <b>${state.records.components.length}</b> · 瞬时组件 <b>${cc.ephemeral}</b> · 重复合并 <b>${cc.duplicateHits}</b><br>持续队列 <b>${state.continuous.queue.length}</b> · 异常 <b>${state.records.errors.length}</b>`;
        q('captureBtn').textContent = state.hardStopped ? '重新启动' : state.capturePaused ? '继续记录' : '暂停记录';
        q('captureBtn').className = `btn ${state.capturePaused || state.hardStopped ? 'primary' : 'warn'}`;
        q('stopBtn').disabled = state.hardStopped;
        q('scanBtn').textContent = state.continuous.processing ? `扫描中 ${state.continuous.counters.scanned}` : '立即补扫';
        q('scopeScanBtn').disabled = !(state.selected instanceof Element) || !state.selected.isConnected || state.componentScan.running;
        const diagnosticCount = diagnosticWarnings().length;
        q('diagnosticsBtn').textContent = diagnosticCount ? `抓取诊断（${diagnosticCount}）` : '抓取诊断';
        q('continuousBtn').textContent = `持续扫描：${config.continuousScan.enabled ? '开' : '关'}`;
        q('continuousBtn').className = `btn ${config.continuousScan.enabled ? 'primary' : ''}`;
        q('displayPauseBtn').textContent = state.displayPaused ? '继续刷新' : '暂停刷新';
        if (state.panel === 'drawer' && !state.displayPaused && !q('resultView').classList.contains('hidden')) scheduleList();
    }

    let activeTab = 'all'; let activeRecordId = ''; let chainFilter = ''; let activeDiagnosticSection = 'summary';
    function activeRecordSource() { return state.persistence.viewRecords || state.records; }
    function buildTabs() {
        const tabs = q('tabs');
        const source = activeRecordSource();
        const defs = [['all', '全部'], ['events', '事件'], ['dom', 'DOM'], ['network', '网络'], ['errors', '异常'], ['components', '组件'], ['css', 'CSS'], ['performance', '性能'], ['routes', '路由'], ['diagnostics', '诊断'], ['sessions', '会话']];
        tabs.innerHTML = defs.map(([id, label]) => {
            const count = id === 'all' ? totalRecords(source) : id === 'sessions' ? state.persistence.sessionsCache.length : id === 'diagnostics' ? diagnosticWarnings().length : source[id].length;
            return `<button class="tab ${activeTab === id ? 'active' : ''}" data-tab="${id}">${label} ${count}</button>`;
        }).join('');
        tabs.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { activeTab = b.dataset.tab; activeRecordId = ''; buildTabs(); scheduleList(true); });
        const frames = new Map();
        for (const type of RECORD_TYPES) for (const r of source[type]) frames.set(r.frameId, r.frameUrl || r.frameId);
        const select = q('frameFilter'), previous = select.value;
        select.innerHTML = '<option value="">所有页面框架</option>' + [...frames].map(([id, url]) => `<option value="${escapeHtml(id)}">${escapeHtml(id)} · ${escapeHtml(clip(url, 60))}</option>`).join('');
        select.value = previous;
    }
    function totalRecords(source = activeRecordSource()) { return RECORD_TYPES.reduce((n, x) => n + source[x].length, 0); }
    function allRecords(source = activeRecordSource()) { return RECORD_TYPES.flatMap(x => source[x]).sort((a, b) => str(b.time).localeCompare(str(a.time))); }
    function groupRecords(records) {
        const grouped = Object.fromEntries(RECORD_TYPES.map(type => [type, []]));
        for (const record of records || []) if (grouped[record.type]) grouped[record.type].push(record);
        for (const type of RECORD_TYPES) grouped[type].sort((a, b) => str(b.time).localeCompare(str(a.time)));
        return grouped;
    }
    function scheduleList(force = false) {
        if (state.displayPaused && !force) return;
        if (force) { clearTimeout(state.listTimer); state.listTimer = 0; renderList(); return; }
        if (!state.listTimer) state.listTimer = setTimeout(() => { state.listTimer = 0; renderList(); }, 450);
    }
    function renderList() {
        if (!state.ui || q('drawer').classList.contains('hidden') || q('resultView').classList.contains('hidden')) return;
        buildTabs();
        const archived = !!state.persistence.viewingSessionId;
        const specialTab = activeTab === 'sessions' || activeTab === 'diagnostics';
        q('currentSessionBtn').classList.toggle('hidden', !archived);
        q('chainFilterBtn').classList.toggle('hidden', !chainFilter || specialTab);
        q('chainFilterBtn').textContent = chainFilter ? `退出操作链 ${chainFilter.split('-').pop()}` : '退出操作链';
        q('clearBtn').classList.toggle('hidden', archived || specialTab);
        q('displayPauseBtn').classList.toggle('hidden', archived || specialTab);
        q('frameFilter').classList.toggle('hidden', specialTab);
        q('searchInput').classList.toggle('hidden', activeTab === 'diagnostics');
        q('searchInput').placeholder = activeTab === 'sessions' ? '搜索历史会话' : '搜索结果';
        if (activeTab === 'diagnostics') { renderDiagnostics(); return; }
        if (activeTab === 'sessions') { renderSessionsList(); return; }
        const term = q('searchInput').value.trim().toLowerCase(), frame = q('frameFilter').value;
        const source = activeRecordSource();
        let list = activeTab === 'all' ? allRecords(source) : [...source[activeTab]];
        if (chainFilter) list = list.filter(x => x.actionId === chainFilter || x.actionIds?.includes?.(chainFilter)).sort((a, b) => str(a.time).localeCompare(str(b.time)));
        if (frame) list = list.filter(x => x.frameId === frame);
        if (term) list = list.filter(x => recordSearchText(x).includes(term));
        const shown = list.slice(0, config.limits.renderRows);
        q('recordList').innerHTML = shown.length ? shown.map(r => { const actionId = recordActionId(r); return `<div class="row ${r.id === activeRecordId ? 'active' : ''}" data-id="${escapeHtml(r.id)}"><div class="row-time">${escapeHtml(new Date(r.time).toLocaleTimeString())} · ${escapeHtml(r.type)} · ${escapeHtml(r.frameId)}${actionId ? ` · 链${escapeHtml(actionId.split('-').pop())}` : ''}</div><div class="row-main">${escapeHtml(recordTitle(r))}</div></div>`; }).join('') + (list.length > shown.length ? `<div class="empty">已显示前${shown.length}条，请搜索或筛选以缩小范围</div>` : '') : `<div class="empty">${chainFilter ? '这条操作链在当前分类下没有记录' : '当前分类没有记录'}</div>`;
        q('recordList').querySelectorAll('[data-id]').forEach(row => row.onclick = () => showRecord(row.dataset.id));
    }
    function diagnosticWarnings() {
        const warnings = [];
        const dropped = state.diagnostics.dropped;
        const trimmedTotal = Object.values(state.diagnostics.trimmed).reduce((n, value) => n + value, 0);
        const droppedTotal = dropped.domQueue + dropped.continuousQueue + dropped.persistenceLimit;
        if (state.hardStopped) warnings.push('工具当前处于急停状态，页面探针已经恢复为网站原始 API。');
        else if (state.capturePaused) warnings.push('抓取记录当前已暂停。');
        if (state.overloaded) warnings.push(`性能保护已触发：${state.overloadReason || '未知原因'}`);
        if (!config.modules.network) warnings.push('网络请求探针未开启；需要时切换到标准模式或单独开启网络模块。');
        if (!config.modules.shadowClosed) warnings.push('关闭式 Shadow DOM 抓取未开启；已创建的 closed Shadow Root 无法事后补抓。');
        if (!config.continuousScan.enabled) warnings.push('智能持续扫描未开启，目前只保留基础事件与模块抓取。');
        if (state.persistence.failed) warnings.push('本网站的历史会话存储出现错误，尚未继续写入。');
        else if (config.persistence.enabled && !window.indexedDB) warnings.push('当前页面环境不支持 IndexedDB，历史会话无法持久保存。');
        if (state.persistence.sessionMeta?.truncated) warnings.push('当前会话已达到持久化记录上限，后续新记录只保留在内存限额内。');
        if (trimmedTotal) warnings.push(`内存记录达到分类上限，已有 ${trimmedTotal} 条旧记录被滚动移出。`);
        if (droppedTotal) warnings.push(`性能或容量控制累计跳过 ${droppedTotal} 次记录/扫描任务。`);
        if (state.diagnostics.ballIsolation === 'fallback') warnings.push('悬浮球独立事件层不可用，当前使用 Shadow DOM 事件隔离作为回退。');
        const invalidExclusions = invalidScanExcludeSelectors(config.continuousScan.excludeSelectors || '');
        if (invalidExclusions.length) warnings.push(`存在无效的扫描排除选择器：${clip(invalidExclusions[0], 120)}`);
        if (document.querySelectorAll('iframe').length) warnings.push('页面包含 iframe；跨域框架依赖 LumaTrace 在对应子框架中成功运行并通过消息桥回传。');
        return warnings;
    }
    function diagnosticSnapshot() {
        const remoteFrames = new Set();
        for (const type of RECORD_TYPES) for (const record of state.records[type]) if (record.remote && record.frameId) remoteFrames.add(record.frameId);
        const probeMap = {
            errors: state.installed.has('errors'), events: state.installed.has('events'), dom: state.installed.has('dom'),
            network: state.installed.has('network'), performance: state.installed.has('performance'), route: state.installed.has('route'),
            closedShadowHook: state.installed.has('shadow'), cssMutationHooks: state.installed.has('css-hooks'), continuousScheduler: state.continuous.active
        };
        const recordCounts = Object.fromEntries(RECORD_TYPES.map(type => [type, state.records[type].length]));
        return {
            summary: {
                tool: 'LumaTrace', version: VERSION, session: SESSION, page: safeUrl(location.href), title: document.title,
                readyState: document.readyState, capturePhase: state.phase, capturePaused: state.capturePaused,
                displayPaused: state.displayPaused, hardStopped: state.hardStopped, overloaded: state.overloaded,
                lastRecordAt: state.diagnostics.lastRecordAt || null, lastErrorAt: state.diagnostics.lastErrorAt || null,
                warnings: diagnosticWarnings()
            },
            environment: {
                topFrame: TOP, frameId: FRAME, iframeElements: document.querySelectorAll('iframe').length,
                reportingChildFrames: [...remoteFrames], shadowDOM: !!Element.prototype.attachShadow,
                mutationObserver: !!window.MutationObserver, fetch: typeof window.fetch === 'function',
                xhr: !!window.XMLHttpRequest, performanceObserver: !!window.PerformanceObserver,
                indexedDB: !!window.indexedDB, requestIdleCallback: typeof window.requestIdleCallback === 'function'
            },
            probes: { mode: config.mode, configuredModules: { ...config.modules }, activeProbes: probeMap, installedMarkers: [...state.installed].sort() },
            scan: {
                enabled: config.continuousScan.enabled, mode: config.continuousScan.mode, phase: state.continuous.phase,
                active: state.continuous.active, suspended: state.continuous.suspended, processing: state.continuous.processing,
                backgroundDirty: state.continuous.backgroundDirty, pauseWhenHidden: config.continuousScan.pauseWhenHidden,
                pendingRoots: state.continuous.queue.length, indexedComponents: state.continuous.index.size,
                exclusionSelectors: scanExcludeSelectors(), counters: { ...state.continuous.counters }
            },
            interaction: {
                floatingBallIsolation: state.diagnostics.ballIsolation, shadowInteractionShield: !!state.ui?.interactionShieldInstalled,
                pickerActive: state.pickerActive, selectedElement: describeElement(state.selected, false), activeActionId: activeActionId() || null,
                actionWindowMs: actionWindowMs()
            },
            storage: {
                enabled: config.persistence.enabled, ready: state.persistence.ready, failed: state.persistence.failed,
                queuedWrites: state.persistence.queue.size, viewingSessionId: state.persistence.viewingSessionId || null,
                currentSession: state.persistence.sessionMeta ? { ...state.persistence.sessionMeta } : null,
                limits: { maxSessions: config.persistence.maxSessions, retentionDays: config.persistence.retentionDays, maxRecordsPerSession: config.persistence.maxRecordsPerSession }
            },
            records: { counts: recordCounts, trimmed: { ...state.diagnostics.trimmed }, dropped: { ...state.diagnostics.dropped }, limits: { ...config.limits } }
        };
    }
    function diagnosticSections(snapshot) {
        return {
            summary: ['运行概要', snapshot.summary], environment: ['环境与框架', snapshot.environment], probes: ['抓取探针', snapshot.probes],
            scan: ['持续扫描', snapshot.scan], interaction: ['交互隔离', snapshot.interaction], storage: ['会话存储', snapshot.storage], records: ['容量与丢弃', snapshot.records]
        };
    }
    function renderDiagnostics() {
        const snapshot = diagnosticSnapshot(), sections = diagnosticSections(snapshot);
        q('recordList').innerHTML = Object.entries(sections).map(([key, [label, data]]) => {
            const issue = key === 'summary' ? snapshot.summary.warnings.length : key === 'records' ? Object.values(data.dropped).reduce((n, v) => n + v, 0) + Object.values(data.trimmed).reduce((n, v) => n + v, 0) : 0;
            const status = !issue ? '状态已读取' : key === 'records' ? `${issue} 次容量/策略控制` : `${issue} 项需注意`;
            return `<div class="row" data-diagnostic="${key}"><div class="row-time">${status}</div><div class="row-main">${escapeHtml(label)}</div></div>`;
        }).join('');
        q('recordList').querySelectorAll('[data-diagnostic]').forEach(row => row.onclick = () => showDiagnosticSection(row.dataset.diagnostic));
        showDiagnosticSection(activeDiagnosticSection);
    }
    function showDiagnosticSection(key) {
        activeDiagnosticSection = key;
        const snapshot = diagnosticSnapshot(), entry = diagnosticSections(snapshot)[key] || diagnosticSections(snapshot).summary;
        q('recordDetail').innerHTML = `<div class="tester-actions" style="margin-bottom:9px"><button id="copyDiagnostics" class="btn primary">复制完整诊断</button><button id="refreshDiagnostics" class="btn">重新检测</button></div><pre>${escapeHtml(JSON.stringify({ section: entry[0], data: entry[1] }, null, 2))}</pre>`;
        q('copyDiagnostics').onclick = async () => { try { await navigator.clipboard.writeText(JSON.stringify(diagnosticSnapshot(), null, 2)); toast('完整诊断信息已复制'); } catch { toast('复制失败'); } };
        q('refreshDiagnostics').onclick = () => scheduleList(true);
    }
    async function renderSessionsList() {
        q('recordList').innerHTML = '<div class="empty">正在读取本网站的历史会话…</div>';
        if (!config.persistence.enabled) {
            q('recordList').innerHTML = '<div class="empty">会话保存已关闭，可在精细设置中开启</div>';
            q('recordDetail').innerHTML = '<div class="empty">开启后，刷新或关闭页面后仍可查看历史抓取结果</div>';
            return;
        }
        if (!window.indexedDB) {
            q('recordList').innerHTML = '<div class="empty">当前浏览器或页面环境不支持 IndexedDB，会话无法持久保存</div>';
            return;
        }
        if (!state.persistence.ready) await initPersistence();
        if (state.persistence.failed) {
            q('recordList').innerHTML = '<div class="empty">本网站的会话存储初始化失败，可在设置中重新保存以重试</div>';
            return;
        }
        if (state.persistence.queue.size) await flushPersistQueue();
        const sessions = await listPersistedSessions();
        if (activeTab !== 'sessions') return;
        state.persistence.sessionsCache = sessions; buildTabs();
        const term = q('searchInput').value.trim().toLowerCase();
        const shown = sessions.filter(session => !term || recordSearchText(session).includes(term));
        q('recordList').innerHTML = shown.length ? shown.map(session => {
            const current = session.id === SESSION;
            return `<div class="row" data-session="${escapeHtml(session.id)}"><div class="row-time">${escapeHtml(new Date(session.startedAt).toLocaleString())} · ${escapeHtml(session.status || 'unknown')}${current ? ' · 当前' : ''}</div><div class="row-main">${escapeHtml(session.title || session.host || '未命名会话')} · ${Number(session.recordCount || 0)}条${session.truncated ? '（已截断）' : ''}</div></div>`;
        }).join('') : '<div class="empty">没有符合条件的历史会话</div>';
        q('recordList').querySelectorAll('[data-session]').forEach(row => row.onclick = () => showSessionMeta(row.dataset.session));
    }
    function showSessionMeta(sessionId) {
        const session = state.persistence.sessionsCache.find(x => x.id === sessionId); if (!session) return;
        const current = session.id === SESSION;
        q('recordDetail').innerHTML = `<div class="tester-actions" style="margin-bottom:9px"><button id="loadSession" class="btn primary">${current ? '查看当前实时会话' : '载入此会话'}</button><button id="deleteSession" class="btn danger" ${current ? 'disabled' : ''}>删除此会话</button><button id="refreshSessions" class="btn">刷新列表</button></div><pre>${escapeHtml(JSON.stringify(session, null, 2))}</pre>`;
        q('loadSession').onclick = () => current ? returnToCurrentSession() : loadArchivedSession(session.id);
        q('deleteSession').onclick = () => { if (!current) removeArchivedSession(session.id); };
        q('refreshSessions').onclick = renderSessionsList;
    }
    async function loadArchivedSession(sessionId) {
        q('recordDetail').innerHTML = '<div class="empty">正在载入会话记录…</div>';
        const records = await readPersistedSession(sessionId);
        state.persistence.viewRecords = groupRecords(records);
        state.persistence.viewingSessionId = sessionId;
        activeTab = 'all'; activeRecordId = ''; chainFilter = ''; state.displayPaused = true;
        q('recordDetail').innerHTML = `<div class="empty">已载入 ${records.length} 条历史记录，请从左侧选择</div>`;
        scheduleUI(true); scheduleList(true); toast(`已载入历史会话：${records.length}条`);
    }
    function returnToCurrentSession() {
        state.persistence.viewRecords = null; state.persistence.viewingSessionId = '';
        activeTab = 'all'; activeRecordId = ''; chainFilter = ''; state.displayPaused = false;
        if (state.ui) q('recordDetail').innerHTML = '<div class="empty">已返回当前实时会话</div>';
        scheduleUI(true); scheduleList(true);
    }
    async function removeArchivedSession(sessionId) {
        if (!sessionId || sessionId === SESSION || !confirm('删除这个历史会话及其全部记录？此操作无法撤销。')) return;
        await deletePersistedSession(sessionId);
        if (state.persistence.viewingSessionId === sessionId) returnToCurrentSession();
        else { await renderSessionsList(); q('recordDetail').innerHTML = '<div class="empty">历史会话已删除</div>'; }
        toast('历史会话已删除');
    }
    function recordSearchText(r) { try { return JSON.stringify(r).toLowerCase(); } catch { return ''; } }
    function recordActionId(r) { return r?.actionId || (Array.isArray(r?.actionIds) ? r.actionIds[r.actionIds.length - 1] : '') || ''; }
    function recordTitle(r) {
        if (r.type === 'events') return `${r.event || '事件'} · ${r.target?.selector || r.target?.tag || ''}`;
        if (r.type === 'dom') return `${r.reason || 'DOM变化'} · ${r.element?.selector || r.element?.tag || ''}`;
        if (r.type === 'network') return `${r.method || ''} ${r.status ?? ''} · ${r.url || ''}`;
        if (r.type === 'errors') return `${r.source || '异常'} · ${r.message || ''}`;
        if (r.type === 'components') return `${r.ephemeral ? '瞬时组件' : '组件'} · ${r.hits || r.count || 0}次 · ${r.status || ''} · ${r.signature || ''}`;
        if (r.type === 'css') return `样式表 · ${r.href || 'inline'}`;
        if (r.type === 'performance') return `${r.metric || '性能'} · ${r.duration || 0}ms`;
        if (r.type === 'routes') return `路由变化 · ${r.to || ''}`;
        return r.type;
    }
    function findRecord(id) { const source = activeRecordSource(); for (const type of RECORD_TYPES) { const r = source[type].find(x => x.id === id); if (r) return r; } return null; }
    function showRecord(id) {
        activeRecordId = id; const r = findRecord(id); if (!r) return;
        const actionId = recordActionId(r);
        state.displayPaused = true;
        q('recordDetail').innerHTML = `<div class="tester-actions" style="margin-bottom:9px"><button id="locateRecord" class="btn">页面定位</button><button id="sendTester" class="btn">发送到测试台</button>${actionId ? '<button id="showActionChain" class="btn primary">查看完整操作链</button>' : ''}<button id="copyRecord" class="btn">复制本条</button></div><pre>${escapeHtml(JSON.stringify(r, null, 2))}</pre>`;
        q('locateRecord').onclick = () => locateFromRecord(r);
        q('sendTester').onclick = () => { if (selectFromRecord(r)) openPanel('tester'); else toast('该记录对应元素已不存在'); };
        if (actionId) q('showActionChain').onclick = () => { chainFilter = actionId; activeTab = 'all'; q('searchInput').value = ''; scheduleList(true); };
        q('copyRecord').onclick = async () => { try { await navigator.clipboard.writeText(JSON.stringify(r, null, 2)); toast('本条记录已复制'); } catch { toast('复制失败'); } };
        q('displayPauseBtn').textContent = '继续刷新'; renderList();
    }
    function selectorFromRecord(r) { return r.target?.selector || r.element?.selector || r.sample?.selector || ''; }
    function selectFromRecord(r) {
        const sel = selectorFromRecord(r); if (!sel) return false;
        try { const el = document.querySelector(sel); if (!el) return false; selectElement(el); return true; } catch { return false; }
    }
    function locateFromRecord(r) { if (selectFromRecord(r)) { highlightSelected(); state.selected.scrollIntoView({ behavior: 'smooth', block: 'center' }); } else toast('元素已经消失或选择器不可用'); }
    function escapeHtml(v) { return str(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

    function renderSettings() {
        const moduleLabels = { errors: '异常', events: '页面事件', dom: 'DOM变化', network: '网络请求', performance: '性能', route: 'SPA路由', components: '组件扫描', css: 'CSS正文', shadowClosed: '关闭式Shadow DOM' };
        q('settingsView').innerHTML = `
            <div class="setting-group"><h3>运行模式</h3><div class="setting-line"><span>当前模式</span><select id="modeSetting"><option value="safe">安全模式</option><option value="standard">标准模式</option><option value="complete">完整模式</option><option value="custom">自定义模式</option></select></div><div class="muted">切换预设后应用模块开关；关闭式Shadow DOM需要刷新页面才能完整捕获。</div></div>
            <div class="setting-group"><h3>抓取模块</h3><div class="checks">${Object.entries(moduleLabels).map(([id, label]) => `<label><input type="checkbox" data-module="${id}" ${config.modules[id] ? 'checked' : ''}> ${label}</label>`).join('')}</div></div>
            <div class="setting-group"><h3>智能持续扫描</h3>
                <div class="checks">
                    <label><input id="continuousEnabledSetting" type="checkbox" ${config.continuousScan.enabled ? 'checked' : ''}> 自动持续扫描</label>
                    <label><input id="ephemeralSetting" type="checkbox" ${config.continuousScan.ephemeralPriority ? 'checked' : ''}> 瞬时浮层优先快照</label>
                    <label><input id="dedupeSetting" type="checkbox" ${config.continuousScan.dedupe ? 'checked' : ''}> 组件指纹去重</label>
                    <label><input id="removedSetting" type="checkbox" ${config.continuousScan.captureRemoved ? 'checked' : ''}> 记录组件移除</label>
                    <label><input id="routeRescanSetting" type="checkbox" ${config.continuousScan.routeRescan ? 'checked' : ''}> 路由切换自动补扫</label>
                    <label><input id="cssChangesSetting" type="checkbox" ${config.continuousScan.cssChanges ? 'checked' : ''}> 持续记录CSSOM变化</label>
                    <label><input id="pauseHiddenSetting" type="checkbox" ${config.continuousScan.pauseWhenHidden ? 'checked' : ''}> 页面后台时自动降载</label>
                </div>
                <div class="setting-line"><span>扫描策略</span><select id="continuousModeSetting"><option value="smart">智能增量</option><option value="patrol">增量＋定时巡检</option><option value="full">完整巡检</option></select></div>
                <div class="setting-line"><span>初始基线延迟/毫秒</span><input id="baselineDelaySetting" type="number" min="200" max="15000" value="${config.continuousScan.baselineDelay}"></div>
                <div class="setting-line"><span>每轮空闲预算/毫秒</span><input id="idleBudgetSetting" type="number" min="2" max="16" value="${config.continuousScan.idleBudgetMs}"></div>
                <div class="setting-line"><span>巡检间隔/秒</span><input id="patrolIntervalSetting" type="number" min="10" max="600" value="${config.continuousScan.patrolInterval}"></div>
                <div class="field"><label>持续扫描排除选择器（每行一个）</label><textarea id="excludeSelectorsSetting" class="setting-area" placeholder=".广告区域\n[data-no-capture]">${escapeHtml(config.continuousScan.excludeSelectors || '')}</textarea></div>
                <div class="muted">推荐使用“智能增量”。完整巡检只适合短时间深度测试。</div>
            </div>
            <div class="setting-group"><h3>本地会话与操作链</h3>
                <div class="checks"><label><input id="persistenceEnabledSetting" type="checkbox" ${config.persistence.enabled ? 'checked' : ''}> 自动保存本网站会话</label></div>
                <div class="setting-line"><span>最多保留会话数</span><input id="maxSessionsSetting" type="number" min="1" max="50" value="${config.persistence.maxSessions}"></div>
                <div class="setting-line"><span>最长保留天数</span><input id="retentionDaysSetting" type="number" min="1" max="365" value="${config.persistence.retentionDays}"></div>
                <div class="setting-line"><span>每个会话最大记录数</span><input id="maxSessionRecordsSetting" type="number" min="500" max="50000" step="500" value="${config.persistence.maxRecordsPerSession}"></div>
                <div class="setting-line"><span>操作链关联窗口/毫秒</span><input id="actionWindowSetting" type="number" min="1000" max="15000" step="500" value="${config.persistence.actionWindowMs}"></div>
                <div class="muted">数据只保存在当前网站源的浏览器 IndexedDB 中。操作链会自动关联一次交互及随后时间窗口内的 DOM、网络、异常和组件变化。</div>
            </div>
            <div class="setting-group"><h3>隐私与正文</h3><div class="checks"><label><input id="requestBodySetting" type="checkbox" ${config.privacy.captureRequestBody ? 'checked' : ''}> 记录请求体</label><label><input id="responseBodySetting" type="checkbox" ${config.privacy.captureResponseBody ? 'checked' : ''}> 记录响应体</label><label><input id="maskUrlSetting" type="checkbox" ${config.privacy.maskUrlValues ? 'checked' : ''}> 隐藏全部URL参数值</label></div></div>
            <div class="setting-group"><h3>悬浮球</h3><div class="setting-line"><span>大小</span><input id="ballSizeSetting" type="number" min="36" max="64" value="${config.ballSize}"></div><div class="setting-line"><span>透明度</span><input id="opacitySetting" type="number" min="0.45" max="1" step="0.05" value="${config.opacity}"></div><div class="setting-line"><span>快捷卡片自动收起/秒，0为关闭</span><input id="collapseSetting" type="number" min="0" max="120" value="${config.autoCollapseSeconds}"></div></div>
            <div class="setting-group"><h3>性能上限</h3><div class="setting-line"><span>每秒Mutation警戒值</span><input id="mutationSetting" type="number" min="100" max="10000" value="${config.limits.mutationsPerSecond}"></div><div class="setting-line"><span>响应正文最大字符</span><input id="responseLimitSetting" type="number" min="1000" max="200000" value="${config.limits.response}"></div><div class="setting-line"><span>结果列表最大渲染行</span><input id="renderRowsSetting" type="number" min="50" max="500" value="${config.limits.renderRows}"></div></div>
            <div class="tester-actions"><button id="saveSettings" class="btn primary">保存并应用</button><button id="resetSettings" class="btn">恢复当前网站默认</button></div>`;
        q('modeSetting').value = config.mode;
        q('continuousModeSetting').value = config.continuousScan.mode;
        q('modeSetting').onchange = e => {
            if (e.target.value !== 'custom') {
                config.modules = { ...config.modules, ...MODE_PRESETS[e.target.value] };
                q('settingsView').querySelectorAll('[data-module]').forEach(x => x.checked = !!config.modules[x.dataset.module]);
            }
        };
        q('settingsView').querySelectorAll('[data-module]').forEach(x => x.onchange = () => { q('modeSetting').value = 'custom'; });
        q('saveSettings').onclick = saveSettingsFromUi;
        q('resetSettings').onclick = () => { if (confirm('恢复当前网站的默认设置？')) { config = cloneDefaults(); saveConfig(); applyUiSettings(); reconfigureProbes(); initPersistence(); renderSettings(); toast('已恢复默认设置'); } };
    }
    function saveSettingsFromUi() {
        const excludeSelectorsValue = q('excludeSelectorsSetting').value.trim();
        const invalidSelectors = invalidScanExcludeSelectors(excludeSelectorsValue);
        if (invalidSelectors.length) { q('excludeSelectorsSetting').focus(); toast(`排除选择器无效：${clip(invalidSelectors[0], 80)}`); return; }
        const persistenceWasEnabled = config.persistence.enabled;
        const persistenceNextEnabled = q('persistenceEnabledSetting').checked;
        if (persistenceWasEnabled && !persistenceNextEnabled) flushPersistQueue();
        config.mode = q('modeSetting').value;
        q('settingsView').querySelectorAll('[data-module]').forEach(x => { config.modules[x.dataset.module] = x.checked; });
        config.privacy.captureRequestBody = q('requestBodySetting').checked;
        config.privacy.captureResponseBody = q('responseBodySetting').checked;
        config.privacy.maskUrlValues = q('maskUrlSetting').checked;
        config.continuousScan.enabled = q('continuousEnabledSetting').checked;
        config.continuousScan.mode = q('continuousModeSetting').value;
        config.continuousScan.ephemeralPriority = q('ephemeralSetting').checked;
        config.continuousScan.dedupe = q('dedupeSetting').checked;
        config.continuousScan.captureRemoved = q('removedSetting').checked;
        config.continuousScan.routeRescan = q('routeRescanSetting').checked;
        config.continuousScan.cssChanges = q('cssChangesSetting').checked;
        config.continuousScan.pauseWhenHidden = q('pauseHiddenSetting').checked;
        config.continuousScan.excludeSelectors = excludeSelectorsValue;
        state.scanExclusionCache.source = '';
        config.continuousScan.baselineDelay = Number(q('baselineDelaySetting').value) || 1500;
        config.continuousScan.idleBudgetMs = Number(q('idleBudgetSetting').value) || 6;
        config.continuousScan.patrolInterval = Number(q('patrolIntervalSetting').value) || 30;
        config.persistence.enabled = persistenceNextEnabled;
        config.persistence.maxSessions = Math.max(1, Math.min(50, Number(q('maxSessionsSetting').value) || 12));
        config.persistence.retentionDays = Math.max(1, Math.min(365, Number(q('retentionDaysSetting').value) || 14));
        config.persistence.maxRecordsPerSession = Math.max(500, Math.min(50000, Number(q('maxSessionRecordsSetting').value) || 6000));
        config.persistence.actionWindowMs = Math.max(1000, Math.min(15000, Number(q('actionWindowSetting').value) || 4500));
        config.ballSize = Number(q('ballSizeSetting').value) || 46;
        config.opacity = Number(q('opacitySetting').value) || .96;
        config.autoCollapseSeconds = Number(q('collapseSetting').value) || 0;
        config.limits.mutationsPerSecond = Number(q('mutationSetting').value) || 1500;
        config.limits.response = Number(q('responseLimitSetting').value) || 24000;
        config.limits.renderRows = Number(q('renderRowsSetting').value) || 180;
        saveConfig(); applyUiSettings(); reconfigureProbes();
        if (config.persistence.enabled) {
            if (state.persistence.failed) state.persistence.failed = false;
            initPersistence();
            if (state.persistence.ready) { if (state.persistence.queue.size) flushPersistQueue(); cleanupPersistedSessions(); }
        }
        broadcastToFrames({ mark: MESSAGE_CONTROL, action: 'config', config: publicConfig(), paused: state.capturePaused, stopped: state.hardStopped });
        toast('设置已保存并应用'); scheduleUI(true);
    }

    function startPicker() {
        if (state.hardStopped) { toast('工具已急停，请先重新启动'); return; }
        stopPicker(); state.pickerActive = true; q('quick')?.classList.add('hidden');
        const move = e => { if (isUiEvent(e)) return; setOutline(e.target instanceof Element ? e.target : null, false); };
        const pick = e => {
            if (isUiEvent(e)) return;
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            if (e.target instanceof Element) selectElement(e.target); stopPicker(); openPanel('tester');
        };
        const key = e => { if (e.key === 'Escape') { e.preventDefault(); stopPicker(); toast('已退出元素选择'); } };
        state.pickerBindings = [[document, 'pointermove', move, true], [document, 'click', pick, true], [window, 'keydown', key, true]];
        state.pickerBindings.forEach(x => x[0].addEventListener(x[1], x[2], x[3]));
        scheduleUI(true); toast('移动鼠标选择元素，单击锁定，Esc退出');
    }
    function stopPicker() {
        state.pickerActive = false;
        for (const x of state.pickerBindings || []) try { x[0].removeEventListener(x[1], x[2], x[3]); } catch {}
        state.pickerBindings = []; if (!state.selected) removeOutline(); scheduleUI(true);
    }
    function selectElement(el) {
        if (!(el instanceof Element)) return;
        state.selected = el; setOutline(el, true);
        if (state.ui) {
            const d = describeElement(el, true), selector = d.selector || '';
            q('selectorInput').value = selector;
            q('selectedInfo').innerHTML = `<b>${escapeHtml(d.tag)}</b>${d.id ? ` #${escapeHtml(d.id)}` : ''}<br>${escapeHtml(selector)}<br>尺寸：${d.rect?.width || 0} × ${d.rect?.height || 0}　文本：${escapeHtml(clip(d.text, 120))}`;
        }
    }
    function setOutline(el, locked) {
        removeOutline(); if (!(el instanceof Element) || !TOP) return;
        const r = el.getBoundingClientRect(), outline = document.createElement('div');
        outline.setAttribute('data-miuyi-wct-outline', '');
        outline.style.cssText = `position:fixed;pointer-events:none;z-index:2147483645;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border:2px solid ${locked ? '#7c3aed' : '#2563eb'};background:${locked ? 'rgba(124,58,237,.08)' : 'rgba(37,99,235,.08)'};box-sizing:border-box`;
        document.documentElement.appendChild(outline); state.selectedOutline = outline;
    }
    function removeOutline() { try { state.selectedOutline?.remove(); } catch {} state.selectedOutline = null; }
    function highlightSelected() { if (state.selected?.isConnected) { setOutline(state.selected, true); setTimeout(() => { if (state.selectedOutline) removeOutline(); }, 1800); } }
    function testSelector() {
        const selector = q('selectorInput').value.trim(); if (!selector) return;
        try {
            const matches = [...document.querySelectorAll(selector)];
            if (matches[0]) { selectElement(matches[0]); matches.slice(0, 20).forEach((el, i) => setTimeout(() => flashElement(el, i), i * 18)); }
            toast(`选择器匹配 ${matches.length} 个元素${matches.length === 1 ? '，唯一' : ''}`);
        } catch (e) { toast(`选择器无效：${clip(e.message, 120)}`); }
    }
    function flashElement(el, index) {
        try {
            const r = el.getBoundingClientRect(), d = document.createElement('div');
            d.setAttribute('data-miuyi-wct-flash', '');
            d.style.cssText = `position:fixed;pointer-events:none;z-index:2147483644;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border:2px solid #f59e0b;background:rgba(245,158,11,.06);box-sizing:border-box`;
            document.documentElement.appendChild(d); setTimeout(() => d.remove(), 1200 + index * 20);
        } catch {}
    }
    function setSelectedValue(changeOnly) {
        const el = state.selected; if (!el || !('value' in el)) { toast('选中元素不支持输入'); return; }
        if (!changeOnly) {
            const value = q('inputValue').value;
            try {
                const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                if (setter) setter.call(el, value); else el.value = value;
                el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
            } catch { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }
        } else el.dispatchEvent(new Event('change', { bubbles: true }));
        toast(changeOnly ? '已触发Change' : '已写入并触发Input');
    }
    function applyTestCss() {
        if (!state.selected) { toast('请先选择元素'); return; }
        resetTestCss();
        const style = q('cssInput').value.trim(); if (!style) return;
        const old = state.selected.getAttribute('style'); state.testStyleBackup = { el: state.selected, old };
        state.selected.style.cssText += `;${style}`; highlightSelected(); toast('临时CSS已应用');
    }
    function resetTestCss() {
        const b = state.testStyleBackup;
        if (b?.el) { if (b.old == null) b.el.removeAttribute('style'); else b.el.setAttribute('style', b.old); }
        state.testStyleBackup = null; toast('临时CSS已恢复');
    }

    function toast(message) {
        if (!TOP || !state.ui) return;
        const el = q('toast'); el.textContent = message; el.classList.remove('hidden');
        clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.add('hidden'), 1800);
    }

    function installKeyboard() {
        const key = e => {
            if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'q') {
                e.preventDefault();
                if (TOP) hardStop();
                else try { window.top.postMessage({ mark: MESSAGE_CONTROL, action: 'emergency' }, '*'); } catch {}
            }
            if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'w') { e.preventDefault(); ensureUi(); togglePanel('quick'); }
            if (e.key === 'Escape' && state.pickerActive) stopPicker();
        };
        bindPersistent(window, 'keydown', key, true);
    }

    function bootstrapUi() {
        if (!TOP) return;
        const ready = () => { ensureUi(); positionFloatingPanels(); };
        if (document.documentElement) ready(); else bind(document, 'readystatechange', ready, { once: true });
        bindPersistent(window, 'resize', () => { applyUiSettings(); positionFloatingPanels(); }, { passive: true });
        setInterval(() => {
            if (state.ui?.host && !state.ui.host.isConnected && document.documentElement) document.documentElement.appendChild(state.ui.host);
        }, 3000);
    }

    installFrameBridge();
    installKeyboard();
    bootstrapUi();
    if (TOP) initPersistence();
    if (config.autoStart) setupProbes();
    else { installErrors(); state.phase = 'paused'; }

    try {
        const publicApi = {
            version: VERSION,
            state,
            config: () => config,
            pause: () => { state.capturePaused = true; state.phase = 'paused'; scheduleUI(true); },
            resume: () => { state.capturePaused = false; state.phase = 'capturing'; scheduleUI(true); },
            stop: hardStop,
            restart,
            exportData,
            diagnostics: diagnosticSnapshot,
            scanComponents,
            scanSelected: scanSelectedArea,
            rescan: () => continuousRescan('API手动补扫', true),
            toggleContinuousScan,
            captureOverlays: () => captureEphemeralSubtree(document.documentElement, 'API捕获当前浮层', true),
            open: () => { ensureUi(); openDrawer(false); },
            picker: startPicker
        };
        Object.defineProperty(window, '__LumaTrace', { configurable: true, value: publicApi });
        Object.defineProperty(window, '__MiuyiWebCapture', { configurable: true, value: publicApi });
    } catch {}
})();
