/**
 * ForgeFrame Bridge — Adapter from @forgeframe/core to Guardian's function-based API
 *
 * Replaces the stale fork in lib/forgeframe.ts with a thin wrapper around
 * the canonical @forgeframe/core ForgeFrameRouter class. Guardian's main.js
 * calls this module's exported functions identically to the old fork.
 */

import { ForgeFrameRouter } from '@forgeframe/core';
import type { Model, Tier, ResolvedModel, ModelInfo, ConfigStore } from '@forgeframe/core';
import { readJSON, writeJSON, FILES } from './paths';
import log = require('./logger');

// -- ConfigStore adapter for Guardian's JSON-file persistence --

const guardianConfigStore: ConfigStore = {
  read<T>(key: string, fallback: T): T {
    if (key === 'settings') return readJSON(FILES.settings, fallback as any) as T;
    return fallback;
  },
  write(key: string, data: unknown): void {
    if (key === 'settings') writeJSON(FILES.settings, data);
  },
};

// -- Default models (same as old fork) --

const DEFAULT_MODELS: Model[] = [
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

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

// -- Router instance --

const router = new ForgeFrameRouter({
  configStore: guardianConfigStore,
  logger: log,
  models: DEFAULT_MODELS,
});

// Backward-compat alias
const MODELS = DEFAULT_MODELS;

// -- Function-based API matching old fork --

function detectIntent(message: string): Tier {
  return router.detectIntent(message);
}

function resolveModel(message: string, override: string | null): ResolvedModel {
  const result = router.resolveModel(message, override);
  if (!result) {
    const fallback = DEFAULT_MODELS[0];
    return { provider: fallback.provider, modelId: fallback.id, tier: fallback.tier, auto: false };
  }
  return result;
}

function getModels(): ModelInfo[] {
  return router.getModels();
}

function getSelectedModel(): string {
  return router.getSelectedModel() || DEFAULT_MODEL;
}

function setSelectedModel(modelId: string): void {
  router.setSelectedModel(modelId);
}

function getAutoRoute(): boolean {
  return router.getAutoRoute();
}

function setAutoRoute(enabled: boolean): void {
  router.setAutoRoute(enabled);
}

function getCheapestModel(tier: Tier): Model | null {
  return router.getCheapestModel(tier);
}

/**
 * Load provider models from the database and merge with defaults.
 * Adapts Guardian's DB schema to @forgeframe/core's Model[] interface.
 */
function loadProviderModels(database: any): void {
  const models: Model[] = [...DEFAULT_MODELS];

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
    `).all() as any[];

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
  } catch (e: any) {
    log.warn('ForgeFrame: failed to load provider models:', e.message);
  }

  router.loadModels(models);
}

export {
  MODELS,
  DEFAULT_MODELS,
  DEFAULT_MODEL,
  detectIntent,
  resolveModel,
  getModels,
  getSelectedModel,
  setSelectedModel,
  getAutoRoute,
  setAutoRoute,
  loadProviderModels,
  getCheapestModel,
};

export type { Tier, Model, ResolvedModel, ModelInfo };
