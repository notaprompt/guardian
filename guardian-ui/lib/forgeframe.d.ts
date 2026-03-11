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
type Tier = 'quick' | 'balanced' | 'deep';
interface Model {
    id: string;
    label: string;
    provider: string;
    providerName?: string | null;
    providerType?: string;
    baseUrl?: string | null;
    description: string;
    tier: Tier;
}
interface ResolvedModel {
    provider: string;
    modelId: string;
    tier: Tier;
    auto: boolean;
}
interface ModelInfo {
    id: string;
    label: string;
    provider: string;
    providerName: string | null;
    description: string;
    tier: Tier;
}
declare const DEFAULT_MODELS: Model[];
declare const MODELS: Model[];
declare const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
/**
 * Load provider models from the database and merge with defaults.
 * Call once during app initialization (after database is open).
 */
declare function loadProviderModels(database: any): void;
/**
 * Detect intent tier from a user message.
 * Returns 'deep', 'quick', or 'balanced'.
 */
declare function detectIntent(message: string): Tier;
/**
 * Find the cheapest model for a given tier.
 * External providers are presumed cheaper than claude-cli.
 * Falls back to the first model matching the tier, or null.
 */
declare function getCheapestModel(tier: Tier): Model | null;
/**
 * Resolve which model to use for a message.
 *
 * Priority:
 *   1. Explicit override (user picked a model manually)
 *   2. Auto-route based on message intent (with cost-tier optimization)
 *   3. Persisted default from settings
 *   4. Hardcoded default (Sonnet)
 */
declare function resolveModel(message: string, override: string | null): ResolvedModel;
/**
 * Get all available models (default + provider).
 * Each entry includes the provider field.
 */
declare function getModels(): ModelInfo[];
/**
 * Get the currently selected model from settings.
 */
declare function getSelectedModel(): string;
/**
 * Set the selected model in settings.
 */
declare function setSelectedModel(modelId: string): void;
/**
 * Get auto-route enabled state.
 */
declare function getAutoRoute(): boolean;
/**
 * Set auto-route enabled state.
 */
declare function setAutoRoute(enabled: boolean): void;
export { MODELS, DEFAULT_MODELS, DEFAULT_MODEL, detectIntent, resolveModel, getModels, getSelectedModel, setSelectedModel, getAutoRoute, setAutoRoute, loadProviderModels, getCheapestModel, };
export type { Tier, Model, ResolvedModel, ModelInfo };
