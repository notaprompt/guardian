"use strict";
/**
 * ForgeFrame Bridge — Adapter from @forgeframe/core to Guardian's function-based API
 *
 * Replaces the stale fork in lib/forgeframe.ts with a thin wrapper around
 * the canonical @forgeframe/core ForgeFrameRouter class. Guardian's main.js
 * calls this module's exported functions identically to the old fork.
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
const core_1 = require("@forgeframe/core");
const paths_1 = require("./paths");
const log = require("./logger");
// -- ConfigStore adapter for Guardian's JSON-file persistence --
const guardianConfigStore = {
    read(key, fallback) {
        if (key === 'settings')
            return (0, paths_1.readJSON)(paths_1.FILES.settings, fallback);
        return fallback;
    },
    write(key, data) {
        if (key === 'settings')
            (0, paths_1.writeJSON)(paths_1.FILES.settings, data);
    },
};
// -- Default models (same as old fork) --
const DEFAULT_MODELS = [
    {
        id: 'claude-sonnet-4-5-20250929',
        label: 'Sonnet',
        provider: 'claude-cli',
        description: 'Balanced -- code, writing, analysis',
        tier: 'balanced',
    },
    {
        id: 'claude-opus-4-6',
        label: 'Opus',
        provider: 'claude-cli',
        description: 'Deep analysis -- complex reasoning',
        tier: 'deep',
    },
    {
        id: 'claude-haiku-4-5-20251001',
        label: 'Haiku',
        provider: 'claude-cli',
        description: 'Quick questions -- fast responses',
        tier: 'quick',
    },
];
exports.DEFAULT_MODELS = DEFAULT_MODELS;
const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
exports.DEFAULT_MODEL = DEFAULT_MODEL;
// -- Router instance --
const router = new core_1.ForgeFrameRouter({
    configStore: guardianConfigStore,
    logger: log,
    models: DEFAULT_MODELS,
});
// Backward-compat alias
const MODELS = DEFAULT_MODELS;
exports.MODELS = MODELS;
// -- Function-based API matching old fork --
function detectIntent(message) {
    return router.detectIntent(message);
}
function resolveModel(message, override) {
    const result = router.resolveModel(message, override);
    if (!result) {
        const fallback = DEFAULT_MODELS[0];
        return { provider: fallback.provider, modelId: fallback.id, tier: fallback.tier, auto: false };
    }
    return result;
}
function getModels() {
    return router.getModels();
}
function getSelectedModel() {
    return router.getSelectedModel() || DEFAULT_MODEL;
}
function setSelectedModel(modelId) {
    router.setSelectedModel(modelId);
}
function getAutoRoute() {
    return router.getAutoRoute();
}
function setAutoRoute(enabled) {
    router.setAutoRoute(enabled);
}
function getCheapestModel(tier) {
    return router.getCheapestModel(tier);
}
/**
 * Load provider models from the database and merge with defaults.
 * Adapts Guardian's DB schema to @forgeframe/core's Model[] interface.
 */
function loadProviderModels(database) {
    const models = [...DEFAULT_MODELS];
    if (!database) {
        router.loadModels(models);
        return;
    }
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
            if (models.some((m) => m.id === row.model_id && m.provider === row.provider_id)) {
                continue;
            }
            models.push({
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
    }
    catch (e) {
        log.warn('ForgeFrame: failed to load provider models:', e.message);
    }
    router.loadModels(models);
}
