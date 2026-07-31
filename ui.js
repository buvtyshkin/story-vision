// Story Vision — интерфейс. Всё на нативном Popup Таверны.

import { getCtx, getChatData, saveChatData, esc, getSettings, saveSettings } from './index.js';
import {
    getRefs, getRefById, addRef, updateRef, deleteRef,
    resizeImageFile, uploadImage, setCast, removeFromCast,
    resolveMany, refToDataUrl,
} from './refs.js';
import { runPrompter, STYLE_PRESETS, getStyleById, runRefPrompter } from './prompter.js';
import { fetchImageModels, generateImage, getModelHints, fetchModelPricing } from './imagegen.js';
import {
    persistGeneratedImage, attachToMessage, findLastMessageId,
    getGallery, addToGallery, clearGallery, stripImagesFromChat,
} from './chatimg.js';

function popupApi() {
    const ctx = getCtx();
    return { callGenericPopup: ctx.callGenericPopup, POPUP_TYPE: ctx.POPUP_TYPE };
}

// ---- Главный попап: каст чата + библиотека ----

export async function openLibrary() {
    const { callGenericPopup, POPUP_TYPE } = popupApi();
    const container = document.createElement('div');
    container.classList.add('sv-library');

    const render = () => {
        const chatData = getChatData();
        const refs = getRefs();

        const castEntries = Object.entries(chatData.cast)
            .map(([name, refId]) => ({ name, ref: getRefById(refId) }))
            .filter(e => e.ref);

        container.innerHTML = `
        <div class="sv-section">
            <div class="sv-section-title">
                <i class="fa-solid fa-clapperboard"></i> Каст этого чата
            </div>
            <div class="sv-arc-row">
                <label>Арка чата:</label>
                <input id="sv_arc_input" class="text_pole" type="text"
                       placeholder="напр. LA-2007" value="${esc(chatData.arc ?? '')}">
            </div>
            <div class="sv-cast-list">
                ${castEntries.length === 0
                    ? '<div class="sv-empty">Каст пуст. Добавь персонажей из библиотеки ниже — кнопка «В каст».</div>'
                    : castEntries.map(e => `
                        <div class="sv-cast-item" data-name="${esc(e.name)}">
                            <img src="${esc(e.ref.path)}" alt="">
                            <div class="sv-cast-info">
                                <b>${esc(e.name)}</b>
                                <small>${esc(e.ref.tag)}${e.ref.arc ? ' · ' + esc(e.ref.arc) : ''}</small>
                            </div>
                            <div class="menu_button sv-cast-remove" title="Убрать из каста">
                                <i class="fa-solid fa-xmark"></i>
                            </div>
                        </div>`).join('')}
            </div>
        </div>

        <div class="sv-section">
            <div class="sv-section-title">
                <i class="fa-solid fa-images"></i> Библиотека референсов
                <div class="menu_button sv-gen-ref-btn"><i class="fa-solid fa-wand-magic-sparkles"></i> Сгенерировать</div>
                <div class="menu_button sv-add-ref"><i class="fa-solid fa-plus"></i> Добавить</div>
            </div>
            <div class="sv-grid">
                ${refs.length === 0
                    ? '<div class="sv-empty">Библиотека пуста. Загрузи первый референс.</div>'
                    : refs.map(r => `
                        <div class="sv-card" data-id="${esc(r.id)}">
                            <img src="${esc(r.path)}" alt="">
                            <div class="sv-card-body">
                                <b>${esc(r.tag)}</b>
                                ${r.arc ? `<span class="sv-badge">${esc(r.arc)}</span>` : ''}
                                ${r.note ? `<small>${esc(r.note)}</small>` : ''}
                            </div>
                            <div class="sv-card-actions">
                                <div class="menu_button sv-to-cast" title="В каст этого чата">
                                    <i class="fa-solid fa-user-plus"></i>
                                </div>
                                <div class="menu_button sv-edit" title="Редактировать">
                                    <i class="fa-solid fa-pen"></i>
                                </div>
                                <div class="menu_button sv-delete" title="Удалить">
                                    <i class="fa-solid fa-trash"></i>
                                </div>
                            </div>
                        </div>`).join('')}
            </div>
        </div>`;

        bind();
    };

    const bind = () => {
        container.querySelector('#sv_arc_input')?.addEventListener('change', (e) => {
            getChatData().arc = e.target.value.trim();
            saveChatData();
        });

        container.querySelector('.sv-add-ref')?.addEventListener('click', async () => {
            const created = await editRefDialog(null);
            if (created) render();
        });

        container.querySelector('.sv-gen-ref-btn')?.addEventListener('click', async () => {
            await openRefGenerator();
            render(); // библиотека могла пополниться
        });

        container.querySelectorAll('.sv-cast-item .sv-cast-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                const name = btn.closest('.sv-cast-item').dataset.name;
                removeFromCast(name);
                render();
            });
        });

        container.querySelectorAll('.sv-card').forEach(card => {
            const id = card.dataset.id;
            card.querySelector('.sv-to-cast').addEventListener('click', async () => {
                const ref = getRefById(id);
                if (!ref) return;
                const name = await promptCastName(ref);
                if (name) {
                    setCast(name, id);
                    render();
                }
            });
            card.querySelector('.sv-edit').addEventListener('click', async () => {
                const changed = await editRefDialog(getRefById(id));
                if (changed) render();
            });
            card.querySelector('.sv-delete').addEventListener('click', async () => {
                const { callGenericPopup, POPUP_TYPE } = popupApi();
                const ref = getRefById(id);
                const confirmed = await callGenericPopup(
                    `Удалить референс «${esc(ref?.tag ?? '')}» из библиотеки?`,
                    POPUP_TYPE.CONFIRM,
                );
                if (confirmed) {
                    deleteRef(id);
                    render();
                }
            });
        });
    };

    render();
    await callGenericPopup(container, POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        okButton: 'Закрыть',
        allowVerticalScrolling: true,
    });
}

