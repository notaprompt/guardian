"use strict";
/**
 * ForgeFrame — Model Routing Engine
 *
 * Routes user messages to the optimal model based on intent signals.
 * Supports multiple providers: built-in Claude CLI models plus external
 * providers registered in the database (providers / provider_models tables).
 *
 * Manual override via ModelPicker always takes precedence.
 * Persists selected model to ~/.guardian/config/settings.json
 *
 * Routes by task tier: quick, balanced, and deep.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MODEL = exports.DEFAULT_MODELS = exports.MODELS = void 0;
exports.detectIntent = detectIntent;
exports.resolveModel = resolveModel;
exports.getModels = getModels;
exports.getSelectedModel = getSelectedModel;
exports.setSelectedModel = setSelectedModel;
exports.getAutoRoute = getAutoRoute;
exports.setAutoRoute = setAutoRoute;
exports.loadProviderModels = loadProviderModels;
exports.getCheapestModel = getCheapestModel;
const paths_1 = require("./paths");
const log = require("./logger");
// ── Default Models (Claude CLI) ─────────────────────────────────
const DEFAULT_MODELS = [
    {
        id: 'claude-sonnet-4-5-20250929',
        label: 'Sonnet',
        provider: 'claude-cli',
        description: 'Balanced — code, writing, analysis',
        tier: 'balanced',
    },
    {
        id: 'claude-opus-4-6',
        label: 'Opus',
        provider: 'claude-cli',
        description: 'Deep analysis — complex reasoning',
        tier: 'deep',
    },
    {
        id: 'claude-haiku-4-5-20251001',
        label: 'Haiku',
        provider: 'claude-cli',
        description: 'Quick questions — fast responses',
        tier: 'quick',
    },
];
exports.DEFAULT_MODELS = DEFAULT_MODELS;
// Backward-compat alias
const MODELS = DEFAULT_MODELS;
exports.MODELS = MODELS;
const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
exports.DEFAULT_MODEL = DEFAULT_MODEL;
// ── Provider Model Registry ─────────────────────────────────────
// Starts as a copy of DEFAULT_MODELS; loadProviderModels() merges in DB models.
let _allModels = [...DEFAULT_MODELS];
// Cost-ordering hint: provider types that are typically cheaper come first.
// claude-cli is the most expensive baseline; external providers are presumed cheaper.
const _PROVIDER_COST_ORDER = {
    'openai-compatible': 0,
    ollama: 0,
    'claude-cli': 1,
};
/**
 * Load provider models from the database and merge with defaults.
 * Call once during app initialization (after database is open).
 */
function loadProviderModels(database) {
    _allModels = [...DEFAULT_MODELS];
    if (!database)
        return;
    try {
        const rows = database.prepare(`
      SELECT pm.model_id, pm.label, pm.description, pm.tier, pm.enabled,
             p.id AS provider_id, p.name AS provider_name, p.type AS provider_type,
             p.enabled AS provider_enabled, p.base_url
      FROM provider_models pm
      JOIN providers p ON p.id = pm.provider_id
      WHERE pm.enabled = 1 AND p.enabled = 1
      ORDER BY p.name ASC, pm.label ASC
    `).all();
        for (const row of rows) {
            // Skip duplicates (a provider model whose model_id already exists)
            if (_allModels.some((m) => m.id === row.model_id && m.provider === row.provider_id)) {
                continue;
            }
            _allModels.push({
                id: row.model_id,
                label: row.label || row.model_id,
                provider: row.provider_id,
                providerName: row.provider_name,
                providerType: row.provider_type,
                baseUrl: row.base_url || null,
                description: row.description || '',
                tier: row.tier || 'balanced',
            });
        }
        const externalCount = _allModels.length - DEFAULT_MODELS.length;
        if (externalCount > 0) {
            log.info(`ForgeFrame: loaded ${externalCount} external provider model(s)`);
        }
    }
    catch (e) {
        log.warn('ForgeFrame: failed to load provider models:', e.message);
    }
}
// ── Intent Signal Patterns ───────────────────────────────────────
// Each pattern maps to a tier. Auto-route picks the first matching tier.
const DEEP_SIGNALS = [
    /\banalyze\b/i,
    /\banalysis\b/i,
    /\bexplain in detail\b/i,
    /\bdeep dive\b/i,
    /\bcompare and contrast\b/i,
    /\bcritique\b/i,
    /\bevaluate\b/i,
    /\bwhy does\b/i,
    /\bwhat are the implications\b/i,
    /\barchitecture\b/i,
    /\bdesign pattern\b/i,
    /\btrade.?offs?\b/i,
    /\bphilosoph/i,
    /\btheor(?:y|etical|ize)\b/i,
    /\bproof\b/i,
    /\bderive\b/i,
    /\bresearch\b/i,
    /\blong.?form\b/i,
];
const QUICK_SIGNALS = [
    /^(?:what|who|when|where|how) (?:is|are|was|were|do|does|did|can|could|would|should) /i,
    /\bquick(?:ly)?\b/i,
    /\bbrief(?:ly)?\b/i,
    /\btl;?dr\b/i,
    /\bsummar(?:y|ize)\b/i,
    /\bdefine\b/i,
    /\bwhat does .{1,30} mean/i,
    /\bremind me\b/i,
    /\byes or no\b/i,
    /\bone.?liner\b/i,
    /\bshort answer\b/i,
];
// ── Core Functions ───────────────────────────────────────────────
/**
 * Detect intent tier from a user message.
 * Returns 'deep', 'quick', or 'balanced'.
 */
