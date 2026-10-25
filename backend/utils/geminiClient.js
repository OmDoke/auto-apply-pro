'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

// ---------------------------------------------------------------------------
// Model fallback chain. GEMINI_MODELS (comma-separated) wins; otherwise
// GEMINI_MODEL first, then lighter fallbacks. A model that times out or
// errors is skipped for that call; one that is out of quota / not found is
// disabled for the rest of the session.
// ---------------------------------------------------------------------------
const DEFAULT_FALLBACKS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

const getModelChain = () => {
    const explicit = (process.env.GEMINI_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
    const chain = explicit.length > 0
        ? explicit
        : [process.env.GEMINI_MODEL || 'gemini-3.5-flash', ...DEFAULT_FALLBACKS];
    return [...new Set(chain)];
};

let _genAI = null;
const _models = new Map();          // name → GenerativeModel (singleton per model)
const disabledModels = new Set();   // quota-exhausted / missing models, per session
let geminiDisabled = false;         // whole client off (bad API key)
const disableGeminiForSession = () => { geminiDisabled = true; };

const getModel = (name) => {
    if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    if (!_models.has(name)) _models.set(name, _genAI.getGenerativeModel({ model: name }));
    return _models.get(name);
};

const callWithTimeout = async (model, request, timeoutMs) => {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs / 1000}s`)), timeoutMs);
    });
    try {
        return await Promise.race([model.generateContent(request), timeout]);
    } finally {
        clearTimeout(timer);
    }
};

// ---------------------------------------------------------------------------
// invokeGemini(prompt, opts) → response text, or null if every model failed.
// opts.json       ask for raw JSON output (no markdown fences)
// opts.timeoutMs  per-model timeout (default 12s)
// ---------------------------------------------------------------------------
const invokeGemini = async (promptText, opts = {}) => {
    if (geminiDisabled || !process.env.GEMINI_API_KEY) return null;
    const { json = false, timeoutMs = 12000 } = (opts && typeof opts === 'object') ? opts : {};

    const request = json
        ? { contents: [{ role: 'user', parts: [{ text: promptText }] }], generationConfig: { responseMimeType: 'application/json' } }
        : promptText;

    for (const name of getModelChain()) {
        if (disabledModels.has(name)) continue;
        try {
            const result = await callWithTimeout(getModel(name), request, timeoutMs);
            const text = result.response.text().trim();
            if (text) return text;
            console.log(`  ⚠️ Gemini ${name}: empty response — trying next model`);
        } catch (err) {
            const rawMsg = (err && err.message) ? err.message : String(err);
            const msgLower = rawMsg.toLowerCase();

            if (err.status === 400 && msgLower.includes('api key')) {
                console.log('  ⚠️ Gemini API key invalid — disabling Gemini for this session.');
                disableGeminiForSession();
                return null;
            }
            const isQuota = err.status === 429 || err.code === 429 ||
                msgLower.includes('quota') || msgLower.includes('resource_exhausted');
            const isMissing = err.status === 404 || msgLower.includes('not found');
            if (isQuota || isMissing) {
                disabledModels.add(name);
                console.log(`  ⚠️ Gemini ${name}: ${isQuota ? 'quota exhausted' : 'model not found'} — disabled for this session`);
            } else {
                console.log(`  ⚠️ Gemini ${name}: ${rawMsg} — trying next model`);
            }
        }
    }
    return null;
};

module.exports = { invokeGemini, disableGeminiForSession, getModelChain };