// ---- Диалог добавления/редактирования рефа ----

async function editRefDialog(existing) {
    const { callGenericPopup, POPUP_TYPE } = popupApi();
    const isNew = !existing;

    const form = document.createElement('div');
    form.classList.add('sv-form');
    form.innerHTML = `
        <h4>${isNew ? 'Новый референс' : 'Редактирование референса'}</h4>

        <div class="sv-form-preview">
            <img id="sv_form_preview" src="${existing ? esc(existing.path) : ''}"
                 style="${existing ? '' : 'display:none;'}" alt="">
            <div class="menu_button" id="sv_pick_file">
                <i class="fa-solid fa-upload"></i> ${isNew ? 'Выбрать изображение' : 'Заменить изображение'}
            </div>
            <input id="sv_file_input" type="file" accept="image/*" style="display:none;">
        </div>

        <label>Тег (каноническое имя)</label>
        <input id="sv_form_tag" class="text_pole" type="text"
               placeholder="Nick, Angelina, Loft..." value="${esc(existing?.tag ?? '')}">

        <label>Алиасы (через запятую)</label>
        <input id="sv_form_aliases" class="text_pole" type="text"
               placeholder="Анджелина, Энджи, Джоли"
               value="${esc(existing?.aliases?.join(', ') ?? '')}">

        <label>Арка (необязательно)</label>
        <input id="sv_form_arc" class="text_pole" type="text"
               placeholder="LA-2007" value="${esc(existing?.arc ?? '')}">

        <label>Сходство (для промпта: «closely resembling …»)</label>
        <input id="sv_form_resemblance" class="text_pole" type="text"
               placeholder="actress Angelina Jolie circa 2000"
               value="${esc(existing?.resemblance ?? '')}">

        <label>Заметка</label>
        <input id="sv_form_note" class="text_pole" type="text"
               placeholder="гала, вечернее платье" value="${esc(existing?.note ?? '')}">

        <label>Приоритет (1 — выше)</label>
        <input id="sv_form_priority" class="text_pole" type="number" min="1" max="99"
               value="${esc(existing?.priority ?? 1)}">
    `;

    let pendingDataUrl = null;
    let pendingFileName = null;

    const fileInput = form.querySelector('#sv_file_input');
    form.querySelector('#sv_pick_file').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        try {
            pendingDataUrl = await resizeImageFile(file);
            pendingFileName = file.name.replace(/\.[^.]+$/, '');
            const preview = form.querySelector('#sv_form_preview');
            preview.src = pendingDataUrl;
            preview.style.display = '';
        } catch (error) {
            toastr.error(error.message, 'Story Vision');
        }
    });

    const confirmed = await callGenericPopup(form, POPUP_TYPE.CONFIRM, '', {
        okButton: 'Сохранить',
        cancelButton: 'Отмена',
        wide: false,
        allowVerticalScrolling: true,
    });
    if (!confirmed) return false;

    const tag = form.querySelector('#sv_form_tag').value.trim();
    if (!tag) {
        toastr.warning('Тег обязателен — без него реф не найти.', 'Story Vision');
        return false;
    }
    if (isNew && !pendingDataUrl) {
        toastr.warning('Изображение не выбрано.', 'Story Vision');
        return false;
    }

    try {
        let path = existing?.path;
        if (pendingDataUrl) {
            path = await uploadImage(pendingDataUrl, pendingFileName ?? tag);
        }
        const fields = {
            tag,
            aliases: form.querySelector('#sv_form_aliases').value,
            arc: form.querySelector('#sv_form_arc').value,
            note: form.querySelector('#sv_form_note').value,
            resemblance: form.querySelector('#sv_form_resemblance').value,
            priority: form.querySelector('#sv_form_priority').value,
            path,
        };
        if (isNew) {
            addRef(fields);
            toastr.success(`Референс «${tag}» добавлен.`, 'Story Vision');
        } else {
            updateRef(existing.id, fields);
            toastr.success(`Референс «${tag}» обновлён.`, 'Story Vision');
        }
        return true;
    } catch (error) {
        toastr.error(error.message, 'Story Vision');
        return false;
    }
}

