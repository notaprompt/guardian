/**
 * ForgeFrame — Model Routing Engine
 *
 * Routes user messages to the optimal Claude model based on intent signals.
 * Manual override via ModelPicker always takes precedence.
 * Persists selected model to ~/.guardian/config/settings.json
 *
 * TRIM grounding: different cognitive tasks have different optimal models.
 * Quick questions -> fast model (Haiku). Deep analysis -> capable model (Opus).
 * Code generation / balanced -> default model (Sonnet).
 */

const { readJSON, writeJSON, FILES } = require('./paths');
const log = require('./logger');

// ── Available Models ─────────────────────────────────────────────
const MODELS = [
  {
    id: 'claude-sonnet-4-5-20250929',
    label: 'Sonnet',
    description: 'Balanced — code, writing, analysis',
    tier: 'balanced',
  },
  {
    id: 'claude-opus-4-6',
    label: 'Opus',
    description: 'Deep analysis — complex reasoning',
    tier: 'deep',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    label: 'Haiku',
    description: 'Quick questions — fast responses',
    tier: 'quick',
  },
];

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

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
  if (!message || typeof message !== 'string') return 'balanced';

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
 * Resolve which model to use for a message.
 *
 * Priority:
 *   1. Explicit override (user picked a model manually)
 *   2. Auto-route based on message intent
 *   3. Persisted default from settings
 *   4. Hardcoded default (Sonnet)
 *
 * @param {string} message - The user's message
 * @param {string|null} override - Manual model override (null = auto)
 * @returns {{ modelId: string, tier: string, auto: boolean }}
 */
function resolveModel(message, override) {
  // Manual override always wins
  if (override && override !== 'auto') {
    const model = MODELS.find((m) => m.id === override);
    if (model) {
      return { modelId: model.id, tier: model.tier, auto: false };
    }
  }

  // Auto-route: check if auto-routing is enabled
  const settings = readJSON(FILES.settings, {});
  const autoRoute = settings.forgeframe?.autoRoute !== false; // default: on

  if (autoRoute && override !== 'manual-lock') {
    const tier = detectIntent(message);
    const model = MODELS.find((m) => m.tier === tier);
    if (model) {
      return { modelId: model.id, tier, auto: true };
    }
  }

  // Fall back to persisted model or default
  const persistedModel = settings.forgeframe?.selectedModel || DEFAULT_MODEL;
  const model = MODELS.find((m) => m.id === persistedModel) || MODELS[0];
  return { modelId: model.id, tier: model.tier, auto: false };
}

/**
 * Get the currently selected model from settings.
 */
function getSelectedModel() {
  const settings = readJSON(FILES.settings, {});
  return settings.forgeframe?.selectedModel || DEFAULT_MODEL;
}

/**
 * Set the selected model in settings.
 */
function setSelectedModel(modelId) {
  const settings = readJSON(FILES.settings, {});
  if (!settings.forgeframe) settings.forgeframe = {};
  settings.forgeframe.selectedModel = modelId;
  writeJSON(FILES.settings, settings);
  log.info('ForgeFrame: model set to', modelId);
}

/**
 * Get auto-route enabled state.
 */
function getAutoRoute() {
  const settings = readJSON(FILES.settings, {});
  return settings.forgeframe?.autoRoute !== false;
}

/**
 * Set auto-route enabled state.
 */
function setAutoRoute(enabled) {
  const settings = readJSON(FILES.settings, {});
  if (!settings.forgeframe) settings.forgeframe = {};
  settings.forgeframe.autoRoute = enabled;
  writeJSON(FILES.settings, settings);
  log.info('ForgeFrame: auto-route', enabled ? 'enabled' : 'disabled');
}

module.exports = {
  MODELS,
  DEFAULT_MODEL,
  detectIntent,
  resolveModel,
  getSelectedModel,
  setSelectedModel,
  getAutoRoute,
  setAutoRoute,
};
