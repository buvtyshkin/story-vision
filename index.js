// Story Vision — визуализация сцен Fisher Universe.
// Итерация 1: библиотека референсов + каст чата + скелет настроек.

import { openLibrary } from './ui.js';

export const MODULE = 'storyVision';

export const defaultSettings = {
    refs: [],              // библиотека: [{id, tag, aliases[], arc, note, path, priority}]
    apiKey: '',            // ключ NanoGPT (для Image API, итерация 2)
    prompterProfile: '',   // id Connection Profile для промптера (итерация 2)
    contextDepth: 8,       // сколько последних сообщений видит промптер
    fullContext: false,    // тумблер «весь контекст»
};

export function getCtx() {
    return SillyTavern.getContext();
}

export function getSettings() {
    const ctx = getCtx();
    if (!ctx.extensionSettings[MODULE]) {
        ctx.extensionSettings[MODULE] = structuredClone(defaultSettings);
    }
    // Доливаем новые ключи при обновлении расширения.
    for (const key of Object.keys(defaultSettings)) {
        if (ctx.extensionSettings[MODULE][key] === undefined) {
            ctx.extensionSettings[MODULE][key] = structuredClone(defaultSettings[key]);
        }
    }
    return ctx.extensionSettings[MODULE];
}

export function saveSettings() {
    getCtx().saveSettingsDebounced();
}

// ---- Метаданные чата (каст) ----

function getChatMetadataRoot() {
    const ctx = getCtx();
    return ctx.chatMetadata ?? window.chat_metadata ?? {};
}

export function getChatData() {
    const meta = getChatMetadataRoot();
    if (!meta[MODULE]) {
        meta[MODULE] = { cast: {}, arc: '' };
    }
    if (!meta[MODULE].cast) meta[MODULE].cast = {};
    return meta[MODULE];
}

export function saveChatData() {
    const ctx = getCtx();
    if (typeof ctx.saveMetadataDebounced === 'function') {
        ctx.saveMetadataDebounced();
    } else if (typeof ctx.saveMetadata === 'function') {
        ctx.saveMetadata();
    }
}

export function esc(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
}

// ---- UI: кнопка в wand-меню ----

function addWandButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('storyvision_wand')) return;

    const item = document.createElement('div');
    item.id = 'storyvision_wand';
    item.classList.add('list-group-item', 'flex-container', 'flexGap5', 'interactable');
    item.tabIndex = 0;
    item.innerHTML = `<i class="fa-solid fa-images"></i><span>Story Vision</span>`;
    item.addEventListener('click', () => openLibrary());
    menu.appendChild(item);
}

// ---- UI: панель настроек ----

function addSettingsPanel() {
    const holder = document.getElementById('extensions_settings2')
        ?? document.getElementById('extensions_settings');
    if (!holder || document.getElementById('storyvision_settings')) return;

    const s = getSettings();
    const wrapper = document.createElement('div');
    wrapper.id = 'storyvision_settings';
    wrapper.innerHTML = `
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Story Vision</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <label for="sv_api_key">NanoGPT API key (Image API)</label>
            <input id="sv_api_key" class="text_pole" type="password"
                   placeholder="ключ для генерации изображений" value="${esc(s.apiKey)}">

            <label for="sv_profile">Профиль промптера (Connection Profile)</label>
            <select id="sv_profile" class="text_pole"></select>

            <label for="sv_depth">Глубина контекста промптера:
                <span id="sv_depth_value">${s.contextDepth}</span> сообщений</label>
            <input id="sv_depth" type="range" min="2" max="40" step="1" value="${s.contextDepth}">

            <label class="checkbox_label" for="sv_full_context">
                <input id="sv_full_context" type="checkbox" ${s.fullContext ? 'checked' : ''}>
                <span>Отправлять промптеру весь контекст чата</span>
            </label>

            <div class="menu_button" id="sv_open_library" style="margin-top:8px;">
                <i class="fa-solid fa-images"></i> Библиотека референсов
            </div>
            <small class="sv-hint">Промптер и генерация подключаются в итерации 2 —
            пока настройки просто сохраняются.</small>
        </div>
    </div>`;
    holder.appendChild(wrapper);

    fillProfileSelect(wrapper.querySelector('#sv_profile'));

    wrapper.querySelector('#sv_api_key').addEventListener('input', (e) => {
        getSettings().apiKey = e.target.value.trim();
        saveSettings();
    });
    wrapper.querySelector('#sv_profile').addEventListener('change', (e) => {
        getSettings().prompterProfile = e.target.value;
        saveSettings();
    });
    wrapper.querySelector('#sv_depth').addEventListener('input', (e) => {
        const val = Number(e.target.value);
        getSettings().contextDepth = val;
        wrapper.querySelector('#sv_depth_value').textContent = val;
        saveSettings();
    });
    wrapper.querySelector('#sv_full_context').addEventListener('change', (e) => {
        getSettings().fullContext = e.target.checked;
        saveSettings();
    });
    wrapper.querySelector('#sv_open_library').addEventListener('click', () => openLibrary());
}

function fillProfileSelect(select) {
    if (!select) return;
    const ctx = getCtx();
    const profiles = ctx.extensionSettings?.connectionManager?.profiles ?? [];
    const current = getSettings().prompterProfile;

    select.innerHTML = '<option value="">— не выбран —</option>';
    for (const p of profiles) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name ?? p.id;
        if (p.id === current) opt.selected = true;
        select.appendChild(opt);
    }
}

// ---- Инициализация ----

jQuery(async () => {
    getSettings();
    addWandButton();
    addSettingsPanel();

    const ctx = getCtx();
    const eventTypes = ctx.eventTypes ?? ctx.event_types;
    // При смене чата ничего пересоздавать не нужно: каст читается лениво
    // из chatMetadata в момент открытия попапа. Хук оставлен на будущее.
    if (ctx.eventSource && eventTypes?.CHAT_CHANGED) {
        ctx.eventSource.on(eventTypes.CHAT_CHANGED, () => {});
    }

    console.log('[StoryVision] loaded');
});
