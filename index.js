// Story Vision — визуализация сцен Fisher Universe.
// Итерация 1: библиотека референсов + каст чата + скелет настроек.

import { openLibrary, openGenerateDialog, openChatGallery } from './ui.js';

export const MODULE = 'storyVision';

export const defaultSettings = {
    refs: [],              // библиотека: [{id, tag, aliases[], arc, note, path, priority}]
    apiKey: '',            // ключ NanoGPT (для Image API, итерация 2)
    prompterProfile: '',   // id Connection Profile для промптера (итерация 2)
    contextDepth: 8,       // сколько последних сообщений видит промптер
    fullContext: false,    // тумблер «весь контекст»
    autoAttach: true,      // клеить картинку к последнему сообщению автоматически
    blockChatImages: true, // вырезать image-части из запросов к основной модели
    lastModel: '',         // последняя выбранная модель генерации
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

    const generateItem = document.createElement('div');
    generateItem.id = 'storyvision_wand_generate';
    generateItem.classList.add('list-group-item', 'flex-container', 'flexGap5', 'interactable');
    generateItem.tabIndex = 0;
    generateItem.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i><span>SV: Сцена</span>`;
    generateItem.addEventListener('click', () => openGenerateDialog());
    menu.appendChild(generateItem);

    const item = document.createElement('div');
    item.id = 'storyvision_wand';
    item.classList.add('list-group-item', 'flex-container', 'flexGap5', 'interactable');
    item.tabIndex = 0;
    item.innerHTML = `<i class="fa-solid fa-images"></i><span>SV: Референсы</span>`;
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

            <label class="checkbox_label" for="sv_auto_attach">
                <input id="sv_auto_attach" type="checkbox" ${s.autoAttach ? 'checked' : ''}>
                <span>Автоматически прикреплять картинку к последнему сообщению</span>
            </label>

            <label class="checkbox_label" for="sv_block_images">
                <input id="sv_block_images" type="checkbox" ${s.blockChatImages ? 'checked' : ''}>
                <span>Не отправлять картинки чата основной модели (страховка контекста)</span>
            </label>

            <div class="menu_button" id="sv_open_library" style="margin-top:8px;">
                <i class="fa-solid fa-images"></i> Библиотека референсов
            </div>
            <div class="menu_button" id="sv_open_gallery" style="margin-top:4px;">
                <i class="fa-solid fa-layer-group"></i> Галерея этого чата
            </div>
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
    wrapper.querySelector('#sv_auto_attach').addEventListener('change', (e) => {
        getSettings().autoAttach = e.target.checked;
        saveSettings();
    });
    wrapper.querySelector('#sv_block_images').addEventListener('change', (e) => {
        getSettings().blockChatImages = e.target.checked;
        saveSettings();
    });
    wrapper.querySelector('#sv_open_library').addEventListener('click', () => openLibrary());
    wrapper.querySelector('#sv_open_gallery').addEventListener('click', () => openChatGallery());
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

    // Страховка контекста: при media_inlining картинки из сообщений уезжают
    // в основную модель (inline_image это НЕ контролирует — флаг чисто про UI).
    // Вырезаем image-части из готового промпта перед отправкой.
    if (ctx.eventSource && eventTypes?.CHAT_COMPLETION_PROMPT_READY) {
        ctx.eventSource.on(eventTypes.CHAT_COMPLETION_PROMPT_READY, (eventData) => {
            if (!getSettings().blockChatImages) return;
            if (!Array.isArray(eventData?.chat)) return;
            let stripped = 0;
            for (const msg of eventData.chat) {
                if (!Array.isArray(msg?.content)) continue;
                const kept = msg.content.filter(part =>
                    part?.type !== 'image_url' && part?.type !== 'video_url' && part?.type !== 'input_audio');
                if (kept.length !== msg.content.length) {
                    stripped += msg.content.length - kept.length;
                    msg.content = kept.length ? kept : [{ type: 'text', text: '' }];
                }
            }
            if (stripped > 0) {
                console.debug(`[StoryVision] Вырезано media-частей из промпта: ${stripped}`);
            }
        });
    }

    console.log('[StoryVision] loaded');
});
