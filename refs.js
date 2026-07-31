// Story Vision — хранилище референсов.
// Файлы лежат в data/<user>/user/images/StoryVision/ (через штатный аплоад ST),
// метаданные — в настройках расширения.

import { getCtx, getSettings, saveSettings, getChatData, saveChatData } from './index.js';

const MAX_DIM = 1024;
const JPEG_QUALITY = 0.92;

// ---- Изображения ----

export function resizeImageFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('Файл не похож на изображение'));
            img.onload = () => {
                let { width, height } = img;
                if (Math.max(width, height) > MAX_DIM) {
                    const scale = MAX_DIM / Math.max(width, height);
                    width = Math.round(width * scale);
                    height = Math.round(height * scale);
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

export async function uploadImage(dataUrl, baseName) {
    const ctx = getCtx();
    const safeName = String(baseName || 'ref')
        .replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, '_')
        .slice(0, 40);
    const filename = `${safeName}_${Date.now()}`;

    const response = await fetch('/api/images/upload', {
        method: 'POST',
        headers: ctx.getRequestHeaders(),
        body: JSON.stringify({
            image: dataUrl,
            ch_name: 'StoryVision',
            filename: filename,
        }),
    });

    if (!response.ok) {
        throw new Error(`Загрузка не удалась: HTTP ${response.status}`);
    }
    const result = await response.json();
    if (!result?.path) {
        throw new Error('Сервер не вернул путь к файлу');
    }
    return result.path;
}

// Для итерации 2: реф -> base64 для input_references.
export async function refToDataUrl(ref) {
    const response = await fetch(ref.path);
    if (!response.ok) throw new Error(`Не удалось прочитать референс: ${ref.path}`);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Ошибка чтения blob'));
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

// ---- CRUD библиотеки ----

export function getRefs() {
    return getSettings().refs;
}

export function getRefById(id) {
    return getRefs().find(r => r.id === id) ?? null;
}

export function addRef({ tag, aliases, arc, note, path, priority }) {
    const ref = {
        id: crypto.randomUUID().slice(0, 8),
        tag: String(tag ?? '').trim(),
        aliases: normalizeAliases(aliases),
        arc: String(arc ?? '').trim(),
        note: String(note ?? '').trim(),
        path: path,
        priority: Number(priority) || 1,
    };
    getRefs().push(ref);
    saveSettings();
    return ref;
}

export function updateRef(id, patch) {
    const ref = getRefById(id);
    if (!ref) return null;
    if (patch.tag !== undefined) ref.tag = String(patch.tag).trim();
    if (patch.aliases !== undefined) ref.aliases = normalizeAliases(patch.aliases);
    if (patch.arc !== undefined) ref.arc = String(patch.arc).trim();
    if (patch.note !== undefined) ref.note = String(patch.note).trim();
    if (patch.priority !== undefined) ref.priority = Number(patch.priority) || 1;
    if (patch.path !== undefined) ref.path = patch.path;
    saveSettings();
    return ref;
}

export function deleteRef(id) {
    const settings = getSettings();
    settings.refs = settings.refs.filter(r => r.id !== id);
    saveSettings();
    // Вычищаем из каста текущего чата, если реф там стоял.
    const chatData = getChatData();
    let touched = false;
    for (const [name, refId] of Object.entries(chatData.cast)) {
        if (refId === id) {
            delete chatData.cast[name];
            touched = true;
        }
    }
    if (touched) saveChatData();
}

function normalizeAliases(aliases) {
    if (Array.isArray(aliases)) {
        return aliases.map(a => String(a).trim()).filter(Boolean);
    }
    return String(aliases ?? '')
        .split(',')
        .map(a => a.trim())
        .filter(Boolean);
}

// ---- Каст чата ----

export function setCast(name, refId) {
    const chatData = getChatData();
    chatData.cast[String(name).trim()] = refId;
    saveChatData();
}

export function removeFromCast(name) {
    const chatData = getChatData();
    delete chatData.cast[name];
    saveChatData();
}

// ---- Разрешение имён в рефы (ядро маппинга, используется в итерации 2) ----
// Порядок: каст чата -> библиотека по тегу/алиасу (с учётом арки чата) -> нет рефа.

export function resolveCharacter(name) {
    const query = String(name).trim().toLowerCase();
    const chatData = getChatData();

    // 1. Каст чата: точное совпадение по ключу (без регистра).
    for (const [castName, refId] of Object.entries(chatData.cast)) {
        if (castName.toLowerCase() === query) {
            const ref = getRefById(refId);
            if (ref) return { status: 'resolved', ref, source: 'cast' };
        }
    }

    // 2. Библиотека: совпадение по тегу или алиасу.
    const matches = getRefs().filter(r =>
        r.tag.toLowerCase() === query ||
        r.aliases.some(a => a.toLowerCase() === query)
    );

    if (matches.length === 0) return { status: 'missing' };

    if (matches.length === 1) {
        return { status: 'resolved', ref: matches[0], source: 'library' };
    }

    // Несколько кандидатов: сначала фильтр по арке чата, потом по priority.
    const arc = chatData.arc?.trim().toLowerCase();
    if (arc) {
        const arcMatches = matches.filter(r => r.arc.toLowerCase() === arc);
        if (arcMatches.length === 1) {
            return { status: 'resolved', ref: arcMatches[0], source: 'arc' };
        }
        if (arcMatches.length > 1) {
            arcMatches.sort((a, b) => a.priority - b.priority);
            return { status: 'ambiguous', candidates: arcMatches };
        }
    }
    matches.sort((a, b) => a.priority - b.priority);
    return { status: 'ambiguous', candidates: matches };
}

export function resolveMany(names) {
    const resolved = [];
    const ambiguous = [];
    const missing = [];
    for (const name of names) {
        const result = resolveCharacter(name);
        if (result.status === 'resolved') resolved.push({ name, ref: result.ref, source: result.source });
        else if (result.status === 'ambiguous') ambiguous.push({ name, candidates: result.candidates });
        else missing.push(name);
    }
    return { resolved, ambiguous, missing };
}
