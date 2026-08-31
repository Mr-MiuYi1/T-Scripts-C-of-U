// ==UserScript==
// @name         工作平台统一自动登录
// @namespace    miuyi.work.autologin
// @version      6.4.2
// @description  多工作平台统一自动登录工具，支持多账号管理、账号切换、自动填充、验证码完成后自动提交、登录页严格识别及自定义登录延迟。
//
// ==================== AutoTable PMS ====================
// @match        http://115.190.74.246/*
// @match        https://115.190.74.246/*
//
// ==================== 流向管理平台 ====================
// @match        http://118.190.18.139/*
// @match        https://118.190.18.139/*
//
// ==================== 英佰达流向管理平台 ====================
// @match        http://47.104.81.198/*
// @match        https://47.104.81.198/*
//
// ==================== 云程数据采集处理平台 ====================
// @match        https://dps-ddi-prod.yuncheng-group.com/*
//
//
// @updateURL    https://raw.githubusercontent.com/Mr-MiuYi1/T-Scripts-C-of-U/main/unified‑work‑platform‑autologin/工作平台统一自动登录.meta.js
// @downloadURL  https://raw.githubusercontent.com/Mr-MiuYi1/T-Scripts-C-of-U/main/unified‑work‑platform‑autologin/工作平台统一自动登录.user.js
//
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==


/*
 * ============================================================
 * 工作平台统一自动登录脚本
 * ============================================================
 *
 * 功能说明：
 * 本脚本用于统一处理多个内部工作平台的自动登录流程，
 * 减少重复输入账号、密码和手动点击登录按钮的操作。
 *
 * 当前支持平台：
 * 1. AutoTable PMS
 * 2. 流向管理平台
 * 3. 英佰达流向管理平台
 * 4. 云程数据采集处理平台（DPS）
 *
 * 主要功能：
 * - 支持不同平台分别保存登录账号和密码
 * - 支持单个平台保存多个账号并快速切换
 * - 自动识别真实登录界面并填写账号、密码
 * - 自动点击登录按钮
 * - 支持登录延迟、重试间隔等参数自定义
 * - 提供统一的“账号与自动登录设置”管理界面
 * - 支持登录后切换账号，并自动退出当前账号重新登录
 *
 * 云程数据采集处理平台（DPS）：
 * - 仅在 /login 登录页面启用自动登录逻辑
 * - 业务页面不会扫描、修改或聚焦账号/密码输入框
 * - 自动填写账号和密码
 * - 验证码由用户手动输入
 * - 验证码输入满 4 位后自动点击“登录”
 * - 对验证码输入、页面重渲染及登录按钮状态变化做兼容处理
 *
 * 安全设计：
 * - 不同平台的账号数据相互独立
 * - 严格限制自动登录触发范围，避免误操作业务页面中的
 *   密码框、API Key、密钥等敏感输入框
 * - AutoTable 与 DPS 均采用登录页面限定机制
 *
 * 使用方式：
 * 1. 安装脚本后进入对应工作平台
 * 2. 打开油猴菜单 →「账号与自动登录设置」
 * 3. 添加需要使用的账号和密码
 * 4. 开启自动登录
 * 5. 后续进入登录页面时脚本会自动完成登录流程
 *
 * 注意：
 * - 验证码不会被脚本识别或破解，仅负责监听用户输入完成后的登录操作
 * - 页面结构发生较大变化后，部分平台的自动登录选择器可能需要重新适配
 * - 建议仅在个人可信设备中保存工作账号密码
 *
 * Author: MiuYi
 * ============================================================
 */

