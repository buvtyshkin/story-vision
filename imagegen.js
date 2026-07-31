// Story Vision — генерация изображений через NanoGPT Image API.
// Discovery: GET /api/v1/images/models (без ключа).
// Генерация: POST /api/v1/images с input_references (base64 data URLs).

import { getSettings } from './index.js';

const API_BASE = 'https://nano-gpt.com/api/v1';

let modelsCache = null;

// ---- Discovery ----

export async function fetchImageModels(force = false) {
    if (modelsCache && !force) return modelsCache;

    let response;
    try {
        response = await fetch(`${API_BASE}/images/models`);
    } catch (error) {
        throw new Error(
            'Не удалось достучаться до NanoGPT из браузера (похоже на CORS или сеть). ' +
            'Если ошибка стабильная — переходим на серверный прокси-плагин.',
        );
    }
    if (!response.ok) {
        throw new Error(`Discovery моделей: HTTP ${response.status}`);
    }

    const payload = await response.json();
    const list = Array.isArray(payload?.data) ? payload.data : [];

    modelsCache = list
        .filter(m => m?.capabilities?.image_generation !== false)
        .map(m => ({
            id: m.id,
            name: m.name ?? m.id,
            supportsRefs: modelSupportsRefs(m),
            maxRefs: getMaxRefs(m),
            supportedParams: Object.keys(m.supported_parameters ?? {}),
        }));

    return modelsCache;
}

function modelSupportsRefs(model) {
    if (model?.architecture?.input_modalities?.includes('image')) return true;
    if (model?.supported_parameters?.input_references) return true;
    if (model?.capabilities?.image_to_image) return true;
    return false;
}

function getMaxRefs(model) {
    const param = model?.supported_parameters?.input_references;
    if (param?.max !== undefined) return Number(param.max);
    return modelSupportsRefs(model) ? 4 : 0;
}

export function getModelInfo(modelId) {
    return modelsCache?.find(m => m.id === modelId) ?? null;
}

// ---- Генерация ----

export async function generateImage({ model, prompt, refDataUrls = [] }) {
    const settings = getSettings();
    if (!settings.apiKey) {
        throw new Error('API-ключ NanoGPT не задан — впиши его в настройках Story Vision.');
    }

    const body = {
        model: model,
        prompt: prompt,
        n: 1,
    };

    const info = getModelInfo(model);
    if (info?.supportedParams?.includes('aspect_ratio')) {
        body.aspect_ratio = '16:9';
    }
    if (refDataUrls.length > 0) {
        body.input_references = refDataUrls;
    }

    console.debug('[StoryVision] Генерация:', {
        model: model,
        refs: refDataUrls.length,
        refsKb: Math.round(refDataUrls.reduce((sum, r) => sum + r.length, 0) * 0.75 / 1024),
        promptChars: prompt.length,
    });

    let response;
    try {
        response = await fetch(`${API_BASE}/images`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': settings.apiKey,
            },
            body: JSON.stringify(body),
        });
    } catch (error) {
        throw new Error(
            'Запрос к NanoGPT не ушёл из браузера (похоже на CORS). ' +
            'Если повторяется — делаем серверный прокси-плагин.',
        );
    }

    if (!response.ok) {
        let detail = '';
        try {
            const err = await response.json();
            detail = err?.error?.message ?? JSON.stringify(err).slice(0, 200);
        } catch {
            detail = (await response.text().catch(() => '')).slice(0, 200);
        }
        throw new Error(`Генерация: HTTP ${response.status}. ${detail}`);
    }

    const payload = await response.json();
    const image = extractImage(payload);
    if (!image) {
        console.error('[StoryVision] Неожиданный формат ответа:', payload);
        throw new Error('Картинка не найдена в ответе — формат в консоли (F12).');
    }
    return image; // data URL либо https URL
}

// Ответ нормализованного API может отличаться по форме — разбираем устойчиво.
function extractImage(payload) {
    const item = payload?.data?.[0] ?? payload?.images?.[0] ?? payload;
    if (!item) return null;

    if (typeof item === 'string') {
        return normalizeImageString(item);
    }
    if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
    if (item.url) return item.url;
    if (item.image) return normalizeImageString(item.image);
    if (item.b64) return `data:image/png;base64,${item.b64}`;
    return null;
}

function normalizeImageString(str) {
    if (str.startsWith('data:') || str.startsWith('http')) return str;
    // Голый base64.
    return `data:image/png;base64,${str}`;
}
