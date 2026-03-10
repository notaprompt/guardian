/**
 * ForgeFrame Bridge — Adapter from @forgeframe/core to Guardian's function-based API
 *
 * Replaces the stale fork in lib/forgeframe.ts with a thin wrapper around
 * the canonical @forgeframe/core ForgeFrameRouter class. Guardian's main.js
 * calls this module's exported functions identically to the old fork.
 */
import type { Model, Tier, ResolvedModel, ModelInfo } from '@forgeframe/core';
declare const DEFAULT_MODELS: Model[];
declare const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
declare const MODELS: Model[];
declare function detectIntent(message: string): Tier;
declare function resolveModel(message: string, override: string | null): ResolvedModel;
declare function getModels(): ModelInfo[];
declare function getSelectedModel(): string;
declare function setSelectedModel(modelId: string): void;
declare function getAutoRoute(): boolean;
declare function setAutoRoute(enabled: boolean): void;
declare function getCheapestModel(tier: Tier): Model | null;
/**
 * Load provider models from the database and merge with defaults.
 * Adapts Guardian's DB schema to @forgeframe/core's Model[] interface.
 */
declare function loadProviderModels(database: any): void;
export { MODELS, DEFAULT_MODELS, DEFAULT_MODEL, detectIntent, resolveModel, getModels, getSelectedModel, setSelectedModel, getAutoRoute, setAutoRoute, loadProviderModels, getCheapestModel, };
export type { Tier, Model, ResolvedModel, ModelInfo };