// ---- Имя персонажа при добавлении в каст ----

async function promptCastName(ref) {
    const { callGenericPopup, POPUP_TYPE } = popupApi();
    const result = await callGenericPopup(
        `Под каким именем закрепить «${esc(ref.tag)}» в касте этого чата?<br>
         <small>Это имя будет сопоставляться с персонажами из сцены.</small>`,
        POPUP_TYPE.INPUT,
        ref.tag,
    );
    return typeof result === 'string' ? result.trim() : null;
}

// ---- Выбор из нескольких кандидатов (используется в итерации 2) ----

export async function pickCandidate(name, candidates) {
    const { callGenericPopup, POPUP_TYPE } = popupApi();
    const container = document.createElement('div');
    container.classList.add('sv-picker');
    container.innerHTML = `
        <h4>Кто такой «${esc(name)}» в этом чате?</h4>
        <div class="sv-grid">
            ${candidates.map(r => `
                <div class="sv-card sv-pick" data-id="${esc(r.id)}">
                    <img src="${esc(r.path)}" alt="">
                    <div class="sv-card-body">
                        <b>${esc(r.tag)}</b>
                        ${r.arc ? `<span class="sv-badge">${esc(r.arc)}</span>` : ''}
                        ${r.note ? `<small>${esc(r.note)}</small>` : ''}
                    </div>
                </div>`).join('')}
        </div>
        <label class="checkbox_label">
            <input id="sv_pick_remember" type="checkbox" checked>
            <span>Закрепить выбор в касте чата</span>
        </label>`;

    return new Promise((resolve) => {
        let chosen = null;
        container.querySelectorAll('.sv-pick').forEach(card => {
            card.addEventListener('click', () => {
                chosen = getRefById(card.dataset.id);
                const remember = container.querySelector('#sv_pick_remember').checked;
                if (chosen && remember) setCast(name, chosen.id);
                // Закрываем попап программно: жмём его ok-кнопку.
                card.closest('dialog')?.querySelector('.popup-button-ok')?.click();
            });
        });
        callGenericPopup(container, POPUP_TYPE.TEXT, '', { okButton: 'Пропустить' })
            .then(() => resolve(chosen));
    });
}

// ============================================================
// Итерация 2: генерация сцены
// ============================================================

// Галерея живёт в chat_metadata (см. chatimg.js) — персистентна и своя у каждой арки.