function detectIntent(message) {
    if (!message || typeof message !== 'string')
        return 'balanced';
    const text = message.trim();
    // Very short messages (< 20 chars) lean quick
    if (text.length < 20 && !DEEP_SIGNALS.some((r) => r.test(text))) {
        return 'quick';
    }
    // Very long messages (> 500 chars) lean deep
    if (text.length > 500) {
        return 'deep';
    }
    // Check deep signals first (higher value routing)
    if (DEEP_SIGNALS.some((r) => r.test(text))) {
        return 'deep';
    }
    // Check quick signals
    if (QUICK_SIGNALS.some((r) => r.test(text))) {
        return 'quick';
    }
    return 'balanced';
}
/**
 * Find the cheapest model for a given tier.
 * External providers are presumed cheaper than claude-cli.
 * Falls back to the first model matching the tier, or null.
 */
function getCheapestModel(tier) {
    const candidates = _allModels.filter((m) => m.tier === tier);
    if (candidates.length === 0)
        return null;
    candidates.sort((a, b) => {
        const costA = _PROVIDER_COST_ORDER[a.providerType || a.provider] ?? 0;
        const costB = _PROVIDER_COST_ORDER[b.providerType || b.provider] ?? 0;
        return costA - costB;
    });
    return candidates[0];
}
/**
 * Resolve which model to use for a message.
 *
 * Priority:
 *   1. Explicit override (user picked a model manually)
 *   2. Auto-route based on message intent (with cost-tier optimization)
 *   3. Persisted default from settings
 *   4. Hardcoded default (Sonnet)
 */
function resolveModel(message, override) {
    // Manual override always wins
    if (override && override !== 'auto') {
        const model = _allModels.find((m) => m.id === override);
        if (model) {
            return { provider: model.provider, modelId: model.id, tier: model.tier, auto: false };
        }
    }
    // Auto-route: check if auto-routing is enabled
    const settings = (0, paths_1.readJSON)(paths_1.FILES.settings, {});
    const autoRoute = settings.forgeframe?.autoRoute !== false; // default: on
    if (autoRoute && override !== 'manual-lock') {
        const tier = detectIntent(message);
        // For 'quick' tier, prefer the cheapest available provider
        if (tier === 'quick') {
            const cheapest = getCheapestModel('quick');
            if (cheapest) {
                return { provider: cheapest.provider, modelId: cheapest.id, tier, auto: true };
            }
        }
        // For other tiers, use the first model matching the tier from _allModels
        // (defaults come first, preserving existing behavior when no providers exist)
        const model = _allModels.find((m) => m.tier === tier);
        if (model) {
            return { provider: model.provider, modelId: model.id, tier, auto: true };
        }
    }
    // Fall back to persisted model or default
    const persistedModel = settings.forgeframe?.selectedModel || DEFAULT_MODEL;
    const model = _allModels.find((m) => m.id === persistedModel) || _allModels[0];
    return { provider: model.provider, modelId: model.id, tier: model.tier, auto: false };
}
/**
 * Get all available models (default + provider).
 * Each entry includes the provider field.
 */
function getModels() {
    return _allModels.map((m) => ({
        id: m.id,
        label: m.label,
        provider: m.provider,
        providerName: m.providerName || null,
        description: m.description,
        tier: m.tier,
    }));
}
/**
 * Get the currently selected model from settings.
 */
function getSelectedModel() {
    const settings = (0, paths_1.readJSON)(paths_1.FILES.settings, {});
    return settings.forgeframe?.selectedModel || DEFAULT_MODEL;
}
/**
 * Set the selected model in settings.
 */
function setSelectedModel(modelId) {
    const settings = (0, paths_1.readJSON)(paths_1.FILES.settings, {});
    if (!settings.forgeframe)
        settings.forgeframe = {};
    settings.forgeframe.selectedModel = modelId;
    (0, paths_1.writeJSON)(paths_1.FILES.settings, settings);
    log.info('ForgeFrame: model set to', modelId);
}
/**
 * Get auto-route enabled state.
 */
function getAutoRoute() {
    const settings = (0, paths_1.readJSON)(paths_1.FILES.settings, {});
    return settings.forgeframe?.autoRoute !== false;
}
/**
 * Set auto-route enabled state.
 */
function setAutoRoute(enabled) {
    const settings = (0, paths_1.readJSON)(paths_1.FILES.settings, {});
    if (!settings.forgeframe)
        settings.forgeframe = {};
    settings.forgeframe.autoRoute = enabled;
    (0, paths_1.writeJSON)(paths_1.FILES.settings, settings);
    log.info('ForgeFrame: auto-route', enabled ? 'enabled' : 'disabled');
}
