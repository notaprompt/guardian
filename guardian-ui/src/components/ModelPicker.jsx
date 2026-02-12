import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import useStore from '../store';
import '../styles/model-picker.css';

const TIER_LABELS = {
  balanced: 'Sonnet',
  deep: 'Opus',
  quick: 'Haiku',
};

// Map provider IDs/types to display labels
function getProviderGroupLabel(provider) {
  if (!provider || provider === 'claude-cli') return 'Claude (CLI)';
  return provider;
}

export default function ModelPicker() {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  const selectedModel = useStore((s) => s.selectedModel);
  const autoRoute = useStore((s) => s.autoRoute);
  const lastAutoTier = useStore((s) => s.lastAutoTier);
  const models = useStore((s) => s.models);
  const providers = useStore((s) => s.providers);
  const providerModels = useStore((s) => s.providerModels);
  const setSelectedModel = useStore((s) => s.setSelectedModel);
  const setAutoRoute = useStore((s) => s.setAutoRoute);

  // Build grouped model list: default CLI models first, then each provider
  const groupedModels = useMemo(() => {
    const groups = [];

    // Default Claude CLI models
    const cliModels = models.filter((m) => !m.provider || m.provider === 'claude-cli');
    if (cliModels.length > 0) {
      groups.push({ label: 'Claude (CLI)', models: cliModels });
    }

    // Provider models from providerModels map
    for (const prov of providers) {
      if (!prov.enabled) continue;
      const pModels = providerModels[prov.id];
      if (!pModels || pModels.length === 0) continue;

      // Normalize provider model entries to match model shape
      const normalized = pModels.map((pm) => ({
        id: pm.model_id || pm.id,
        label: pm.label || pm.model_id || pm.id,
        description: pm.description || '',
        tier: pm.tier || 'balanced',
        provider: prov.id,
        providerName: prov.name,
      }));

      groups.push({ label: prov.name || getProviderGroupLabel(prov.type), models: normalized });
    }

    // Also include any models in the store models array that have non-CLI providers
    // but aren't already covered by providerModels
    const coveredIds = new Set();
    for (const g of groups) {
      for (const m of g.models) coveredIds.add(m.id);
    }
    const extraModels = models.filter((m) => m.provider && m.provider !== 'claude-cli' && !coveredIds.has(m.id));
    if (extraModels.length > 0) {
      // Group by providerName or provider
      const byProvider = {};
      for (const m of extraModels) {
        const key = m.providerName || m.provider;
        if (!byProvider[key]) byProvider[key] = [];
        byProvider[key].push(m);
      }
      for (const [label, mods] of Object.entries(byProvider)) {
        groups.push({ label, models: mods });
      }
    }

    return groups;
  }, [models, providers, providerModels]);

  // Flatten all models for lookup
  const allModels = useMemo(() => {
    const flat = [];
    for (const g of groupedModels) {
      for (const m of g.models) flat.push(m);
    }
    return flat;
  }, [groupedModels]);

  // Find the active model object
  const activeModel = allModels.find((m) => m.id === selectedModel) || models[0];
  const displayLabel = autoRoute && lastAutoTier
    ? TIER_LABELS[lastAutoTier] || activeModel?.label
    : activeModel?.label;

  const displayTier = autoRoute && lastAutoTier
    ? lastAutoTier
    : activeModel?.tier;

  // Provider hint for trigger tooltip
  const providerHint = activeModel?.providerName
    ? ` via ${activeModel.providerName}`
    : '';

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const handleSelect = useCallback((modelId) => {
    setSelectedModel(modelId);
    setOpen(false);
  }, [setSelectedModel]);

  const handleToggleAutoRoute = useCallback(() => {
    setAutoRoute(!autoRoute);
  }, [autoRoute, setAutoRoute]);

  const hasMultipleGroups = groupedModels.length > 1;

  return (
    <div className="model-picker" ref={dropdownRef}>
      <button
        className={`model-picker__trigger${open ? ' model-picker__trigger--open' : ''}${autoRoute ? ' model-picker__trigger--auto' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={`Model: ${activeModel?.id || 'unknown'}${providerHint}${autoRoute ? ' (auto-route)' : ''}`}
      >
        <span className={`model-picker__dot model-picker__dot--${displayTier}`} />
        <span>{displayLabel}</span>
        {autoRoute && <span className="model-picker__auto-badge">auto</span>}
        <span className="model-picker__chevron">&#9660;</span>
      </button>

      {open && (
        <div className="model-picker__dropdown">
          <div className="model-picker__header">
            <span className="model-picker__header-label">ForgeFrame</span>
            <button
              className="model-picker__auto-toggle"
              onClick={handleToggleAutoRoute}
              title={autoRoute ? 'Disable auto-routing' : 'Enable auto-routing'}
            >
              <span>auto-route</span>
              <span className={`model-picker__auto-switch${autoRoute ? ' model-picker__auto-switch--on' : ''}`} />
            </button>
          </div>
          <div className="model-picker__options">
            {groupedModels.map((group) => (
              <div key={group.label} className="model-picker__group">
                {hasMultipleGroups && (
                  <div className="model-picker__group-header">{group.label}</div>
                )}
                {group.models.map((model) => (
                  <button
                    key={`${model.provider || 'cli'}-${model.id}`}
                    className={`model-picker__option${model.id === selectedModel ? ' model-picker__option--active' : ''}`}
                    onClick={() => handleSelect(model.id)}
                  >
                    <span className={`model-picker__option-dot model-picker__dot--${model.tier}`} />
                    <span className="model-picker__option-info">
                      <span className="model-picker__option-label">
                        {model.label}
                        {hasMultipleGroups && model.providerName && (
                          <span className="model-picker__option-provider">{model.providerName}</span>
                        )}
                      </span>
                      <span className="model-picker__option-desc">{model.description}</span>
                    </span>
                    <span className="model-picker__option-check">&#10003;</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