export async function openGenerateDialog() {
    try {
        await generateFlow();
    } catch (error) {
        console.error('[StoryVision] Сбой пайплайна:', error);
        toastr.error(String(error?.message ?? error), 'Story Vision');
    }
}

async function generateFlow() {
    const { callGenericPopup, POPUP_TYPE } = popupApi();
    console.debug('[StoryVision] Сцена: старт');

    // Фиксируем целевое сообщение СЕЙЧАС — сцена принадлежит этому моменту,
    // даже если за время генерации в чате появятся новые сообщения.
    const targetMesId = findLastMessageId();

    // 1. Промптер.
    const busyToast = toastr.info('Промптер собирает сцену… (DeepSeek может думать до минуты)',
        'Story Vision', { timeOut: 0, extendedTimeOut: 0, tapToDismiss: true });
    let parsed;
    try {
        parsed = await runPrompter();
    } catch (error) {
        toastr.error(error.message, 'Story Vision');
        return;
    } finally {
        toastr.clear(busyToast);
    }
    console.debug('[StoryVision] Промптер вернул:', parsed);

    // 2. Разрешение персонажей в рефы.
    const { resolved, ambiguous, missing } = resolveMany(parsed.characters);
    for (const item of ambiguous) {
        const chosen = await pickCandidate(item.name, item.candidates);
        if (chosen) resolved.push({ name: item.name, ref: chosen, source: 'picked' });
        else missing.push(item.name);
    }

    // 3. Модели.
    let models = [];
    try {
        models = await fetchImageModels();
    } catch (error) {
        toastr.warning(error.message, 'Story Vision');
    }

    // 4. Ревью и генерация.
    await reviewAndGenerate({
        promptBase: parsed.prompt,
        location: parsed.location,
        resolved, missing, models, targetMesId,
        styleId: getChatData().defaultStyle ?? 'cinematic',
        modelId: getSettings().lastModel ?? '',
    });
}