(function () {
    'use strict';

    const VERSION = '6.4.2';
    const CHECK_INTERVAL = 2500;

    // 登录延迟默认值。可在“⚙ 设置中心 → 高级设置”里修改，无需再编辑源码。
    const DEFAULT_SETTINGS = {
        usernameToPasswordDelay: 250,
        passwordToSubmitDelay: 250,
        captchaSubmitDelay: 160,
        loginCooldown: 7000,
        dpsEnterCooldown: 3000
    };

    const SYSTEMS = [
        {
            id: 'autotable',
            name: 'AutoTable PMS',
            hostname: '115.190.74.246',
            type: 'standard',
            // AutoTable 内部页面也存在 type="password" 的 API Key 输入框。
            // 只有真正位于 /login 时才允许自动登录逻辑接触输入框。
            loginPathRegex: /^\/login\/?$/i,
            usernameSelectors: [
                'input[placeholder*="账号"]',
                'input[placeholder*="帐号"]',
                'input[name="username"]',
                'input[name="account"]',
                'input[type="text"]'
            ],
            passwordSelectors: [
                'input[placeholder*="密码"]',
                'input[name="password"]',
                'input[type="password"]'
            ],
            loginTexts: ['进入工作台', '立即登录', '登录', '登陆']
        },
        {
            id: 'flow_118',
            name: '流向管理平台',
            hostname: '118.190.18.139',
            port: '8090',
            type: 'fineui',
            windowId: 'Window1',
            usernameId: 'Window1_SimpleForm1_tbxUserName-inputEl',
            passwordId: 'Window1_SimpleForm1_tbxPassword-inputEl',
            submitId: 'Window1_ctl00_btnSubmit'
        },
        {
            id: 'flow_47',
            name: '英佰达流向管理平台',
            hostname: '47.104.81.198',
            port: '8090',
            type: 'fineui',
            windowId: 'Window1',
            usernameId: 'Window1_SimpleForm1_tbxUserName-inputEl',
            passwordId: 'Window1_SimpleForm1_tbxPassword-inputEl',
            submitId: 'Window1_ctl00_btnSubmit'
        },
        {
            id: 'dps',
            name: '云程数据采集处理平台',
            hostname: 'dps-ddi-prod.yuncheng-group.com',
            type: 'dps',
            // 云程平台只允许在精确 /login 页面运行自动登录逻辑。
            loginPathRegex: /^\/login\/?$/i
        }
    ];

    const currentSystem = SYSTEMS.find(system => {
        if (system.hostname !== location.hostname) return false;
        if (system.port && system.port !== location.port) return false;
        return true;
    });

    if (!currentSystem) return;

    let loggingIn = false;
    let lastAttempt = 0;
    let mutationTimer = null;
    let dpsEnterClickedAt = 0;
    let dpsSubmitTimer = null;
    let dpsLastSubmitTime = 0;

    const log = (...args) => console.log(`[统一自动登录 V${VERSION}]`, ...args);
    const warn = (...args) => console.warn(`[统一自动登录 V${VERSION}]`, ...args);

    // =============================================================
    // 存储：沿用 V5 的 Key，直接覆盖旧脚本不会丢账号
    // =============================================================

    const accountsKey = () => `UAL_${currentSystem.id}_accounts`;
    const activeAccountKey = () => `UAL_${currentSystem.id}_active`;
    const enabledKey = () => `UAL_${currentSystem.id}_enabled`;
    const settingsKey = () => `UAL_${currentSystem.id}_settings`;

    function getSettings() {
        const stored = GM_getValue(settingsKey(), {});
        const value = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
        return { ...DEFAULT_SETTINGS, ...value };
    }

    function saveSettings(patch) {
        const current = getSettings();
        GM_setValue(settingsKey(), { ...current, ...patch });
    }

    function resetSettings() {
        GM_deleteValue(settingsKey());
    }

    function normalizeDelay(value, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.max(0, Math.min(60000, Math.round(number)));
    }

    function getAccounts() {
        const value = GM_getValue(accountsKey(), []);
        return Array.isArray(value) ? value : [];
    }

    function saveAccounts(accounts) {
        GM_setValue(accountsKey(), accounts);
    }

    function getActiveAccountIndex() {
        const accounts = getAccounts();
        if (!accounts.length) return -1;

        let index = Number(GM_getValue(activeAccountKey(), 0));
        if (!Number.isInteger(index) || index < 0 || index >= accounts.length) {
            index = 0;
            GM_setValue(activeAccountKey(), 0);
        }
        return index;
    }

    function getActiveAccount() {
        const accounts = getAccounts();
        const index = getActiveAccountIndex();
        return index >= 0 ? accounts[index] || null : null;
    }

    function isEnabled() {
        return GM_getValue(enabledKey(), true);
    }

    function migrateLegacyAccount() {
        if (getAccounts().length) return;

        const oldUsernameKey = `UAL_${currentSystem.id}_username`;
        const oldPasswordKey = `UAL_${currentSystem.id}_password`;
        const username = GM_getValue(oldUsernameKey, '');
        const password = GM_getValue(oldPasswordKey, '');

        if (!username || !password) return;

        saveAccounts([{ name: '默认账号', username, password }]);
        GM_setValue(activeAccountKey(), 0);
        GM_deleteValue(oldUsernameKey);
        GM_deleteValue(oldPasswordKey);
        log('已迁移旧版单账号数据');
    }

    function resetLoginState() {
        loggingIn = false;
        lastAttempt = 0;
        dpsEnterClickedAt = 0;
    }

    // =============================================================
    // 基础 DOM 工具
    // =============================================================

    function isVisible(element) {
        if (!element) return false;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function findVisibleBySelectors(selectors) {
        for (const selector of selectors) {
            let elements = [];
            try {
                elements = document.querySelectorAll(selector);
            } catch (_) {
                continue;
            }
            for (const element of elements) {
                if (isVisible(element)) return element;
            }
        }
        return null;
    }

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, '').trim();
    }

    function findButtonByTexts(texts, root = document) {
        const targets = texts.map(normalizeText);
        const elements = root.querySelectorAll(
            'button,a,[role="button"],input[type="button"],input[type="submit"],[role="menuitem"],li'
        );

        for (const element of elements) {
            if (!isVisible(element)) continue;
            const text = normalizeText(element.innerText || element.textContent || element.value);
            if (targets.some(target => text === target || text.includes(target))) return element;
        }
        return null;
    }

    function setInputValue(input, value, keepFocus = false) {
        if (!input) return;
        input.focus();

        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (descriptor?.set) descriptor.set.call(input, value);
        else input.value = value;

        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

        if (!keepFocus) input.blur();
    }

    function clickElement(element) {
        if (!element) return false;
        try {
            element.focus?.();
            element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            element.click();
            return true;
        } catch (error) {
            warn('点击元素失败', error);
            return false;
        }
    }

    function poll(fn, { interval = 100, timeout = 2500 } = {}) {
        return new Promise(resolve => {
            const started = Date.now();
            const timer = setInterval(() => {
                let result = null;
                try { result = fn(); } catch (_) {}
                if (result) {
                    clearInterval(timer);
                    resolve(result);
                    return;
                }
                if (Date.now() - started >= timeout) {
                    clearInterval(timer);
                    resolve(null);
                }
            }, interval);
        });
    }

    // =============================================================
    // 提示 UI
    // =============================================================

    function toast(message, duration = 2400) {
        document.getElementById('UAL_V6_TOAST')?.remove();
        const el = document.createElement('div');
        el.id = 'UAL_V6_TOAST';
        el.textContent = message;
        Object.assign(el.style, {
            position: 'fixed',
            right: '22px',
            bottom: '22px',
            zIndex: '2147483647',
            padding: '11px 16px',
            maxWidth: '360px',
            background: 'rgba(17,24,39,.95)',
            color: '#fff',
            borderRadius: '9px',
            boxShadow: '0 10px 32px rgba(0,0,0,.25)',
            font: '13px/1.5 "Microsoft YaHei",Arial,sans-serif'
        });
        document.body.appendChild(el);
        setTimeout(() => el.remove(), duration);
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // =============================================================
    // 多账号管理
    // =============================================================

    function addAccount() {
        const accounts = getAccounts();
        const oldAccount = getActiveAccount();

        let name = prompt(`【${currentSystem.name}】\n\n请输入账号名称（例如：工作账号 / 管理员）：`);
        if (name === null) return;
        name = name.trim();
        if (!name) return alert('账号名称不能为空。');

        let username = prompt(`请输入【${name}】的登录账号：`);
        if (username === null) return;
        username = username.trim();
        if (!username) return alert('登录账号不能为空。');

        const password = prompt(`请输入【${name}】的登录密码：`);
        if (password === null) return;
        if (!password) return alert('密码不能为空。');

        const account = { name, username, password };
        accounts.push(account);
        saveAccounts(accounts);
        GM_setValue(activeAccountKey(), accounts.length - 1);
        resetLoginState();

        toast(`已添加并选中：${name}`);

        // 如果本来已经登录，添加的新账号也直接尝试切过去。
        if (oldAccount && !isCurrentLoginUIVisible()) switchAndRelogin(oldAccount, account);
        else setTimeout(checkLogin, 200);
    }

    function editCurrentAccount() {
        const accounts = getAccounts();
        const index = getActiveAccountIndex();
        if (index < 0 || !accounts[index]) return alert('当前没有保存账号。');

        const old = accounts[index];
        let name = prompt('账号名称：', old.name);
        if (name === null) return;
        name = name.trim();
        if (!name) return alert('账号名称不能为空。');

        let username = prompt('登录账号：', old.username);
        if (username === null) return;
        username = username.trim();
        if (!username) return alert('登录账号不能为空。');

        const password = prompt('请输入新密码；不修改密码请留空或点取消：');
        accounts[index] = {
            name,
            username,
            password: password ? password : old.password
        };
        saveAccounts(accounts);
        resetLoginState();
        toast('当前账号已更新');
        setTimeout(checkLogin, 200);
    }

    function deleteCurrentAccount() {
        const accounts = getAccounts();
        const index = getActiveAccountIndex();
        if (index < 0 || !accounts[index]) return alert('当前没有保存账号。');

        const account = accounts[index];
        if (!confirm(`确定删除【${account.name}】(${account.username}) 吗？`)) return;

        accounts.splice(index, 1);
        saveAccounts(accounts);
        if (accounts.length) GM_setValue(activeAccountKey(), Math.min(index, accounts.length - 1));
        else GM_deleteValue(activeAccountKey());
        resetLoginState();
        toast('账号已删除');
    }

    function clearAllAccounts() {
        const accounts = getAccounts();
        if (!accounts.length) return alert('当前系统没有保存账号。');
        if (!confirm(`确定清除【${currentSystem.name}】保存的全部 ${accounts.length} 个账号吗？`)) return;
        GM_deleteValue(accountsKey());
        GM_deleteValue(activeAccountKey());
        resetLoginState();
        toast('当前系统全部账号已清除');
    }

    function showCurrentAccount() {
        const account = getActiveAccount();
        if (!account) {
            if (confirm(`【${currentSystem.name}】尚未保存账号，是否现在添加？`)) addAccount();
            return;
        }
        alert(
            `当前系统：${currentSystem.name}\n` +
            `当前账号：${account.name}\n` +
            `登录名：${account.username}\n` +
            `已保存账号：${getAccounts().length} 个\n` +
            `自动登录：${isEnabled() ? '开启' : '关闭'}`
        );
    }

    function toggleEnabled() {
        const enabled = !isEnabled();
        GM_setValue(enabledKey(), enabled);
        resetLoginState();
        toast(`自动登录已${enabled ? '开启' : '关闭'}`);
        if (enabled) setTimeout(checkLogin, 200);
    }

    function switchAccount() {
        const accounts = getAccounts();
        if (!accounts.length) return addAccount();

        document.getElementById('UAL_V6_SWITCHER')?.remove();
        const currentIndex = getActiveAccountIndex();

        const overlay = document.createElement('div');
        overlay.id = 'UAL_V6_SWITCHER';
        Object.assign(overlay.style, {
            position: 'fixed', inset: '0', zIndex: '2147483647',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,.42)', backdropFilter: 'blur(3px)',
            fontFamily: '"Microsoft YaHei",Arial,sans-serif'
        });

        const dialog = document.createElement('div');
        Object.assign(dialog.style, {
            width: '440px', maxWidth: 'calc(100vw - 32px)', maxHeight: '72vh',
            background: '#fff', color: '#111827', borderRadius: '14px', overflow: 'hidden',
            boxShadow: '0 20px 65px rgba(0,0,0,.30)'
        });

        const header = document.createElement('div');
        Object.assign(header.style, {
            padding: '17px 18px 14px', borderBottom: '1px solid #e5e7eb',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        });
        header.innerHTML = `
            <div>
                <div style="font-size:17px;font-weight:650">切换登录账号</div>
                <div style="margin-top:4px;font-size:12px;color:#9ca3af">${escapeHtml(currentSystem.name)}</div>
            </div>`;

        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = '×';
        Object.assign(close.style, {
            border: '0', background: 'transparent', color: '#6b7280', cursor: 'pointer',
            fontSize: '26px', width: '34px', height: '34px', borderRadius: '8px'
        });
        close.onclick = () => overlay.remove();
        header.appendChild(close);

        const list = document.createElement('div');
        Object.assign(list.style, { padding: '12px', maxHeight: '440px', overflowY: 'auto' });

        accounts.forEach((account, index) => {
            const current = index === currentIndex;
            const item = document.createElement('button');
            item.type = 'button';
            Object.assign(item.style, {
                width: '100%', display: 'flex', alignItems: 'center', gap: '12px',
                padding: '12px 13px', marginBottom: '8px', textAlign: 'left', cursor: 'pointer',
                borderRadius: '10px', border: current ? '1px solid #3b82f6' : '1px solid #e5e7eb',
                background: current ? '#eff6ff' : '#fff', color: '#111827', font: 'inherit'
            });

            const avatarText = (account.name || account.username || '?').trim().charAt(0).toUpperCase();
            item.innerHTML = `
                <span style="width:40px;height:40px;min-width:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:650;background:${current ? '#3b82f6' : '#f3f4f6'};color:${current ? '#fff' : '#4b5563'}">${escapeHtml(avatarText)}</span>
                <span style="flex:1;min-width:0">
                    <span style="display:block;font-size:14px;font-weight:650">${escapeHtml(account.name)}</span>
                    <span style="display:block;margin-top:3px;font-size:12px;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(account.username)}</span>
                </span>
                <span style="font-size:${current ? '11px' : '22px'};color:${current ? '#2563eb' : '#9ca3af'}">${current ? '当前' : '›'}</span>`;

            if (!current) {
                item.onmouseenter = () => { item.style.background = '#f9fafb'; item.style.borderColor = '#93c5fd'; };
                item.onmouseleave = () => { item.style.background = '#fff'; item.style.borderColor = '#e5e7eb'; };
            }

            item.onclick = () => {
                if (current) return overlay.remove();

                const oldAccount = getActiveAccount();
                GM_setValue(activeAccountKey(), index);
                resetLoginState();
                overlay.remove();
                toast(`正在切换到：${account.name}`);
                switchAndRelogin(oldAccount, account);
            };
            list.appendChild(item);
        });

        const footer = document.createElement('div');
        footer.textContent = '点击账号后会自动退出当前账号并重新登录';
        Object.assign(footer.style, {
            padding: '10px 14px', borderTop: '1px solid #e5e7eb', background: '#f9fafb',
            color: '#9ca3af', textAlign: 'center', fontSize: '11px'
        });

        dialog.append(header, list, footer);
        overlay.appendChild(dialog);
        overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);

        const esc = event => {
            if (event.key === 'Escape') {
                overlay.remove();
                document.removeEventListener('keydown', esc);
            }
        };
        document.addEventListener('keydown', esc);
    }

    // =============================================================
    // V6.2 设置中心：油猴菜单只保留“切换账号 + 设置中心”两个入口
    // =============================================================

    function closeSettingsPanel() {
        document.getElementById('UAL_V62_SETTINGS')?.remove();
    }

    function createSettingsButton(text, onClick, danger = false) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        Object.assign(button.style, {
            border: `1px solid ${danger ? '#fecaca' : '#d1d5db'}`,
            background: danger ? '#fff7f7' : '#fff',
            color: danger ? '#dc2626' : '#374151',
            borderRadius: '8px',
            padding: '8px 11px',
            cursor: 'pointer',
            font: '13px/1.2 "Microsoft YaHei",Arial,sans-serif'
        });
        button.onmouseenter = () => {
            button.style.background = danger ? '#fef2f2' : '#f9fafb';
        };
        button.onmouseleave = () => {
            button.style.background = danger ? '#fff7f7' : '#fff';
        };
        button.onclick = onClick;
        return button;
    }

    function createDelayField(label, value, key, note = '') {
        const row = document.createElement('label');
        Object.assign(row.style, {
            display: 'grid',
            gridTemplateColumns: '1fr 128px',
            gap: '12px',
            alignItems: 'center',
            padding: '9px 0'
        });

        const info = document.createElement('span');
        info.innerHTML = `
            <span style="display:block;font-size:13px;color:#374151">${escapeHtml(label)}</span>
            ${note ? `<span style="display:block;margin-top:3px;font-size:11px;color:#9ca3af">${escapeHtml(note)}</span>` : ''}
        `;

        const inputWrap = document.createElement('span');
        Object.assign(inputWrap.style, {
            display: 'flex', alignItems: 'center', gap: '6px'
        });
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.max = '60000';
        input.step = '50';
        input.value = String(value);
        input.dataset.settingKey = key;
        Object.assign(input.style, {
            width: '88px', boxSizing: 'border-box', border: '1px solid #d1d5db',
            borderRadius: '7px', padding: '7px 8px', outline: 'none', color: '#111827',
            background: '#fff', font: '13px "Microsoft YaHei",Arial,sans-serif'
        });
        const unit = document.createElement('span');
        unit.textContent = 'ms';
        Object.assign(unit.style, { color: '#9ca3af', fontSize: '11px' });
        inputWrap.append(input, unit);
        row.append(info, inputWrap);
        return row;
    }

    function openSettingsPanel() {
        closeSettingsPanel();

        const accounts = getAccounts();
        const activeAccount = getActiveAccount();
        const settings = getSettings();

        const overlay = document.createElement('div');
        overlay.id = 'UAL_V62_SETTINGS';
        Object.assign(overlay.style, {
            position: 'fixed', inset: '0', zIndex: '2147483647',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '18px', boxSizing: 'border-box',
            background: 'rgba(15,23,42,.48)', backdropFilter: 'blur(4px)',
            fontFamily: '"Microsoft YaHei",Arial,sans-serif'
        });

        const panel = document.createElement('div');
        Object.assign(panel.style, {
            width: '540px', maxWidth: '100%', maxHeight: '84vh', overflow: 'hidden',
            display: 'flex', flexDirection: 'column', background: '#fff', color: '#111827',
            borderRadius: '16px', boxShadow: '0 24px 80px rgba(0,0,0,.32)'
        });

        const header = document.createElement('div');
        Object.assign(header.style, {
            padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid #e5e7eb'
        });
        const title = document.createElement('div');
        title.innerHTML = `
            <div style="font-size:18px;font-weight:700">账号与自动登录设置</div>
            <div style="margin-top:4px;font-size:12px;color:#9ca3af">${escapeHtml(currentSystem.name)} · V${VERSION}</div>
        `;
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = '×';
        Object.assign(close.style, {
            width: '34px', height: '34px', border: '0', borderRadius: '8px', background: 'transparent',
            color: '#6b7280', cursor: 'pointer', fontSize: '26px', lineHeight: '28px'
        });
        close.onclick = closeSettingsPanel;
        header.append(title, close);

        const body = document.createElement('div');
        Object.assign(body.style, { padding: '14px 16px 18px', overflowY: 'auto' });

        const summary = document.createElement('div');
        Object.assign(summary.style, {
            display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px', alignItems: 'center',
            padding: '13px 14px', marginBottom: '12px', borderRadius: '11px', background: '#f8fafc',
            border: '1px solid #e5e7eb'
        });
        summary.innerHTML = `
            <div style="min-width:0">
                <div style="font-size:12px;color:#9ca3af">当前账号</div>
                <div style="margin-top:3px;font-size:14px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                    ${activeAccount ? `${escapeHtml(activeAccount.name)} <span style="font-weight:400;color:#6b7280">(${escapeHtml(activeAccount.username)})</span>` : '未设置'}
                </div>
            </div>
            <span id="UAL_V62_ENABLED_BADGE" style="padding:4px 9px;border-radius:999px;font-size:11px;background:${isEnabled() ? '#dcfce7' : '#f3f4f6'};color:${isEnabled() ? '#15803d' : '#6b7280'}">
                ${isEnabled() ? '自动登录已开启' : '自动登录已关闭'}
            </span>
        `;

        function makeDetails(titleText, subtitleText = '') {
            const details = document.createElement('details');
            // 故意不设置 open：三个设置区默认全部折叠。
            Object.assign(details.style, {
                border: '1px solid #e5e7eb', borderRadius: '11px', marginBottom: '10px', overflow: 'hidden', background: '#fff'
            });
            const summaryEl = document.createElement('summary');
            Object.assign(summaryEl.style, {
                listStyle: 'none', cursor: 'pointer', padding: '13px 14px', userSelect: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px'
            });
            summaryEl.innerHTML = `
                <span>
                    <span style="display:block;font-size:14px;font-weight:650;color:#1f2937">${escapeHtml(titleText)}</span>
                    ${subtitleText ? `<span style="display:block;margin-top:3px;font-size:11px;color:#9ca3af">${escapeHtml(subtitleText)}</span>` : ''}
                </span>
                <span style="font-size:16px;color:#9ca3af">⌄</span>
            `;
            const content = document.createElement('div');
            Object.assign(content.style, { padding: '0 14px 14px', borderTop: '1px solid #f3f4f6' });
            details.append(summaryEl, content);
            return { details, content };
        }

        // 账号管理：默认折叠
        const accountSection = makeDetails('账号管理', `已保存 ${accounts.length} 个账号`);
        const accountButtons = document.createElement('div');
        Object.assign(accountButtons.style, {
            display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '8px', paddingTop: '12px'
        });
        accountButtons.append(
            createSettingsButton('🔄 切换账号', () => { closeSettingsPanel(); switchAccount(); }),
            createSettingsButton('➕ 添加账号', () => { closeSettingsPanel(); addAccount(); }),
            createSettingsButton('✏ 修改当前账号', () => { closeSettingsPanel(); editCurrentAccount(); }),
            createSettingsButton('🗑 删除当前账号', () => { closeSettingsPanel(); deleteCurrentAccount(); }, true),
            createSettingsButton('👤 查看账号信息', () => showCurrentAccount()),
            createSettingsButton('⚠ 清空全部账号', () => { closeSettingsPanel(); clearAllAccounts(); }, true)
        );
        accountSection.content.appendChild(accountButtons);

        // 自动登录设置：默认折叠
        const autoSection = makeDetails('自动登录', '控制当前系统是否自动填写并提交登录');
        const toggleRow = document.createElement('div');
        Object.assign(toggleRow.style, {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', paddingTop: '12px'
        });
        toggleRow.innerHTML = `
            <span>
                <span style="display:block;font-size:13px;color:#374151">启用自动登录</span>
                <span style="display:block;margin-top:3px;font-size:11px;color:#9ca3af">关闭后仍保留已保存账号</span>
            </span>
        `;
        const switchLabel = document.createElement('label');
        Object.assign(switchLabel.style, { position: 'relative', width: '44px', height: '24px', cursor: 'pointer', flex: '0 0 auto' });
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = isEnabled();
        Object.assign(checkbox.style, { opacity: '0', width: '0', height: '0', position: 'absolute' });
        const track = document.createElement('span');
        Object.assign(track.style, {
            position: 'absolute', inset: '0', borderRadius: '999px', transition: '.18s',
            background: checkbox.checked ? '#2563eb' : '#d1d5db'
        });
        const knob = document.createElement('span');
        Object.assign(knob.style, {
            position: 'absolute', top: '3px', left: checkbox.checked ? '23px' : '3px', width: '18px', height: '18px',
            borderRadius: '50%', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.25)', transition: '.18s'
        });
        switchLabel.append(checkbox, track, knob);
        checkbox.onchange = () => {
            GM_setValue(enabledKey(), checkbox.checked);
            resetLoginState();
            track.style.background = checkbox.checked ? '#2563eb' : '#d1d5db';
            knob.style.left = checkbox.checked ? '23px' : '3px';
            const badge = document.getElementById('UAL_V62_ENABLED_BADGE');
            if (badge) {
                badge.textContent = checkbox.checked ? '自动登录已开启' : '自动登录已关闭';
                badge.style.background = checkbox.checked ? '#dcfce7' : '#f3f4f6';
                badge.style.color = checkbox.checked ? '#15803d' : '#6b7280';
            }
            toast(`自动登录已${checkbox.checked ? '开启' : '关闭'}`);
            if (checkbox.checked) setTimeout(checkLogin, 180);
        };
        toggleRow.appendChild(switchLabel);
        const checkNow = createSettingsButton('立即检查一次登录状态', () => {
            resetLoginState();
            checkLogin();
            toast('已执行一次登录检查');
        });
        Object.assign(checkNow.style, { marginTop: '12px', width: '100%' });
        autoSection.content.append(toggleRow, checkNow);

        // 高级设置：默认折叠
        const advancedSection = makeDetails('高级设置', '登录延迟与重试间隔；1000 ms = 1 秒');
        const fields = document.createElement('div');
        Object.assign(fields.style, { paddingTop: '5px' });

        if (currentSystem.type === 'standard' || currentSystem.type === 'fineui') {
            fields.append(
                createDelayField('账号 → 密码延迟', settings.usernameToPasswordDelay, 'usernameToPasswordDelay', '账号填入后等待多久再填写密码'),
                createDelayField('密码 → 登录延迟', settings.passwordToSubmitDelay, 'passwordToSubmitDelay', '密码填入后等待多久再点击登录')
            );
        }

        if (currentSystem.type === 'dps') {
            fields.append(
                createDelayField('验证码 → 登录延迟', settings.captchaSubmitDelay, 'captchaSubmitDelay', '验证码输入满 4 位后等待多久点击登录'),
                createDelayField('“进入平台”重复点击冷却', settings.dpsEnterCooldown, 'dpsEnterCooldown', '防止欢迎页短时间重复点击')
            );
        }

        fields.append(
            createDelayField('登录失败重试间隔', settings.loginCooldown, 'loginCooldown', 'AutoTable / 流向平台再次尝试登录前的等待时间')
        );

        const advancedButtons = document.createElement('div');
        Object.assign(advancedButtons.style, { display: 'flex', gap: '8px', marginTop: '10px' });
        const save = createSettingsButton('保存高级设置', () => {
            const patch = {};
            fields.querySelectorAll('input[data-setting-key]').forEach(input => {
                const key = input.dataset.settingKey;
                patch[key] = normalizeDelay(input.value, DEFAULT_SETTINGS[key]);
                input.value = String(patch[key]);
            });
            saveSettings(patch);
            resetLoginState();
            toast('高级设置已保存');
        });
        save.style.flex = '1';
        save.style.background = '#2563eb';
        save.style.borderColor = '#2563eb';
        save.style.color = '#fff';
        save.onmouseenter = () => { save.style.background = '#1d4ed8'; };
        save.onmouseleave = () => { save.style.background = '#2563eb'; };

        const restore = createSettingsButton('恢复默认', () => {
            if (!confirm('确定恢复当前系统的默认延迟设置吗？')) return;
            resetSettings();
            resetLoginState();
            toast('已恢复默认延迟');
            closeSettingsPanel();
            setTimeout(openSettingsPanel, 120);
        });
        advancedButtons.append(save, restore);
        advancedSection.content.append(fields, advancedButtons);

        body.append(summary, accountSection.details, autoSection.details, advancedSection.details);
        panel.append(header, body);
        overlay.appendChild(panel);
        overlay.addEventListener('click', event => { if (event.target === overlay) closeSettingsPanel(); });
        document.body.appendChild(overlay);

        const esc = event => {
            if (event.key === 'Escape') {
                closeSettingsPanel();
                document.removeEventListener('keydown', esc);
            }
        };
        document.addEventListener('keydown', esc);
    }

    // =============================================================
    // 登录界面识别 / 登录页指纹
    // =============================================================

    function isRealLoginPage(system = currentSystem) {
        if (system.id === 'autotable') {
            // 只认可 /login（允许末尾 /），彻底排除 AI 模型/API Key 等业务页面。
            return system.loginPathRegex
                ? system.loginPathRegex.test(location.pathname)
                : /^\/login\/?$/i.test(location.pathname);
        }

        // FineUI 登录失效时会直接在业务页面弹出 Window1，不能用 URL 限制。
        if (system.type === 'fineui') return true;

        // DPS 只允许精确 /login（允许末尾 /），业务页面一律不触发自动登录。
        if (system.type === 'dps') {
            return system.loginPathRegex
                ? system.loginPathRegex.test(location.pathname)
                : /^\/login\/?$/i.test(location.pathname);
        }

        return false;
    }

    function isCurrentLoginUIVisible() {
        if (currentSystem.type === 'standard') {
            if (!isRealLoginPage(currentSystem)) return false;

            const usernameInput = findVisibleBySelectors(currentSystem.usernameSelectors);
            const passwordInput = findVisibleBySelectors(currentSystem.passwordSelectors);
            const loginButton = findButtonByTexts(currentSystem.loginTexts);

            // 三个特征同时存在才认定为 AutoTable 登录界面。
            return !!(usernameInput && passwordInput && loginButton);
        }

        if (currentSystem.type === 'fineui') {
            const win = document.getElementById(currentSystem.windowId);
            return !!(win && isVisible(win));
        }

        if (currentSystem.type === 'dps') {
            if (!isRealLoginPage(currentSystem)) return false;
            return !!getDPSLoginUI();
        }

        return false;
    }

    // =============================================================
    // 精确退出逻辑
    // =============================================================

    function findLogoutButton() {
        // AutoTable：用户提供的真实结构
        if (currentSystem.id === 'autotable') {
            const el = document.querySelector(
                '.cm-dropdown-overlay [data-menu-id$="-logout"],' +
                '.ant-dropdown [data-menu-id$="-logout"],' +
                '[role="menuitem"][data-menu-id$="-logout"]'
            );
            if (el && isVisible(el)) return el;
        }

        // 两个 FineUI 流向平台：用户提供的真实 ID
        if (currentSystem.type === 'fineui') {
            const el = document.getElementById('regionPanel_topPanel_btnUserName_Menu1_btnExit') ||
                document.querySelector('[id$="_btnUserName_Menu1_btnExit"]');
            if (el && isVisible(el)) return el;
        }

        // DPS / Jeecg / Ant Design：兼容 data-menu-id="logout" 与 xxx-logout
        if (currentSystem.type === 'dps') {
            const el = document.querySelector(
                'li[data-menu-id="logout"],' +
                '[role="menuitem"][data-menu-id="logout"],' +
                '[role="menuitem"][data-menu-id$="-logout"],' +
                '[data-menu-id$="-logout"]'
            );
            if (el && isVisible(el)) return el;
        }

        // 通用兜底
        const logoutTexts = ['退出登录', '退出系统', '安全退出', '注销登录', '退出', '注销'];
        const elements = document.querySelectorAll(
            'button,a,[role="button"],[role="menuitem"],[class*="menu-item"],[class*="dropdown-item"],li,span,div'
        );
        for (const element of elements) {
            if (!isVisible(element)) continue;
            if (!logoutTexts.includes(normalizeText(element.innerText || element.textContent || element.value))) continue;
            return element.closest('[role="menuitem"],li,button,a,[role="button"]') || element;
        }
        return null;
    }

    function tryOpenUserMenu(oldAccount) {
        // AutoTable：精确固定选择器
        if (currentSystem.id === 'autotable') {
            const trigger = document.querySelector('.sidebar-user-panel .app-user-trigger') ||
                document.querySelector('.sidebar-user-panel .ant-dropdown-trigger');
            if (!trigger || !isVisible(trigger)) return false;
            log('打开 AutoTable 用户菜单');
            return clickElement(trigger);
        }

        // FineUI：精确固定选择器
        if (currentSystem.type === 'fineui') {
            const alreadyOpen = document.getElementById('regionPanel_topPanel_btnUserName_Menu1_btnExit') ||
                document.querySelector('[id$="_btnUserName_Menu1_btnExit"]');
            if (alreadyOpen && isVisible(alreadyOpen)) return true;

            const trigger = document.getElementById('regionPanel_topPanel_btnUserName') ||
                document.querySelector('[id$="_topPanel_btnUserName"]') ||
                document.querySelector('[id$="_btnUserName"]');
            if (!trigger || !isVisible(trigger)) return false;
            log(`打开 ${currentSystem.name} 用户菜单`);
            return clickElement(trigger);
        }

        // DPS：如果菜单已经开着，不重复打开
        if (currentSystem.type === 'dps') {
            const alreadyOpen = document.querySelector(
                '[role="menuitem"][data-menu-id="logout"],[role="menuitem"][data-menu-id$="-logout"]'
            );
            if (alreadyOpen && isVisible(alreadyOpen)) return true;

            const selectors = [
                '.jeecg-header-user-dropdown',
                '.ant-dropdown-trigger',
                '[class*="header-user-dropdown"]:not(.ant-dropdown)',
                '[class*="header-user"]:not(.ant-dropdown)',
                '[class*="user-dropdown"]:not(.ant-dropdown)',
                '[class*="user-info"]',
                '[class*="userInfo"]',
                '[class*="avatar"]'
            ];

            const candidates = [...document.querySelectorAll(selectors.join(','))].filter(el => {
                if (!isVisible(el)) return false;
                if (el.classList.contains('ant-dropdown')) return false;
                return true;
            });

            let target = null;
            if (oldAccount) {
                const keys = [oldAccount.username, oldAccount.name]
                    .filter(Boolean)
                    .map(v => String(v).trim().toLowerCase());
                target = candidates.find(el => {
                    const text = String(el.innerText || el.textContent || '').trim().toLowerCase();
                    return keys.some(key => text.includes(key));
                }) || null;
            }

            if (!target) {
                const rightTop = candidates.filter(el => {
                    const r = el.getBoundingClientRect();
                    return r.left > innerWidth * 0.55 && r.top < innerHeight * 0.35;
                });
                target = rightTop[rightTop.length - 1] || candidates[candidates.length - 1] || null;
            }

            if (!target) return false;

            log('打开数据采集平台用户菜单');
            try {
                target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));
                target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
                target.click();
                return true;
            } catch (error) {
                warn('打开数据采集平台用户菜单失败', error);
                return false;
            }
        }

        return false;
    }

    function findLogoutConfirmButton() {
        const dialogs = [...document.querySelectorAll(
            '.ant-modal,.ant-modal-root,[role="dialog"],.el-message-box,.ivu-modal,.arco-modal'
        )].filter(isVisible);

        for (const dialog of dialogs) {
            const text = normalizeText(dialog.innerText || dialog.textContent);
            if (!/(退出|注销)/.test(text)) continue;

            const buttons = [...dialog.querySelectorAll('button,a,[role="button"]')].filter(isVisible);
            const positive = buttons.find(btn => {
                const t = normalizeText(btn.innerText || btn.textContent || btn.value);
                return ['确定', '确认', '退出', '是', 'OK'].includes(t);
            });
            if (positive) return positive;
        }
        return null;
    }

    async function performLogout(oldAccount) {
        let logout = findLogoutButton();

        if (!logout) {
            if (!tryOpenUserMenu(oldAccount)) return false;
            logout = await poll(findLogoutButton, { interval: 80, timeout: 2500 });
        }

        if (!logout) return false;

        log('执行退出当前账号');
        clickElement(logout);

        // 如果站点弹出“确认退出”，自动确认；没有确认框则很快返回 null。
        const confirmButton = await poll(findLogoutConfirmButton, { interval: 80, timeout: 1200 });
        if (confirmButton) {
            log('确认退出');
            clickElement(confirmButton);
        }
        return true;
    }

    async function switchAndRelogin(oldAccount, newAccount) {
        log(`切换账号：${oldAccount?.username || '未知'} -> ${newAccount.username}`);

        // 已经在登录界面：直接让新账号接管表单。
        if (isCurrentLoginUIVisible()) {
            resetLoginState();
            setTimeout(checkLogin, 100);
            return;
        }

        const ok = await performLogout(oldAccount);
        if (!ok) {
            warn('未找到退出入口');
            toast('账号已选中，但未找到当前系统的退出入口', 3200);
            return;
        }

        toast(`已退出，正在切换到：${newAccount.name}`);

        // 如果退出是 SPA 内部切换，当前脚本继续工作；如果整页跳转，
        // 新页面脚本会按已保存的新 active account 自动接管。
        poll(isCurrentLoginUIVisible, { interval: 120, timeout: 8000 }).then(found => {
            if (found) {
                resetLoginState();
                checkLogin();
            }
        });
    }

    // =============================================================
    // AutoTable 登录
    // =============================================================

    function handleStandardLogin(system, account) {
        // AutoTable 的 AI 模型配置页等业务页面也存在 type="password" 输入框。
        // URL 不是 /login 时立即退出，绝不读取、修改或聚焦这些业务输入框。
        if (!isRealLoginPage(system)) return false;

        const usernameInput = findVisibleBySelectors(system.usernameSelectors);
        const passwordInput = findVisibleBySelectors(system.passwordSelectors);
        const loginButton = findButtonByTexts(system.loginTexts);

        // 账号框 + 密码框 + 登录按钮三项缺一不可。
        if (!usernameInput || !passwordInput || !loginButton) return false;

        log(`${system.name} 已确认真实登录页面`);
        setInputValue(usernameInput, account.username);

        setTimeout(() => {
            // SPA 如果在等待期间已经离开登录页，不再继续操作。
            if (!isRealLoginPage(system)) return;

            const freshPasswordInput = findVisibleBySelectors(system.passwordSelectors);
            if (!freshPasswordInput) return;
            setInputValue(freshPasswordInput, account.password, true);

            setTimeout(() => {
                if (!isRealLoginPage(system)) return;

                // 重新确认完整登录指纹，避免 React 重渲染后引用失效或误点业务按钮。
                const freshUsernameInput = findVisibleBySelectors(system.usernameSelectors);
                const freshPassword = findVisibleBySelectors(system.passwordSelectors);
                const freshButton = findButtonByTexts(system.loginTexts);
                if (!freshUsernameInput || !freshPassword || !freshButton) {
                    warn(`${system.name} 登录指纹不完整，已取消提交`);
                    return;
                }

                log(`${system.name} 使用【${account.name}】登录`);

                try {
                    // 不走 clickElement()，避免额外 mousedown/mouseup 干扰组件事件。
                    freshButton.click();
                } catch (error) {
                    warn(`${system.name} 直接点击失败，尝试表单提交`, error);

                    const form = freshPassword.closest('form');
                    if (form && typeof form.requestSubmit === 'function') {
                        try { form.requestSubmit(); } catch (_) {}
                    }
                }
            }, getSettings().passwordToSubmitDelay);
        }, getSettings().usernameToPasswordDelay);

        return true;
    }

    // =============================================================
    // FineUI 两个流向平台登录
    // =============================================================

    function handleFineUILogin(system, account) {
        const loginWindow = document.getElementById(system.windowId);
        if (!loginWindow || !isVisible(loginWindow)) return false;

        const usernameInput = document.getElementById(system.usernameId);
        const passwordInput = document.getElementById(system.passwordId);
        if (!usernameInput || !passwordInput) return false;

        // FineUI 老系统同样使用直接 click() 更稳定。
        // 填写后稍等，让 FineUI 的校验/字段状态完成同步，再重新获取按钮。
        setInputValue(usernameInput, account.username);

        setTimeout(() => {
            setInputValue(passwordInput, account.password, true);

            setTimeout(() => {
                const freshSubmitButton = document.getElementById(system.submitId);
                if (!freshSubmitButton) {
                    warn(`${system.name} 未找到“登陆”按钮`);
                    return;
                }

                log(`${system.name} 使用【${account.name}】自动登陆`);

                try {
                    freshSubmitButton.click();
                } catch (error) {
                    warn(`${system.name} 直接点击失败，尝试回车提交`, error);

                    try {
                        passwordInput.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                            bubbles: true, cancelable: true
                        }));
                        passwordInput.dispatchEvent(new KeyboardEvent('keyup', {
                            key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                            bubbles: true, cancelable: true
                        }));
                    } catch (_) {}
                }
            }, getSettings().passwordToSubmitDelay);
        }, getSettings().usernameToPasswordDelay);

        return true;
    }

    // =============================================================
    // DPS 登录：账号/密码自动填；验证码人工输入；第 4 位后自动登录
    // =============================================================

    function findDPSVisibleInRoot(root, selectors) {
        if (!root) return null;
        for (const selector of selectors) {
            let elements = [];
            try {
                elements = root.querySelectorAll(selector);
            } catch (_) {
                continue;
            }
            for (const element of elements) {
                if (isVisible(element)) return element;
            }
        }
        return null;
    }

    function getDPSVisibleInputs(root) {
        if (!root) return [];
        return [...root.querySelectorAll('input')].filter(input => {
            if (!isVisible(input)) return false;
            const type = String(input.type || 'text').toLowerCase();
            return !['hidden', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image', 'range', 'color'].includes(type);
        });
    }

    function findDPSUsernameInput(root = document) {
        // 第一优先级：明确的账号语义。
        return findDPSVisibleInRoot(root, [
            'input[placeholder*="账号"]',
            'input[placeholder*="帐号"]',
            'input[placeholder*="用户名"]',
            'input[placeholder*="用户"]',
            'input[placeholder*="邮箱"]',
            'input[name*="username" i]',
            'input[name*="userName" i]',
            'input[name*="account" i]',
            'input[name*="login" i]',
            'input[name*="email" i]',
            'input[id*="username" i]',
            'input[id*="userName" i]',
            'input[id*="account" i]',
            'input[id*="login" i]',
            'input[id*="email" i]',
            'input[autocomplete="username"]'
        ]);
    }

    function findDPSCaptchaInput(root = document) {
        // 第一优先级：明确的验证码语义。
        return findDPSVisibleInRoot(root, [
            'input[placeholder*="验证码"]',
            'input[placeholder*="校验码"]',
            'input[placeholder*="图形码"]',
            'input[name*="captcha" i]',
            'input[id*="captcha" i]',
            'input[name*="verify" i]',
            'input[id*="verify" i]',
            'input[name*="verification" i]',
            'input[id*="verification" i]',
            'input[name*="code" i]',
            'input[id*="code" i]'
        ]);
    }

    function findDPSLoginButton(root = document) {
        const candidates = root.querySelectorAll(
            'button,a,[role="button"],input[type="submit"],input[type="button"],.el-button,.ant-btn,.ivu-btn,.arco-btn,div,span'
        );
        for (const element of candidates) {
            if (!isVisible(element)) continue;
            if (normalizeText(element.innerText || element.textContent || element.value) !== '登录') continue;
            return element.closest(
                'button,a,[role="button"],input[type="submit"],input[type="button"],.el-button,.ant-btn,.ivu-btn,.arco-btn'
            ) || element;
        }
        return null;
    }

    function findDPSEnterButton() {
        // DPS 欢迎页真实 DOM：
        // <button class="enter-btn" type="button"><span>进入平台</span>...</button>
        // 优先按真实 class 精确命中，避免文字查找受图标/翻译插件/额外节点影响。
        const directSelectors = [
            '.platform-login-page button.enter-btn',
            '.platform-login-page .enter-btn',
            '.welcome-panel button.enter-btn',
            'button.enter-btn'
        ];

        for (const selector of directSelectors) {
            const element = document.querySelector(selector);
            if (element && isVisible(element)) return element;
        }

        // DOM class 将来变化时的文字兜底，只接受真正可点击元素。
        const candidates = document.querySelectorAll(
            'button,a,[role="button"],input[type="button"],input[type="submit"]'
        );
        for (const element of candidates) {
            if (!isVisible(element)) continue;
            if (normalizeText(element.innerText || element.textContent || element.value) !== '进入平台') continue;
            return element;
        }

        return null;
    }

    function tryEnterDPSPlatform() {
        const enterButton = findDPSEnterButton();
        if (!enterButton) return false;

        // 找到了欢迎页按钮，即使处于冷却期也返回 true，
        // 防止后续把欢迎页误当作登录表单继续处理。
        if (Date.now() - dpsEnterClickedAt < getSettings().dpsEnterCooldown) return true;

        dpsEnterClickedAt = Date.now();
        log('检测到 DPS 欢迎页，精确点击 .enter-btn');

        try {
            // Vue 原生 button 的 click() 最稳定；不依赖坐标，也不受遮罩层影响。
            enterButton.focus?.({ preventScroll: true });
            enterButton.click();
        } catch (error) {
            warn('DPS “进入平台”直接点击失败，使用鼠标事件兜底', error);
            try {
                enterButton.dispatchEvent(new MouseEvent('mousedown', {
                    bubbles: true, cancelable: true, view: window
                }));
                enterButton.dispatchEvent(new MouseEvent('mouseup', {
                    bubbles: true, cancelable: true, view: window
                }));
                enterButton.dispatchEvent(new MouseEvent('click', {
                    bubbles: true, cancelable: true, view: window
                }));
            } catch (fallbackError) {
                warn('DPS “进入平台”鼠标事件兜底失败', fallbackError);
            }
        }

        return true;
    }

    function getDPSLoginUI() {
        // 云程平台只在 /login 页面识别登录 UI；业务页面绝不扫描账号/密码/验证码控件。
        if (!isRealLoginPage(currentSystem)) return null;

        // 核心原则：先用“密码框 + 登录按钮 + 小型局部表单”确认这里确实像登录区，
        // 再允许在这个局部容器内做顺序兜底。
        const passwords = [...document.querySelectorAll('input[type="password"]')].filter(isVisible);

        for (const passwordInput of passwords) {
            let root = passwordInput.parentElement;
            let depth = 0;

            while (root && root !== document.body && root !== document.documentElement && depth < 14) {
                const loginButton = findDPSLoginButton(root);
                const visibleInputs = getDPSVisibleInputs(root);
                const passwordInputs = visibleInputs.filter(el => String(el.type || '').toLowerCase() === 'password');

                // 登录区域通常只有 3 个左右输入框。限制数量和密码框个数，避免业务配置大表单误判。
                const looksLikeCompactLoginForm =
                    loginButton &&
                    visibleInputs.length >= 2 &&
                    visibleInputs.length <= 6 &&
                    passwordInputs.length === 1 &&
                    passwordInputs[0] === passwordInput;

                if (looksLikeCompactLoginForm) {
                    let usernameInput = findDPSUsernameInput(root);
                    let captchaInput = findDPSCaptchaInput(root);

                    // 如果页面没有明确 placeholder/name，仅在已确认的登录小表单内部按顺序兜底。
                    const passwordIndex = visibleInputs.indexOf(passwordInput);

                    if (!usernameInput) {
                        const beforePassword = visibleInputs.slice(0, Math.max(0, passwordIndex)).filter(el => {
                            const type = String(el.type || 'text').toLowerCase();
                            return el !== passwordInput && ['text', 'email', 'tel', ''].includes(type);
                        });
                        usernameInput = beforePassword[beforePassword.length - 1] || null;
                    }

                    if (!captchaInput) {
                        const afterPassword = visibleInputs.slice(passwordIndex + 1).filter(el => {
                            const type = String(el.type || 'text').toLowerCase();
                            if (el === usernameInput || el === passwordInput) return false;
                            return ['text', 'tel', 'number', ''].includes(type);
                        });

                        // 优先选择 maxlength=4/6 的输入框；否则选密码框之后的最后一个普通输入框。
                        captchaInput = afterPassword.find(el => ['4', '6'].includes(String(el.maxLength > 0 ? el.maxLength : el.getAttribute('maxlength') || '')))
                            || afterPassword[afterPassword.length - 1]
                            || null;
                    }

                    if (
                        usernameInput &&
                        captchaInput &&
                        usernameInput !== passwordInput &&
                        captchaInput !== passwordInput &&
                        captchaInput !== usernameInput
                    ) {
                        return { root, usernameInput, passwordInput, captchaInput, loginButton };
                    }
                }

                root = root.parentElement;
                depth += 1;
            }
        }

        // /login 已经是强 URL 指纹，因此当页面结构变化、局部父容器识别失败时，
        // 允许仅在该页面做一次全页兜底，避免验证码输入完成后因 DOM 层级变化找不到登录按钮。
        const passwordInput = passwords[0] || null;
        const loginButton = findDPSLoginButton(document);
        if (!passwordInput || !loginButton) return null;

        const visibleInputs = getDPSVisibleInputs(document);
        const passwordIndex = visibleInputs.indexOf(passwordInput);
        let usernameInput = findDPSUsernameInput(document);
        let captchaInput = findDPSCaptchaInput(document);

        if (!usernameInput && passwordIndex > 0) {
            const beforePassword = visibleInputs.slice(0, passwordIndex).filter(el => {
                const type = String(el.type || 'text').toLowerCase();
                return el !== passwordInput && ['text', 'email', 'tel', ''].includes(type);
            });
            usernameInput = beforePassword[beforePassword.length - 1] || null;
        }

        if (!captchaInput && passwordIndex >= 0) {
            const afterPassword = visibleInputs.slice(passwordIndex + 1).filter(el => {
                const type = String(el.type || 'text').toLowerCase();
                if (el === usernameInput || el === passwordInput) return false;
                return ['text', 'tel', 'number', ''].includes(type);
            });
            captchaInput = afterPassword.find(el => ['4', '6'].includes(String(el.maxLength > 0 ? el.maxLength : el.getAttribute('maxlength') || '')))
                || afterPassword[afterPassword.length - 1]
                || null;
        }

        if (!usernameInput || !captchaInput || captchaInput === usernameInput || captchaInput === passwordInput) return null;
        return { root: document, usernameInput, passwordInput, captchaInput, loginButton };
    }

    function submitDPSLogin() {
        if (!isRealLoginPage(currentSystem)) return;

        clearTimeout(dpsSubmitTimer);
        let readinessStartedAt = 0;

        const trySubmit = () => {
            if (!isRealLoginPage(currentSystem)) return;

            const now = Date.now();
            if (now - dpsLastSubmitTime < 1500) return;

            const ui = getDPSLoginUI();
            if (!ui) return;

            const { captchaInput, loginButton } = ui;
            const captchaValue = String(captchaInput.value || '').trim();
            if (captchaValue.length !== 4) return;

            // 先补一次 change + blur，让只在失焦时校验验证码的组件完成状态同步。
            // 这一步放在按钮可用性判断之前，否则某些“失焦后才启用登录按钮”的页面会一直等不到按钮解锁。
            try {
                captchaInput.dispatchEvent(new Event('change', { bubbles: true }));
                captchaInput.blur();
            } catch (_) {}

            if (!readinessStartedAt) readinessStartedAt = Date.now();

            // 某些前端会在 input/change 事件后稍晚才把按钮状态更新为可提交。
            // 最多等待约 1.8 秒；这期间每 80ms 重新获取最新 DOM，避免 Vue/React 重渲染导致旧引用失效。
            const disabled = !!(
                loginButton.disabled ||
                loginButton.getAttribute?.('disabled') !== null ||
                loginButton.getAttribute?.('aria-disabled') === 'true' ||
                loginButton.classList?.contains('is-disabled') ||
                loginButton.classList?.contains('disabled')
            );

            if (disabled && Date.now() - readinessStartedAt < 1800) {
                dpsSubmitTimer = setTimeout(trySubmit, 80);
                return;
            }

            dpsLastSubmitTime = Date.now();
            log('验证码已输入 4 位，自动点击登录');

            try {
                // 云程登录页优先直接 click()，避免额外鼠标事件干扰框架自身的按钮处理。
                loginButton.focus?.({ preventScroll: true });
                loginButton.click();
                return;
            } catch (error) {
                warn('DPS 登录按钮直接点击失败，尝试表单提交', error);
            }

            const form = loginButton.closest?.('form') || captchaInput.closest('form');
            if (form) {
                try {
                    if (typeof form.requestSubmit === 'function') form.requestSubmit(loginButton.matches?.('button,input[type="submit"]') ? loginButton : undefined);
                    else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                    return;
                } catch (_) {}
            }

            // 最后兜底：在验证码框上模拟 Enter。
            try {
                captchaInput.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                    bubbles: true, cancelable: true
                }));
                captchaInput.dispatchEvent(new KeyboardEvent('keyup', {
                    key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                    bubbles: true, cancelable: true
                }));
            } catch (_) {}
        };

        dpsSubmitTimer = setTimeout(trySubmit, getSettings().captchaSubmitDelay);
    }

    function handleDPSLogin(system, account) {
        // 云程自动登录严格限制在 /login；离开登录页后不读取、不聚焦、不修改任何输入框。
        if (!isRealLoginPage(system)) return false;

        const ui = getDPSLoginUI();
        if (!ui) return false;

        const { usernameInput, passwordInput, captchaInput } = ui;

        if (usernameInput.value !== account.username) setInputValue(usernameInput, account.username);
        if (passwordInput.value !== account.password) setInputValue(passwordInput, account.password);

        if (!captchaInput.value && document.activeElement !== captchaInput) captchaInput.focus();
        if (String(captchaInput.value || '').trim().length === 4) submitDPSLogin();
        return false;
    }

    // 使用 document 捕获阶段监听，避免验证码组件重渲染后监听失效。
    function handleDPSCaptchaChanged(event) {
        if (currentSystem.type !== 'dps' || !isRealLoginPage(currentSystem)) return;
        if (!(event.target instanceof HTMLInputElement)) return;

        const ui = getDPSLoginUI();
        if (!ui || event.target !== ui.captchaInput) return;

        if (String(ui.captchaInput.value || '').trim().length === 4) submitDPSLogin();
    }

    document.addEventListener('input', handleDPSCaptchaChanged, true);
    document.addEventListener('keyup', event => {
        if (event.key === 'Enter') return;
        handleDPSCaptchaChanged(event);
    }, true);
    document.addEventListener('change', handleDPSCaptchaChanged, true);

    document.addEventListener('keydown', event => {
        if (currentSystem.type !== 'dps' || !isRealLoginPage(currentSystem) || event.key !== 'Enter') return;
        if (!(event.target instanceof HTMLInputElement)) return;

        const ui = getDPSLoginUI();
        if (!ui) return;
        if (event.target === ui.captchaInput && String(ui.captchaInput.value || '').trim().length === 4) submitDPSLogin();
    }, true);

    // =============================================================
    // 总登录入口
    // =============================================================

    function checkLogin() {
        if (!isEnabled()) return;

        // 云程平台只在精确 /login 页面运行自动登录；其他业务 URL 直接退出。
        if (currentSystem.type === 'dps') {
            if (!isRealLoginPage(currentSystem)) return;
            if (tryEnterDPSPlatform()) return;

            const account = getActiveAccount();
            if (!account) return;

            handleDPSLogin(currentSystem, account);
            return;
        }

        const account = getActiveAccount();
        if (!account) return;

        if (loggingIn) return;
        const now = Date.now();
        if (now - lastAttempt < getSettings().loginCooldown) return;

        let detected = false;
        if (currentSystem.type === 'standard') detected = handleStandardLogin(currentSystem, account);
        else if (currentSystem.type === 'fineui') detected = handleFineUILogin(currentSystem, account);

        if (detected) {
            loggingIn = true;
            lastAttempt = now;
            setTimeout(() => { loggingIn = false; }, 3500);
        }
    }

    // =============================================================
    // 初始化 / 精简油猴菜单
    // =============================================================

    migrateLegacyAccount();

    const activeMenuAccount = getActiveAccount();
    GM_registerMenuCommand(
        `🔄 切换账号${activeMenuAccount ? `（${activeMenuAccount.name}）` : ''}`,
        switchAccount
    );
    GM_registerMenuCommand('⚙ 账号与自动登录设置', openSettingsPanel);

    log(`已启动：${currentSystem.name}`);

    [250, 700, 1500, 3000].forEach(delay => setTimeout(checkLogin, delay));

    const observer = new MutationObserver(() => {
        clearTimeout(mutationTimer);
        mutationTimer = setTimeout(checkLogin, 120);
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
    });

    setInterval(checkLogin, CHECK_INTERVAL);
})();
