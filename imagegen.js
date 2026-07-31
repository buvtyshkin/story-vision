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
            nsfw: m?.capabilities?.nsfw === true,
            endpointsPath: m.endpoints ?? null,
        }));

    return modelsCache;
}

// ---- Подсказки по моделям: качество / цензура / цена ----
// Курируемая карта по семействам; цензура уточняется живым флагом capabilities.nsfw,
// цена — живым запросом к endpoints (лениво, с кэшем).

const MODEL_HINTS = [
    { match: /nano-banana-pro|gemini-3-pro-image/i, quality: 'топ', censorship: 'строгая (реальные лица, NSFW)', cost: 'дорого' },
    { match: /nano-banana|gemini.*flash-image|gemini.*image/i, quality: 'высокое', censorship: 'строгая (реальные лица, NSFW)', cost: 'средне' },
    { match: /gpt-image/i, quality: 'высокое', censorship: 'строгая', cost: 'средне (зависит от quality)' },
    { match: /flux.*kontext/i, quality: 'высокое, лучший с рефами', censorship: 'умеренная', cost: 'средне' },
    { match: /flux.*(pro|max)/i, quality: 'высокое', censorship: 'умеренная', cost: 'средне-дорого' },
    { match: /flux.*(schnell|klein|dev)/i, quality: 'хорошее', censorship: 'умеренная', cost: 'дёшево' },
    { match: /seedream/i, quality: 'высокое', censorship: 'умеренная', cost: 'дёшево-средне' },
    { match: /qwen.*image/i, quality: 'хорошее', censorship: 'мягкая', cost: 'дёшево' },
    { match: /hidream/i, quality: 'хорошее', censorship: 'мягкая', cost: 'дёшево' },
    { match: /chroma/i, quality: 'художественное', censorship: 'нет', cost: 'дёшево' },
    { match: /pony|illustrious|noob|animagine|sdxl|autismmix/i, quality: 'аниме-профиль', censorship: 'нет', cost: 'копейки' },
    { match: /z-image|zimage/i, quality: 'среднее', censorship: 'умеренная', cost: 'копейки' },
    { match: /hunyuan/i, quality: 'хорошее', censorship: 'умеренная', cost: 'дёшево' },
    { match: /imagen/i, quality: 'топ-фотореализм', censorship: 'строгая', cost: 'дорого' },
];

export function getModelHints(model) {
    const hint = MODEL_HINTS.find(h => h.match.test(model.id) || h.match.test(model.name)) ?? {};
    return {
        quality: hint.quality ?? '—',
        censorship: model.nsfw ? 'нет (NSFW ок)' : (hint.censorship ?? 'неизвестно'),
        cost: hint.cost ?? '—',
    };
}

const pricingCache = {};

export async function fetchModelPricing(modelId) {
    if (pricingCache[modelId] !== undefined) return pricingCache[modelId];
    const model = getModelInfo(modelId);
    const path = model?.endpointsPath ?? `/api/v1/images/models/${encodeURIComponent(modelId)}/endpoints`;
    try {
        const response = await fetch(path.startsWith('http') ? path : `https://nano-gpt.com${path}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const pricing = payload?.endpoints?.[0]?.pricing;
        const entry = pricing?.find(p => p.billable === 'output_image') ?? pricing?.[0];
        pricingCache[modelId] = entry?.cost_usd ?? null;
    } catch {
        pricingCache[modelId] = null;
    }
    return pricingCache[modelId];
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