// Попап ревью. Вызывается из generateFlow и из кнопки «Заново» —
// state несёт всё нужное для полного пересбора параметров.
async function reviewAndGenerate(state) {
    const { callGenericPopup, POPUP_TYPE } = popupApi();
    const { resolved, missing, models, targetMesId } = state;
    const settings = getSettings();
    const chatData = getChatData();

    const form = document.createElement('div');
    form.classList.add('sv-generate');
    form.innerHTML = `
        <h4><i class="fa-solid fa-clapperboard"></i> Сцена готова к генерации</h4>
        ${state.location ? `<div class="sv-gen-location">Локация: <b>${esc(state.location)}</b></div>` : ''}

        <label>Промпт (можно править)</label>
        <textarea id="sv_gen_prompt" class="text_pole" rows="7">${esc(state.promptBase)}</textarea>

        <label>Референсы в кадре</label>
        <div class="sv-gen-refs">
            ${resolved.length === 0
                ? '<div class="sv-empty">Рефы не подобрались — генерация пойдёт чисто по тексту.</div>'
                : resolved.map((r, i) => `
                    <label class="sv-gen-ref checkbox_label" data-idx="${i}">
                        <input type="checkbox" checked>
                        <img src="${esc(r.ref.path)}" alt="">
                        <span>${esc(r.name)}</span>
                    </label>`).join('')}
            ${missing.length ? `<div class="sv-gen-missing">Без рефов: ${missing.map(esc).join(', ')}</div>` : ''}
        </div>

        <div class="sv-gen-row">
            <div>
                <label>Модель</label>
                <select id="sv_gen_model" class="text_pole">
                    ${models.length === 0
                        ? '<option value="">— discovery не удался —</option>'
                        : models.map(m => `
                            <option value="${esc(m.id)}" ${m.id === state.modelId ? 'selected' : ''}>
                                ${esc(m.name)}${m.supportsRefs ? ` (refs: ${m.maxRefs})` : ' (без refs)'}
                            </option>`).join('')}
                </select>
                <small id="sv_model_info" class="sv-model-info"></small>
            </div>
            <div>
                <label>Стиль</label>
                <select id="sv_gen_style" class="text_pole">
                    ${STYLE_PRESETS.map(s => `
                        <option value="${esc(s.id)}" ${s.id === state.styleId ? 'selected' : ''}>
                            ${esc(s.label)}
                        </option>`).join('')}
                </select>
            </div>
        </div>`;

    // Инфо-строка модели: качество / цензура / цена (живая цена подгружается лениво).
    const infoEl = form.querySelector('#sv_model_info');
    const modelSelect = form.querySelector('#sv_gen_model');
    const updateModelInfo = async () => {
        const model = models.find(m => m.id === modelSelect.value);
        if (!model) { infoEl.textContent = ''; return; }
        const hints = getModelHints(model);
        infoEl.textContent = `Качество: ${hints.quality} · Цензура: ${hints.censorship} · Цена: ${hints.cost}`;
        const requestedId = model.id;
        const price = await fetchModelPricing(requestedId);
        // Пока грузили цену, пользователь мог переключить модель.
        if (modelSelect.value === requestedId && price !== null) {
            infoEl.textContent = `Качество: ${hints.quality} · Цензура: ${hints.censorship} · Цена: ~$${price.toFixed(3)}/изобр.`;
        }
    };
    modelSelect.addEventListener('change', updateModelInfo);
    updateModelInfo();

    const confirmed = await callGenericPopup(form, POPUP_TYPE.CONFIRM, '', {
        okButton: 'Генерировать',
        cancelButton: 'Отмена',
        wide: true,
        allowVerticalScrolling: true,
    });
    if (!confirmed) return;

    // Сбор параметров.
    const promptBase = form.querySelector('#sv_gen_prompt').value.trim();
    const modelId = modelSelect.value;
    const styleId = form.querySelector('#sv_gen_style').value;
    if (!modelId) {
        toastr.error('Модель не выбрана.', 'Story Vision');
        return;
    }
    settings.lastModel = modelId;
    saveSettings();
    chatData.defaultStyle = styleId;
    saveChatData();

    const modelInfo = models.find(m => m.id === modelId);
    const maxRefs = modelInfo?.maxRefs ?? 0;

    const checkedRefs = [];
    form.querySelectorAll('.sv-gen-ref').forEach(labelEl => {
        if (labelEl.querySelector('input').checked) {
            checkedRefs.push(resolved[Number(labelEl.dataset.idx)]);
        }
    });
    const usedRefs = checkedRefs.slice(0, maxRefs);
    if (checkedRefs.length > maxRefs && maxRefs > 0) {
        toastr.warning(`Модель принимает максимум ${maxRefs} рефов — лишние отброшены.`, 'Story Vision');
    }

    await runGeneration({ ...state, promptBase, modelId, styleId, usedRefs });
}

async function runGeneration(state) {
    const { modelId, promptBase, styleId, usedRefs, targetMesId } = state;
    // Финальный промпт: сцена + маппинг рефов + стиль.
    let prompt = promptBase;
    if (usedRefs.length) {
        const mapping = usedRefs
            .map((r, i) => r.ref.resemblance
                ? `Reference image ${i + 1} shows the person closely resembling ${r.ref.resemblance} (${r.name} in the scene) — match this face and appearance exactly.`
                : `Reference image ${i + 1} shows ${r.name} — match this character's face and appearance exactly.`)
            .join(' ');
        prompt += `\n\n${mapping}`;
    }
    const style = getStyleById(styleId);
    if (style.suffix) prompt += `\n\nStyle: ${style.suffix}`;

    const busyToast = toastr.info('Генерация пошла…', 'Story Vision',
        { timeOut: 0, extendedTimeOut: 0, tapToDismiss: true });
    try {
        const refDataUrls = [];
        for (const r of usedRefs) {
            refDataUrls.push(await refToDataUrl(r.ref));
        }
        const rawSrc = await generateImage({ model: modelId, prompt, refDataUrls });

        // Сохраняем на сервер (data URL или внешний URL -> локальный путь).
        const url = await persistGeneratedImage(rawSrc, 'gen');
        addToGallery({ url, prompt, model: modelId });

        let attached = false;
        if (getSettings().autoAttach) {
            try {
                await attachToMessage(targetMesId, url, prompt);
                attached = true;
            } catch (error) {
                toastr.warning('Не удалось прикрепить к сообщению: ' + error.message, 'Story Vision');
            }
        }

        await showResultPopup({ url, prompt, model: modelId, attached, targetMesId }, state);
    } catch (error) {
        console.error('[StoryVision] Сбой генерации:', error);
        toastr.error(String(error?.message ?? error), 'Story Vision');
    } finally {
        toastr.clear(busyToast);
    }
}

