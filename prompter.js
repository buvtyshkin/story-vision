// Story Vision — промптер.
// Собирает контекст сцены, отправляет в Connection Profile (DeepSeek на подписке),
// получает структурированный JSON: { prompt, characters[], location }.

import { getCtx, getSettings, getChatData } from './index.js';
import { getRefs } from './refs.js';

const PROMPTER_MAX_TOKENS = 2000;

// ---- Сбор контекста ----

function collectContext() {
    const ctx = getCtx();
    const settings = getSettings();
    const messages = (ctx.chat ?? []).filter(m => !m.is_system && m.mes);

    const slice = settings.fullContext
        ? messages
        : messages.slice(-settings.contextDepth);

    return slice.map(m => `${m.name}: ${m.mes}`).join('\n\n');
}

// ---- Инструкция ----

function buildInstruction(availableTags, arc) {
    const tagList = availableTags.length
        ? availableTags.join(', ')
        : '(библиотека пуста)';

    return [
        'You are a visual scene director. Read the roleplay excerpt below and produce an image generation prompt for the CURRENT moment (the last messages are the present scene).',
        '',
        'Respond with ONLY a JSON object, no markdown fences, no commentary:',
        '{',
        '  "prompt": "detailed English image prompt for the scene",',
        '  "characters": ["Tag1", "Tag2"],',
        '  "location": "short location tag or empty string"',
        '}',
        '',
        'Rules for "prompt":',
        '- English only. Describe: who is in frame and what they are doing, poses, expressions, clothing as established in the story, environment, time of day, lighting, camera framing (e.g. medium shot, over-the-shoulder). Cinematic 16:9 composition.',
        '- Refer to characters by their canonical tag names (they will be matched to reference images).',
        '- Do NOT include style keywords (style is added separately). Do NOT include real celebrity names — use the tag names.',
        '- 80-160 words.',
        '',
        'Rules for "characters":',
        `- Use ONLY canonical tags from this list when the character matches one: ${tagList}.`,
        '- List only characters actually visible in the frame, main subjects first, maximum 4.',
        '- If a visible character has no matching tag, still include a short name for them.',
        arc ? `\nCurrent story arc: ${arc}.` : '',
    ].join('\n');
}

// ---- Вызов ----

export async function runPrompter() {
    const ctx = getCtx();
    const settings = getSettings();

    if (!settings.prompterProfile) {
        throw new Error('Профиль промптера не выбран — задай его в настройках Story Vision.');
    }
    const service = ctx.ConnectionManagerRequestService;
    if (!service) {
        throw new Error('ConnectionManagerRequestService недоступен — обнови SillyTavern.');
    }

    const chatData = getChatData();
    const availableTags = [...new Set(getRefs().map(r => r.tag))];
    const instruction = buildInstruction(availableTags, chatData.arc);
    const context = collectContext();

    if (!context.trim()) {
        throw new Error('В чате нет сообщений — не из чего собирать сцену.');
    }

    const messages = [
        { role: 'system', content: instruction },
        { role: 'user', content: `<roleplay_excerpt>\n${context}\n</roleplay_excerpt>\n\nProduce the JSON now.` },
    ];

    const result = await service.sendRequest(
        settings.prompterProfile,
        messages,
        PROMPTER_MAX_TOKENS,
        { includePreset: false, includeInstruct: false },
    );

    const text = typeof result === 'string' ? result : (result?.content ?? '');
    return parsePrompterResponse(text);
}

// ---- Парсинг ----

export function parsePrompterResponse(text) {
    if (!text || !text.trim()) {
        throw new Error('Промптер вернул пустой ответ.');
    }
    // Срезаем возможные ```json-заборы и ищем первый JSON-объект.
    let clean = text.replace(/```json|```/gi, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
        throw new Error('В ответе промптера не найден JSON. Начало ответа: ' + clean.slice(0, 120));
    }
    clean = clean.slice(start, end + 1);

    let parsed;
    try {
        parsed = JSON.parse(clean);
    } catch {
        throw new Error('JSON промптера не парсится. Начало: ' + clean.slice(0, 120));
    }

    const prompt = String(parsed.prompt ?? '').trim();
    if (!prompt) throw new Error('Промптер не вернул поле "prompt".');

    const characters = Array.isArray(parsed.characters)
        ? parsed.characters.map(c => String(c).trim()).filter(Boolean).slice(0, 4)
        : [];
    const location = String(parsed.location ?? '').trim();

    return { prompt, characters, location };
}

// ---- Стили (суффиксы, добавляются к промпту при генерации) ----

export const STYLE_PRESETS = [
    {
        id: 'cinematic',
        label: 'Cinematic illustration',
        suffix: 'cinematic illustration, painterly rendering, dramatic lighting, movie still composition, rich color grading',
    },
    {
        id: 'anime',
        label: 'Anime / key visual',
        suffix: 'anime style, clean detailed lineart, expressive faces, high quality key visual, detailed background',
    },
    {
        id: 'noir',
        label: 'Graphic novel noir',
        suffix: 'graphic novel noir style, heavy ink shadows, high contrast, muted palette, dramatic composition',
    },
    {
        id: 'realism',
        label: 'Film still (реализм)',
        suffix: 'photorealistic, 35mm film still, natural lighting, shallow depth of field, film grain',
    },
    {
        id: 'none',
        label: 'Без стиля (чистый промпт)',
        suffix: '',
    },
];

export function getStyleById(id) {
    return STYLE_PRESETS.find(s => s.id === id) ?? STYLE_PRESETS[0];
}
