// Story Vision — интерфейс. Всё на нативном Popup Таверны.

import { getCtx, getChatData, saveChatData, esc } from './index.js';
import {
    getRefs, getRefById, addRef, updateRef, deleteRef,
    resizeImageFile, uploadImage, setCast, removeFromCast,
} from './refs.js';

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