async function showResultPopup(entry, regenParams) {
    const { callGenericPopup, POPUP_TYPE } = popupApi();

    const container = document.createElement('div');
    container.classList.add('sv-result');
    container.innerHTML = `
        <img class="sv-result-img" src="${entry.url}" alt="">
        <div class="sv-result-meta">
            <small>${esc(entry.model)}${entry.attached
                ? ' · <i class="fa-solid fa-paperclip"></i> прикреплено к сообщению'
                : ''}</small>
        </div>
        <div class="sv-result-actions">
            <div class="menu_button" id="sv_res_regen" title="Тот же промпт, модель и стиль — новый бросок">
                <i class="fa-solid fa-rotate"></i> Ещё раз</div>
            <div class="menu_button" id="sv_res_redo" title="Вернуться к выбору модели, стиля и промпта">
                <i class="fa-solid fa-sliders"></i> Заново</div>
            ${entry.attached ? '' : `
                <div class="menu_button" id="sv_res_attach">
                    <i class="fa-solid fa-paperclip"></i> Прикрепить</div>`}
            <a class="menu_button" id="sv_res_download" href="${entry.url}"
               download="storyvision_${Date.now()}.png"><i class="fa-solid fa-download"></i> Скачать</a>
            <div class="menu_button" id="sv_res_gallery"><i class="fa-solid fa-layer-group"></i>
                Галерея (${getGallery().length})</div>
        </div>`;

    let action = null;
    container.querySelector('#sv_res_regen').addEventListener('click', (e) => {
        action = 'regen';
        e.target.closest('dialog')?.querySelector('.popup-button-ok')?.click();
    });
    container.querySelector('#sv_res_redo').addEventListener('click', (e) => {
        action = 'redo';
        e.target.closest('dialog')?.querySelector('.popup-button-ok')?.click();
    });
    container.querySelector('#sv_res_attach')?.addEventListener('click', async (e) => {
        try {
            await attachToMessage(entry.targetMesId, entry.url, entry.prompt);
            toastr.success('Прикреплено.', 'Story Vision');
            e.target.closest('.menu_button').style.display = 'none';
        } catch (error) {
            toastr.error(error.message, 'Story Vision');
        }
    });
    container.querySelector('#sv_res_gallery').addEventListener('click', (e) => {
        action = 'gallery';
        e.target.closest('dialog')?.querySelector('.popup-button-ok')?.click();
    });

    await callGenericPopup(container, POPUP_TYPE.TEXT, '', {
        okButton: 'Закрыть',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    });

    if (action === 'regen' && regenParams) {
        await runGeneration(regenParams);
    } else if (action === 'redo' && regenParams) {
        await reviewAndGenerate(regenParams);
    } else if (action === 'gallery') {
        await openChatGallery();
    }
}

export async function openChatGallery() {
    const { callGenericPopup, POPUP_TYPE } = popupApi();
    const container = document.createElement('div');
    container.classList.add('sv-gallery');

    const render = () => {
        const gallery = getGallery();
        container.innerHTML = `
            <div class="sv-section-title">
                <i class="fa-solid fa-layer-group"></i> Галерея этого чата (${gallery.length})
            </div>
            ${gallery.length === 0
                ? '<div class="sv-empty">В этом чате ещё ничего не сгенерировано.</div>'
                : `<div class="sv-gallery-grid">
                    ${gallery.map(e => `
                        <a href="${e.url}" download="storyvision_${e.time}.png"
                           title="${esc(e.prompt?.slice(0, 200) ?? '')}">
                            <img src="${e.url}" alt="">
                        </a>`).join('')}
                   </div>`}
            <div class="sv-result-actions" style="margin-top:10px;">
                <div class="menu_button" id="sv_gal_strip">
                    <i class="fa-solid fa-broom"></i> Убрать картинки из сообщений</div>
                <div class="menu_button" id="sv_gal_clear">
                    <i class="fa-solid fa-trash"></i> Очистить галерею</div>
            </div>
            <small class="sv-hint">«Убрать из сообщений» снимает картинки Story Vision с сообщений чата,
            галерея при этом остаётся. «Очистить галерею» стирает этот список (файлы на сервере не удаляются).</small>`;

        container.querySelector('#sv_gal_strip').addEventListener('click', async () => {
            const touched = await stripImagesFromChat();
            toastr.success(`Очищено сообщений: ${touched}.`, 'Story Vision');
        });
        container.querySelector('#sv_gal_clear').addEventListener('click', async () => {
            const { callGenericPopup, POPUP_TYPE } = popupApi();
            const confirmed = await callGenericPopup(
                'Очистить галерею этого чата? Файлы на сервере останутся.',
                POPUP_TYPE.CONFIRM,
            );
            if (confirmed) {
                clearGallery();
                render();
            }
        });
    };

    render();
    await callGenericPopup(container, POPUP_TYPE.TEXT, '', {
        okButton: 'Закрыть',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    });
}

