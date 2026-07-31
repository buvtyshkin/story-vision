// Story Vision — картинки в чате и персистентная галерея.
// Формат staging: message.extra.media[] + appendMediaToMessage + saveChat.
// extra не сериализуется в текстовый промпт; inline_image: false защищает
// от мультимодальной отправки при media_inlining: true.

import { getCtx, getChatData, saveChatData } from './index.js';
import { uploadImage } from './refs.js';

// ---- appendMediaToMessage: из контекста или прямым импортом ----

let appendMediaFn = null;

async function getAppendMedia() {
    if (appendMediaFn) return appendMediaFn;
    const ctx = getCtx();
    if (typeof ctx.appendMediaToMessage === 'function') {
        appendMediaFn = ctx.appendMediaToMessage;
    } else {
        const mod = await import('/script.js');
        appendMediaFn = mod.appendMediaToMessage;
    }
    return appendMediaFn;
}

// ---- Сохранение результата генерации на сервер ----
// Вход: data URL или внешний https URL. Выход: постоянный локальный путь.

export async function persistGeneratedImage(src, baseName) {
    if (src.startsWith('data:')) {
        return await uploadImage(src, baseName);
    }
    // Внешний URL: пробуем скачать и сохранить у себя, чтобы не протух.
    try {
        const response = await fetch(src);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('blob read error'));
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
        return await uploadImage(dataUrl, baseName);
    } catch (error) {
        console.warn('[StoryVision] Не удалось сохранить внешний URL локально, оставляю как есть:', error);
        return src;
    }
}

// ---- Прикрепление к конкретному сообщению ----

export function findLastMessageId() {
    const chat = getCtx().chat ?? [];
    for (let i = chat.length - 1; i >= 0; i--) {
        if (!chat[i].is_system) return i;
    }
    return -1;
}

export async function attachToMessage(messageId, url, prompt) {
    const ctx = getCtx();
    const chat = ctx.chat ?? [];

    // Целевое сообщение могло исчезнуть (удаление/ветка) — тогда падаем на последнее.
    let targetId = messageId;
    if (targetId === undefined || targetId === null || targetId < 0
        || targetId >= chat.length || chat[targetId]?.is_system) {
        targetId = findLastMessageId();
    }
    if (targetId === -1) throw new Error('В чате нет сообщения для прикрепления.');

    const message = chat[targetId];
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};
    if (!Array.isArray(message.extra.media)) message.extra.media = [];
    if (!message.extra.media.length && !message.extra.media_display) {
        message.extra.media_display = 'gallery';
    }

    message.extra.media.push({
        url: url,
        type: 'image',
        title: prompt,
        source: 'generated',
        sv: true, // маркер Story Vision — по нему работает уборка
    });
    message.extra.media_index = message.extra.media.length - 1;
    // true = показывать текст сообщения вместе с картинкой.
    // false — режим «сообщение-картинка» (/imagine), он прячет текст.
    message.extra.inline_image = true;

    const appendMedia = await getAppendMedia();
    const element = jQuery(`#chat .mes[mesid="${targetId}"]`);
    if (element.length) appendMedia(message, element);

    await ctx.saveChat();
    return targetId;
}

// Обёртка: прикрепить к последнему сообщению чата (её импортирует ui.js).
export async function attachToLastMessage(url, prompt) {
    return await attachToMessage(findLastMessageId(), url, prompt);
}

// ---- Галерея чата (chat_metadata, наследуется ветками) ----

export function getGallery() {
    const chatData = getChatData();
    if (!Array.isArray(chatData.gallery)) chatData.gallery = [];
    return chatData.gallery;
}

export function addToGallery({ url, prompt, model }) {
    const gallery = getGallery();
    gallery.push({ url, prompt, model, time: Date.now() });
    saveChatData();
}

export function clearGallery() {
    const chatData = getChatData();
    const count = chatData.gallery?.length ?? 0;
    chatData.gallery = [];
    saveChatData();
    return count;
}

// ---- Уборка: снять наши картинки со всех сообщений чата ----

export async function stripImagesFromChat() {
    const ctx = getCtx();
    const chat = ctx.chat ?? [];
    const appendMedia = await getAppendMedia();
    let touched = 0;

    for (let i = 0; i < chat.length; i++) {
        const message = chat[i];
        const media = message?.extra?.media;
        if (!Array.isArray(media) || media.length === 0) continue;

        const kept = media.filter(a => !a.sv);
        if (kept.length === media.length) continue;

        touched++;
        message.extra.media = kept;
        if (kept.length === 0) {
            delete message.extra.media_index;
            delete message.extra.media_display;
        } else if (message.extra.media_index >= kept.length) {
            message.extra.media_index = kept.length - 1;
        }

        const element = jQuery(`#chat .mes[mesid="${i}"]`);
        if (element.length) {
            if (kept.length === 0) {
                element.find('.mes_media_container, .mes_img_container').remove();
            } else {
                appendMedia(message, element);
            }
        }
    }

    if (touched > 0) await ctx.saveChat();
    return touched;
}
