// Story Vision — промптер.
// Собирает контекст сцены, отправляет в Connection Profile (DeepSeek на подписке),
// получает структурированный JSON: { prompt, characters[], location }.

import { getCtx, getSettings, getChatData } from './index.js';
import { getRefs } from './refs.js';

const PROMPTER_MAX_TOKENS = 3000;

// ---- Сбор контекста ----

function collectContext() {
    const ctx = getCtx();
    const settings = getSettings();
    const messages = (ctx.chat ?? []).filter(m => !m.is_system && m.mes);

    const slice = settings.fullContext
        ? messages
        : messages.slice(-settings.contextDepth);

    if (slice.length === 0) return '';

    const last = slice[slice.length - 1];
    const before = slice.slice(0, -1)
        .map(m => `${m.name}: ${m.mes}`)
        .join('\n\n');

    const text = `${before}${before ? '\n\n' : ''}<latest_message>\n${last.name}: ${last.mes}\n</latest_message>`;
    console.debug('[StoryVision] Контекст промптера (последние 500 символов):', text.slice(-500));
    return text;
}

// ---- Инструкция ----

function buildInstruction(refsInfo, arc) {
    const tagLines = refsInfo.length
        ? refsInfo.map(r => r.resemblance
            ? `- ${r.tag} (appearance: a person closely resembling ${r.resemblance})`
            : `- ${r.tag}`).join('\n')
        : '(no known characters yet)';

    return [
        'You are a visual scene director and expert prompt engineer for image generation models. Read the roleplay excerpt below and produce a rich, detailed image prompt for the CURRENT moment. The scene to depict is the one inside <latest_message> — earlier messages are context for appearances, clothing, established locations, and props only.',
        '',
        'Respond with ONLY a JSON object, no markdown fences, no commentary:',
        '{',
        '  "prompt": "detailed English image prompt, 150-250 words",',
        '  "characters": ["Tag1", "Tag2"],',
        '  "location": "short location tag or empty string"',
        '}',
        '',
        'Build the "prompt" as flowing descriptive prose covering, in this order:',
        '1. SUBJECTS: each visible character with concrete physical detail — build, hair (color, length, how it is worn right now), facial expression and the emotion it betrays, exact clothing as established in the story (fabrics, colors, state: rolled sleeves, unbuttoned collar, wet, dusty), scars or distinctive marks, what their hands are doing.',
        '2. ACTION & BLOCKING: poses and body language, spatial relationships (who is closer to camera, who faces whom, distances), the precise frozen moment of action.',
        '3. ENVIRONMENT: the location with era-appropriate specifics, 3-5 telling props or background details drawn from the story (objects on surfaces, condition of the space), depth layers (foreground / midground / background).',
        '4. LIGHT & ATMOSPHERE: light sources and their direction, quality (harsh, diffused, golden hour, fluorescent), shadows, air (dust, smoke, rain, heat haze), palette temperature.',
        '5. CAMERA: shot size (close-up / medium / wide), angle (eye level, low, high, over-the-shoulder), lens feel (35mm street, 85mm portrait compression), what is in sharp focus and what falls off, cinematic 16:9 composition.',
        '',
        'Character identity rules — CRITICAL:',
        '- For characters listed below with an "appearance" note, introduce them at first mention as "a woman/man closely resembling <that appearance note>", then refer to them by role or a short descriptor. NEVER use a bare celebrity name as the subject of the image.',
        '- For all other characters, describe appearance purely from story details.',
        '- Do NOT include style keywords (style is appended separately). Do NOT mention that this comes from a roleplay or story.',
        '',
        'Known characters (canonical tags for the "characters" array):',
        tagLines,
        '',
        'Rules for "characters": use ONLY canonical tags from the list above when the character matches one; list only characters actually visible in frame, main subjects first, maximum 4; if a visible character has no matching tag, still include a short name for them.',
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
    // Уникальные теги с их resemblance (если у версий тега разные — берём первый непустой).
    const refsInfo = [];
    for (const ref of getRefs()) {
        const existing = refsInfo.find(r => r.tag === ref.tag);
        if (!existing) {
            refsInfo.push({ tag: ref.tag, resemblance: ref.resemblance ?? '' });
        } else if (!existing.resemblance && ref.resemblance) {
            existing.resemblance = ref.resemblance;
        }
    }
    const instruction = buildInstruction(refsInfo, chatData.arc);
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
        suffix: 'cinematic illustration, painterly digital rendering, dramatic lighting, movie still composition, rich color grading',
    },
    {
        id: 'realism',
        label: 'Film still (реализм)',
        suffix: 'photorealistic, 35mm film still, natural lighting, shallow depth of field, subtle film grain, muted realistic color palette',
    },
    {
        id: 'anime',
        label: 'Anime / key visual',
        suffix: 'modern anime style, clean detailed lineart, expressive faces, high quality key visual, detailed painted background, soft cel shading',
    },
    {
        id: 'anime90s',
        label: 'Ретро-аниме 90-х',
        suffix: '1990s retro anime cel style, hand-painted cels, film grain, muted VHS-era palette, detailed background art, nostalgic OVA aesthetic',
    },
    {
        id: 'arcane',
        label: 'Painterly (Arcane-like)',
        suffix: 'stylized painterly 3D-meets-2D look, visible brush texture on surfaces, dramatic rim lighting, bold color contrasts, expressive semi-realistic faces, high-end animation still',
    },
    {
        id: 'spiderverse',
        label: 'Comic (Spider-Verse-like)',
        suffix: 'stylized comic book animation look, halftone dots and print texture, chromatic offset accents, bold graphic shapes, dynamic composition, expressive linework',
    },
    {
        id: 'noir',
        label: 'Graphic novel noir',
        suffix: 'graphic novel noir style, heavy ink shadows, high contrast chiaroscuro, limited muted palette with one accent color, dramatic composition',
    },
    {
        id: 'watercolor',
        label: 'Акварельный сториборд',
        suffix: 'loose watercolor and ink storyboard style, soft washes, visible paper texture, selective detail on faces and hands, cinematic framing',
    },
    {
        id: 'oil',
        label: 'Масляная живопись',
        suffix: 'classical oil painting style, visible impasto brushwork, rich chiaroscuro lighting, warm gallery varnish tones, masterful composition',
    },
    {
        id: 'pulp',
        label: 'Pulp-обложка',
        suffix: '1960s pulp paperback cover art, gouache illustration, dramatic poses, saturated warm palette, slightly weathered print texture',
    },
    {
        id: 'custom',
        label: 'Свой стиль (из настроек)',
        suffix: '', // подставляется из settings.customStyle
    },
    {
        id: 'none',
        label: 'Без стиля (чистый промпт)',
        suffix: '',
    },
];

export function getStyleById(id) {
    const style = STYLE_PRESETS.find(s => s.id === id) ?? STYLE_PRESETS[0];
    if (style.id === 'custom') {
        return { ...style, suffix: getSettings().customStyle ?? '' };
    }
    return style;
}