// ============================================================
// Генерация референсов
// ============================================================

export async function openRefGenerator(prefillName = '') {
    try {
        await refFlow(prefillName);
    } catch (error) {
        console.error('[StoryVision] Сбой генерации рефа:', error);
        toastr.error(String(error?.message ?? error), 'Story Vision');
    }
}

async function refFlow(prefillName) {
    const { callGenericPopup, POPUP_TYPE } = popupApi();

    const nameInput = await callGenericPopup(
        'Для кого сгенерировать референс?<br><small>Имя персонажа, персоны или NPC из истории — как его зовут в тексте.</small>',
        POPUP_TYPE.INPUT,
        prefillName,
    );
    if (!nameInput || typeof nameInput !== 'string' || !nameInput.trim()) return;
    const targetName = nameInput.trim();

    const busyToast = toastr.info(`Собираю всё о «${targetName}» из контекста…`,
        'Story Vision', { timeOut: 0, extendedTimeOut: 0, tapToDismiss: true });
    let parsed;
    try {
        parsed = await runRefPrompter(targetName);
    } finally {
        toastr.clear(busyToast);
    }
    console.debug('[StoryVision] Реф-промптер вернул:', parsed);

    let models = [];
    try {
        models = await fetchImageModels();
    } catch (error) {
        toastr.warning(error.message, 'Story Vision');
    }

    const settings = getSettings();
    const form = document.createElement('div');
    form.classList.add('sv-generate');
    form.innerHTML = `
        <h4><i class="fa-solid fa-id-card"></i> Референс: ${esc(parsed.tag)}</h4>

        <label>Промпт портрета (можно править)</label>
        <textarea id="sv_ref_prompt" class="text_pole" rows="8">${esc(parsed.prompt)}</textarea>

        <label>Сходство (опционально — «closely resembling …»)</label>
        <input id="sv_ref_resemblance" class="text_pole" type="text"
               placeholder="actress Eva Green circa 2006">

        <div class="sv-gen-row">
            <div>
                <label>Модель</label>
                <select id="sv_ref_model" class="text_pole">
                    ${models.length === 0
                        ? '<option value="">— discovery не удался —</option>'
                        : models.map(m => `
                            <option value="${esc(m.id)}" ${m.id === (settings.lastModel ?? '') ? 'selected' : ''}>
                                ${esc(m.name)}${m.supportsRefs ? ` (refs: ${m.maxRefs})` : ' (без refs)'}
                            </option>`).join('')}
                </select>
                <small id="sv_ref_model_info" class="sv-model-info"></small>
            </div>
            <div>
                <label>Стиль</label>
                <select id="sv_ref_style" class="text_pole">
                    ${STYLE_PRESETS.map(s => `
                        <option value="${esc(s.id)}" ${s.id === 'realism' ? 'selected' : ''}>
                            ${esc(s.label)}
                        </option>`).join('')}
                </select>
            </div>
        </div>
        <small class="sv-hint">Совет: стиль рефа лучше держать единым для всей библиотеки —
        рисовальщик увереннее переносит личность между картинками одного стиля.</small>`;

    const infoEl = form.querySelector('#sv_ref_model_info');
    const modelSelect = form.querySelector('#sv_ref_model');
    const updateModelInfo = async () => {
        const model = models.find(m => m.id === modelSelect.value);
        if (!model) { infoEl.textContent = ''; return; }
        const hints = getModelHints(model);
        infoEl.textContent = `Качество: ${hints.quality} · Цензура: ${hints.censorship} · Цена: ${hints.cost}`;
        const requestedId = model.id;
        const price = await fetchModelPricing(requestedId);
        if (modelSelect.value === requestedId && price !== null) {
            infoEl.textContent = `Качество: ${hints.quality} · Цензура: ${hints.censorship} · Цена: ~$${price.toFixed(3)}/изобр.`;
        }
    };
    modelSelect.addEventListener('change', updateModelInfo);
    updateModelInfo();

    const confirmed = await callGenericPopup(form, POPUP_TYPE.CONFIRM, '', {
        okButton: 'Генерировать',
        cancelButton: 'Отмена',
        wide: true,
        allowVerticalScrolling: true,
    });
    if (!confirmed) return;

    const promptBase = form.querySelector('#sv_ref_prompt').value.trim();
    const resemblance = form.querySelector('#sv_ref_resemblance').value.trim();
    const modelId = modelSelect.value;
    const styleId = form.querySelector('#sv_ref_style').value;
    if (!modelId) {
        toastr.error('Модель не выбрана.', 'Story Vision');
        return;
    }

    await runRefGeneration({ parsed, promptBase, resemblance, modelId, styleId });
}

async function runRefGeneration(state) {
    const { parsed, promptBase, resemblance, modelId, styleId } = state;

    let prompt = promptBase;
    if (resemblance) {
        prompt += `\n\nThe character is a person closely resembling ${resemblance} — keep that likeness.`;
    }
    const style = getStyleById(styleId);
    if (style.suffix) prompt += `\n\nStyle: ${style.suffix}`;

    const busyToast = toastr.info('Генерация референса…', 'Story Vision',
        { timeOut: 0, extendedTimeOut: 0, tapToDismiss: true });
    let url;
    try {
        const rawSrc = await generateImage({ model: modelId, prompt, refDataUrls: [] });
        url = await persistGeneratedImage(rawSrc, `ref_${parsed.tag}`);
    } catch (error) {
        console.error('[StoryVision] Сбой генерации рефа:', error);
        toastr.error(String(error?.message ?? error), 'Story Vision');
        return;
    } finally {
        toastr.clear(busyToast);
    }

    await showRefResultPopup(url, state);
}

async function showRefResultPopup(url, state) {
    const { callGenericPopup, POPUP_TYPE } = popupApi();
    const { parsed, resemblance } = state;

    const container = document.createElement('div');
    container.classList.add('sv-result');
    container.innerHTML = `
        <img class="sv-result-img" src="${url}" alt="">
        <div class="sv-result-actions">
            <div class="menu_button" id="sv_ref_save"><i class="fa-solid fa-bookmark"></i> В библиотеку</div>
            <div class="menu_button" id="sv_ref_regen"><i class="fa-solid fa-rotate"></i> Ещё раз</div>
            <a class="menu_button" href="${url}" download="ref_${esc(parsed.tag)}.png">
                <i class="fa-solid fa-download"></i> Скачать</a>
        </div>`;

    let action = null;
    container.querySelector('#sv_ref_regen').addEventListener('click', (e) => {
        action = 'regen';
        e.target.closest('dialog')?.querySelector('.popup-button-ok')?.click();
    });
    container.querySelector('#sv_ref_save').addEventListener('click', async (e) => {
        const chatData = getChatData();
        addRef({
            tag: parsed.tag,
            aliases: parsed.aliases,
            arc: chatData.arc ?? '',
            note: parsed.note,
            resemblance: resemblance,
            path: url,
            priority: 1,
        });
        toastr.success(`Референс «${parsed.tag}» добавлен в библиотеку.`, 'Story Vision');
        e.target.closest('.menu_button').style.display = 'none';
    });

    await callGenericPopup(container, POPUP_TYPE.TEXT, '', {
        okButton: 'Закрыть',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    });

    if (action === 'regen') {
        await runRefGeneration(state);
    }
}
