import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import useStore from '../store';
import '../styles/settings.css';

const ImportWizard = lazy(() => import('./ImportWizard'));

const SECTIONS = [
  { id: 'profile',       label: 'Profile',        icon: '\u25C7' },
  { id: 'model',         label: 'AI Model',       icon: '\u2726' },
  { id: 'providers',     label: 'Providers',      icon: '\u2699' },
  { id: 'apikeys',       label: 'API Keys',       icon: '\u2616' },
  { id: 'context',       label: 'Context',         icon: '\u2630' },
  { id: 'detection',     label: 'Detection',       icon: '\u25CE' },
  { id: 'accessibility', label: 'Accessibility',   icon: '\u2316' },
  { id: 'data',          label: 'Data',            icon: '\u2302' },
  { id: 'import',        label: 'Memory Import',   icon: '\u21E9' },
  { id: 'usage',         label: 'Usage Stats',     icon: '\u2261' },
  { id: 'shortcuts',     label: 'Shortcuts',       icon: '\u2328' },
  { id: 'about',         label: 'About',           icon: '\u2609' },
];

const SHORTCUTS = [
  { action: 'Focus Terminal',          keys: 'Ctrl+1' },
  { action: 'Focus Chat',             keys: 'Ctrl+2' },
  { action: 'Toggle Sidebar',         keys: 'Ctrl+3' },
  { action: 'Command Palette',        keys: 'Ctrl+Shift+P' },
  { action: 'Quick Search',           keys: 'Ctrl+K' },
  { action: 'New Scratch Note',       keys: 'Ctrl+N' },
  { action: 'New Structured Note',    keys: 'Ctrl+Shift+N' },
  { action: 'Send Chat Message',      keys: 'Ctrl+Enter' },
  { action: 'Maximize Panel',         keys: 'Ctrl+Shift+M' },
  { action: 'Open Settings',          keys: 'Ctrl+,' },
  { action: 'Close/Escape',           keys: 'Escape' },
];

const ARCHITECTURE_LABELS = {
  pl: 'Phase-Lock (PL)',
  cd: 'Context-Dependent (CD)',
  td: 'Time-Division (TD)',
};

function Toggle({ value, onChange }) {
  return (
    <button
      type="button"
      className={`settings-toggle${value ? ' settings-toggle--on' : ''}`}
      onClick={() => onChange(!value)}
      aria-pressed={value}
    >
      <span className="settings-toggle__knob" />
    </button>
  );
}

function SettingsPanelInner() {
  const settingsOpen = useStore((s) => s.settingsOpen);
  const toggleSettings = useStore((s) => s.toggleSettings);
  const profile = useStore((s) => s.profile);
  const saveProfile = useStore((s) => s.saveProfile);
  const models = useStore((s) => s.models);
  const selectedModel = useStore((s) => s.selectedModel);
  const setSelectedModel = useStore((s) => s.setSelectedModel);
  const autoRoute = useStore((s) => s.autoRoute);
  const setAutoRoute = useStore((s) => s.setAutoRoute);
  const systemInfo = useStore((s) => s.systemInfo);
  const highContrast = useStore((s) => s.highContrast);
  const setHighContrast = useStore((s) => s.setHighContrast);
  const reducedMotion = useStore((s) => s.reducedMotion);
  const setReducedMotion = useStore((s) => s.setReducedMotion);
  const providers = useStore((s) => s.providers);
  const fetchProviders = useStore((s) => s.fetchProviders);
  const addProvider = useStore((s) => s.addProvider);
  const removeProvider = useStore((s) => s.removeProvider);
  const testProvider = useStore((s) => s.testProvider);
  const apiKeyStatus = useStore((s) => s.apiKeyStatus);
  const setApiKey = useStore((s) => s.setApiKey);
  const deleteApiKey = useStore((s) => s.deleteApiKey);
  const fetchApiKeyStatus = useStore((s) => s.fetchApiKeyStatus);
  const testApiKey = useStore((s) => s.testApiKey);
  const panelRef = useRef(null);
  const [activeSection, setActiveSection] = useState('profile');

  // Local config state loaded from backend
  const [config, setConfig] = useState({
    notesInjection: true,
    maxContextTokens: 2000,
    awarenessTrap: true,
    quietMode: false,
    backupFrequency: 'weekly',
  });

  // Load config from backend on open
  useEffect(() => {
    if (!settingsOpen) return;
    setActiveSection('profile');
    window.guardian?.config.get().then((result) => {
      if (result?.ok && result.value) {
        const s = result.value;
        setConfig((prev) => ({
          ...prev,
          notesInjection: s.notesInjection !== false,
          maxContextTokens: s.maxContextTokens || 2000,
          awarenessTrap: s.awarenessTrap !== false,
          quietMode: s.quietMode === true,
          backupFrequency: s.backupFrequency || 'weekly',
        }));
      }
    });
  }, [settingsOpen]);

  const setQuietMode = useStore((s) => s.setQuietMode);

  // Persist a single config key
  const updateConfig = useCallback((key, value) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    if (key === 'quietMode') {
      setQuietMode(value);
    } else {
      window.guardian?.config.set(key, value).catch(() => {});
    }
  }, [setQuietMode]);

  // Escape to close + focus trap
  useEffect(() => {
    if (!settingsOpen) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        toggleSettings();
        return;
      }
      // Focus trap
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll(
          'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [settingsOpen, toggleSettings]);

  // Click overlay background to close
  const handleOverlayClick = useCallback((e) => {
    if (e.target === e.currentTarget) {
      toggleSettings();
    }
  }, [toggleSettings]);

  if (!settingsOpen) return null;

  const guardianHome = systemInfo?.guardianHome || '~/.guardian';

  return (
    <div className="settings-overlay" onClick={handleOverlayClick} role="dialog" aria-modal="true" aria-label="Settings">
      <div className="settings-panel" ref={panelRef}>
        {/* Header */}
        <div className="settings-header">
          <span className="settings-header__title">Settings</span>
          <button
            className="settings-header__close"
            onClick={toggleSettings}
            title="Close (Escape)"
            aria-label="Close settings"
          >
            &times;
          </button>
        </div>

        {/* Body: sidebar + content */}
        <div className="settings-body">
          {/* Sidebar navigation */}
          <nav className="settings-nav">
            {SECTIONS.map((sec) => (
              <button
                key={sec.id}
                className={`settings-nav__item${activeSection === sec.id ? ' settings-nav__item--active' : ''}`}
                onClick={() => setActiveSection(sec.id)}
              >
                <span className="settings-nav__icon">{sec.icon}</span>
                {sec.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="settings-content">
            {activeSection === 'profile' && (
              <ProfileSection profile={profile} saveProfile={saveProfile} />
            )}
            {activeSection === 'model' && (
              <ModelSection
                models={models}
                selectedModel={selectedModel}
                setSelectedModel={setSelectedModel}
                autoRoute={autoRoute}
                setAutoRoute={setAutoRoute}
              />
            )}
            {activeSection === 'providers' && (
              <ProvidersSection
                providers={providers}
                fetchProviders={fetchProviders}
                addProvider={addProvider}
                removeProvider={removeProvider}
                testProvider={testProvider}
              />
            )}
            {activeSection === 'apikeys' && (
              <ApiKeysSection
                apiKeyStatus={apiKeyStatus}
                setApiKey={setApiKey}
                deleteApiKey={deleteApiKey}
                fetchApiKeyStatus={fetchApiKeyStatus}
                testApiKey={testApiKey}
              />
            )}
            {activeSection === 'context' && (
              <ContextSection config={config} updateConfig={updateConfig} />
            )}
            {activeSection === 'detection' && (
              <DetectionSection config={config} updateConfig={updateConfig} />
            )}
            {activeSection === 'accessibility' && (
              <AccessibilitySection
                highContrast={highContrast}
                setHighContrast={setHighContrast}
                reducedMotion={reducedMotion}
                setReducedMotion={setReducedMotion}
              />
            )}
            {activeSection === 'data' && (
              <DataSection
                guardianHome={guardianHome}
                config={config}
                updateConfig={updateConfig}
              />
            )}
            {activeSection === 'import' && (
              <Suspense fallback={<div className="settings-section__title">Loading...</div>}>
                <ImportWizard onNavigateToExplorer={() => {
                  toggleSettings();
                  useStore.getState().setActiveSidebarPanel('memory');
                }} />
              </Suspense>
            )}
            {activeSection === 'usage' && <UsageStatsSection />}
            {activeSection === 'shortcuts' && <ShortcutsSection />}
            {activeSection === 'about' && <AboutSection />}
          </div>
        </div>

        {/* Footer */}
        <div className="settings-footer">
          <span className="settings-footer__hint">
            <kbd>Esc</kbd> close
          </span>
          <span className="settings-footer__hint">
            <kbd>Ctrl+,</kbd> toggle
          </span>
        </div>
      </div>
    </div>
  );
}

export default React.memo(SettingsPanelInner);

// ── Section Components ──────────────────────────────────────────

function ProfileSection({ profile, saveProfile }) {
  const archLabel = ARCHITECTURE_LABELS[profile?.architecture] || 'Not assessed';

  const handleRetake = () => {
    // Clear onboarding to re-trigger the assessment flow
    saveProfile({ ...profile, onboardingComplete: false });
    // Reload to show onboarding
    window.location.reload();
  };

  return (
    <>
      <div className="settings-section__title">Profile</div>
      <div className="settings-row">
        <div className="settings-row__info">
          <div className="settings-row__label">Architecture Type</div>
          <div className="settings-row__desc">
            Your cognitive architecture as identified during self-assessment
          </div>
        </div>
        <div className="settings-row__control">
          <span className="settings-value">{archLabel}</span>
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-row__info">
          <div className="settings-row__label">Encoding Preference</div>
          <div className="settings-row__desc">
            How you first experience insights
          </div>
        </div>
        <div className="settings-row__control">
          <span className="settings-value">
            {profile?.encodingPreference || 'Not set'}
          </span>
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-row__info">
          <div className="settings-row__label">Integration Load</div>
          <div className="settings-row__desc">
            Current estimated open-thread capacity
          </div>
        </div>
        <div className="settings-row__control">
          <span className="settings-value">
            {profile?.integrationLoad || 'Not set'}
          </span>
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-row__info">
          <div className="settings-row__label">Re-take Assessment</div>
          <div className="settings-row__desc">
            Restart the architecture self-assessment flow
          </div>
        </div>
        <div className="settings-row__control">
          <button className="settings-link" onClick={handleRetake}>
            Re-take
          </button>
        </div>
      </div>
    </>
  );
}

function ModelSection({ models, selectedModel, setSelectedModel, autoRoute, setAutoRoute }) {
  return (
    <>
      <div className="settings-section__title">AI Model</div>
      <div className="settings-row">
        <div className="settings-row__info">
          <div className="settings-row__label">Default Model</div>
          <div className="settings-row__desc">
            Model used when auto-routing is off or no intent signal is detected
          </div>
        </div>
        <div className="settings-row__control">
          <select
            className="settings-select"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} &mdash; {m.description}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-row__info">
          <div className="settings-row__label">Auto-Route (ForgeFrame)</div>
          <div className="settings-row__desc">
            Automatically select the optimal model based on message intent.
            Quick questions route to Haiku, deep analysis to Opus.
          </div>
        </div>
        <div className="settings-row__control">
          <Toggle value={autoRoute} onChange={setAutoRoute} />
        </div>
      </div>
    </>
  );
}

const PROVIDER_TYPES = [
  { type: 'anthropic', name: 'Anthropic (API)' },
  { type: 'openai',    name: 'OpenAI' },
  { type: 'moonshot',  name: 'Moonshot (Kimi)' },
];

function ProvidersSection({ providers, fetchProviders, addProvider, removeProvider, testProvider }) {
  const [addType, setAddType] = useState('');
  const [testResults, setTestResults] = useState({}); // { [id]: 'testing'|'available'|'unavailable' }

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const handleAdd = async () => {
    if (!addType) return;
    const pt = PROVIDER_TYPES.find((p) => p.type === addType);
    if (!pt) return;
    await addProvider({ name: pt.name, type: pt.type, enabled: true });
    setAddType('');
  };

  const handleTest = async (id) => {
    setTestResults((prev) => ({ ...prev, [id]: 'testing' }));
    try {
      const result = await testProvider(id);
      setTestResults((prev) => ({ ...prev, [id]: result ? 'available' : 'unavailable' }));
    } catch {
      setTestResults((prev) => ({ ...prev, [id]: 'unavailable' }));
    }
  };

  const handleRemove = async (id) => {
    await removeProvider(id);
  };

  return (
    <>
      <div className="settings-section__title">Providers</div>
      <div className="settings-row">
        <div className="settings-row__info">
          <div className="settings-row__desc">
            Configure AI model providers. Each provider can expose multiple models for ForgeFrame routing.
          </div>
        </div>
      </div>
      {providers.map((p) => {
        const status = testResults[p.id] || (p.enabled ? 'idle' : 'disabled');
        return (
          <div key={p.id} className="settings-provider-card">
            <div className="settings-provider-card__info">
              <span className="settings-provider-card__name">{p.name}</span>
              <span className="settings-provider-card__type">{p.type}</span>
            </div>
            <div className="settings-provider-card__status">
              <span className={
                `settings-provider-card__status-dot${
                  status === 'available' ? ' settings-provider-card__status-dot--available' :
                  status === 'unavailable' ? ' settings-provider-card__status-dot--unavailable' : ''
                }`
              } />
              {status === 'testing' ? 'testing...' : status === 'available' ? 'available' : status === 'unavailable' ? 'unavailable' : p.enabled ? 'enabled' : 'disabled'}
            </div>
            <div className="settings-provider-card__actions">
              <button className="settings-provider-card__btn" onClick={() => handleTest(p.id)}>
                Test
              </button>
              <button className="settings-provider-card__btn settings-provider-card__btn--remove" onClick={() => handleRemove(p.id)}>
                Remove
              </button>
            </div>
          </div>
        );
      })}
      {providers.length === 0 && (
        <div className="settings-row">
          <div className="settings-row__info">
            <div className="settings-row__desc">
              No providers configured. Add one below to get started.
            </div>
          </div>
        </div>
      )}
      <div className="settings-provider-add">
        <select
          className="settings-provider-add__select"
          value={addType}
          onChange={(e) => setAddType(e.target.value)}
        >
          <option value="">Add provider...</option>
          {PROVIDER_TYPES.map((pt) => (
            <option key={pt.type} value={pt.type}>{pt.name}</option>
          ))}
        </select>
        <button className="settings-link" onClick={handleAdd} disabled={!addType}>
          Add
        </button>
      </div>
    </>
  );
}

const API_KEY_PROVIDERS = [
  { type: 'anthropic', name: 'Anthropic' },
  { type: 'openai',    name: 'OpenAI' },
  { type: 'moonshot',  name: 'Moonshot' },
  { type: 'fireworks', name: 'Fireworks AI' },
];

function ApiKeysSection({ apiKeyStatus, setApiKey, deleteApiKey, fetchApiKeyStatus, testApiKey }) {
  const [inputValues, setInputValues] = useState({});

  useEffect(() => {
    fetchApiKeyStatus();
  }, [fetchApiKeyStatus]);

  const handleSave = async (provider) => {
    const key = inputValues[provider];
    if (!key || !key.trim()) return;
    await setApiKey(provider, key.trim());
    setInputValues((prev) => ({ ...prev, [provider]: '' }));
  };

  const handleTest = async (provider) => {
    await testApiKey(provider);
  };

  const handleDelete = async (provider) => {
    await deleteApiKey(provider);
    setInputValues((prev) => ({ ...prev, [provider]: '' }));
  };

  const statusLabel = (s) => {
    if (!s || s === 'unset') return 'Not set';
    if (s === 'set') return 'Set';
    if (s === 'testing') return 'Testing...';
    if (s === 'valid') return 'Valid';
    if (s === 'invalid') return 'Invalid';
    return s;
  };

  const statusDotClass = (s) => {
    if (s === 'valid') return 'settings-key-status__dot--valid';
    if (s === 'invalid') return 'settings-key-status__dot--invalid';
    if (s === 'set') return 'settings-key-status__dot--set';
    if (s === 'testing') return 'settings-key-status__dot--testing';
    return 'settings-key-status__dot--unset';
  };

  return (
    <>
      <div className="settings-section__title">API Keys</div>
      <div className="settings-row">
        <div className="settings-row__info">
          <div className="settings-row__desc">
            API keys are encrypted at rest and never leave your machine.
          </div>
        </div>
      </div>
      {API_KEY_PROVIDERS.map((p) => {
        const status = apiKeyStatus[p.type];
        const hasKey = status && status !== 'unset';
        return (
          <div key={p.type} className="settings-api-key">
            <div className="settings-api-key__provider">
              <span className="settings-api-key__provider-name">{p.name}</span>
            </div>
            <div className="settings-key-status">
              <span className={`settings-key-status__dot ${statusDotClass(status)}`} />
              {statusLabel(status)}
            </div>
            {hasKey ? (
              <span className="settings-api-key__masked">{'****' + (inputValues[p.type + '_last4'] || '')}</span>
            ) : null}
            <input
              type="password"
              className="settings-key-input"
              placeholder={hasKey ? 'Update key...' : 'Enter API key...'}
              value={inputValues[p.type] || ''}
              onChange={(e) => setInputValues((prev) => ({ ...prev, [p.type]: e.target.value }))}
            />
            <div className="settings-api-key__actions">
              <button
                className="settings-api-key__btn"
                onClick={() => handleSave(p.type)}
                disabled={!inputValues[p.type]?.trim()}
              >
                Save
              </button>
              <button
                className="settings-api-key__btn"
                onClick={() => handleTest(p.type)}
                disabled={!hasKey || status === 'testing'}
              >
                Test
              </button>
              <button
                className="settings-api-key__btn settings-api-key__btn--delete"
                onClick={() => handleDelete(p.type)}
                disabled={!hasKey}
              >
                Delete
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}

function ContextSection({ config, updateConfig }) {
  return (
    <>
      <div className="settings-section__title">Context Injection</div>
      <div className="settings-row">
        <div className="settings-row__info">
          <div className="settings-row__label">Notes Injection</div>
          <div className="settings-row__desc">
            Automatically inject your active notes as context when chatting with Claude
          </div>
        </div>
        <div className="settings-row__control">
          <Toggle
            value={config.notesInjection}
            onChange={(v) => updateConfig('notesInjection', v)}
          />
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-row__info">
          <div className="settings-row__label">Max Context Tokens</div>
          <div className="settings-row__desc">
            Maximum tokens of auto-injected context (notes, history, open threads)
          </div>
        </div>
        <div className="settings-row__control">
          <div className="settings-slider-wrap">
            <input
              type="range"
              className="settings-slider"
              min={500}
              max={4000}
              step={100}
              value={config.maxContextTokens}
              onChange={(e) => updateConfig('maxContextTokens', parseInt(e.target.value, 10))}
            />
            <span className="settings-slider__value">{config.maxContextTokens}</span>
          </div>
        </div>
      </div>
    </>
  );
}

function DetectionSection({ config, updateConfig }) {
  return (
    <>
      <div className="settings-section__title">Awareness-Trap Detection</div>
      <div className="settings-row">
        <div className="settings-row__info">
          <div className="settings-row__label">Awareness-Trap Detection</div>
          <div className="settings-row__desc">
            Monitor for recurring conversational patterns that may indicate an
            awareness trap. When detected, Guardian surfaces the
            pattern non-prescriptively. All analysis is local.
          </div>
        </div>
        <div className="settings-row__control">
          <Toggle
            value={config.awarenessTrap}
            onChange={(v) => updateConfig('awarenessTrap', v)}
          />
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-row__info">
          <div className="settings-row__label">Quiet Mode</div>
          <div className="settings-row__desc">
            Suppress proactive surfacing -- session context hints,
            pipeline digest cards, and awareness alerts. Guardian still
            collects and processes; it just won't interrupt you.
          </div>
        </div>
        <div className="settings-row__control">
          <Toggle
            value={config.quietMode}
            onChange={(v) => updateConfig('quietMode', v)}
          />
        </div>
      </div>
    </>
  );
}

function DataSection({ guardianHome, config, updateConfig }) {
  return (
    <>
      <div className="settings-section__title">Data</div>
      <div className="settings-row">
        <div className="settings-row__info">
          <div className="settings-row__label">Data Directory</div>
          <div className="settings-row__desc">
            All conversations, notes, artifacts, and configuration are stored locally
          </div>
        </div>
        <div className="settings-row__control">
          <span className="settings-value" title={guardianHome}>
            {guardianHome}
          </span>
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-row__info">
          <div className="settings-row__label">Backup Frequency</div>
          <div className="settings-row__desc">
            How often Guardian creates automatic backups of your data
          </div>
        </div>
        <div className="settings-row__control">
          <select
            className="settings-select"
            value={config.backupFrequency}
            onChange={(e) => updateConfig('backupFrequency', e.target.value)}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="manual">Manual only</option>
          </select>
        </div>
      </div>
    </>
  );
}

// ── Feature label mapping for display ─────────────────────────────
const FEATURE_LABELS = {
  'chat.message.sent': 'Chat messages sent',
  'note.created': 'Notes created',
  'note.created.scratch': 'Scratch notes',
  'note.created.structured': 'Structured notes',
  'note.created.journal': 'Journal entries',
  'search.performed': 'Total searches',
  'search.keyword': 'Keyword searches',
  'search.semantic': 'Semantic searches',
  'model.used': 'Model invocations',
  'model.opus': 'Opus usage',
  'model.sonnet': 'Sonnet usage',
  'model.haiku': 'Haiku usage',
  'session.started': 'Sessions started',
  'panel.focus.terminal': 'Terminal focus',
  'panel.focus.chat': 'Chat focus',
  'panel.focus.notes': 'Notes focus',
  'panel.focus.artifacts': 'Artifacts focus',
  'command.executed': 'Commands executed',
  'backup.created': 'Backups created',
  'queue.item.added': 'Queue items added',
  'queue.item.resolved': 'Queue items resolved',
  'export.performed': 'Exports performed',
  'import.performed': 'Imports performed',
};

function UsageStatsSection() {
  const fetchMetrics = useStore((s) => s.fetchMetrics);
  const exportMetrics = useStore((s) => s.exportMetrics);
  const metricsData = useStore((s) => s.metricsData);
  const [exportStatus, setExportStatus] = useState(null);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  const handleExport = async () => {
    const data = await exportMetrics();
    if (data) {
      // Copy to clipboard
      try {
        await navigator.clipboard.writeText(data);
        setExportStatus('copied');
      } catch (_) {
        // Fallback: show in a downloadable blob
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'guardian-usage-metrics.json';
        a.click();
        URL.revokeObjectURL(url);
        setExportStatus('downloaded');
      }
      setTimeout(() => setExportStatus(null), 3000);
    }
  };

  const features = metricsData?.featureUsage || [];
  const sessionStats = metricsData?.sessionStats || {};

  // Group features into categories for display
  const categories = [
    {
      label: 'Sessions',
      features: features.filter((f) => f.feature.startsWith('session.') || f.feature === 'chat.message.sent'),
    },
    {
      label: 'Notes',
      features: features.filter((f) => f.feature.startsWith('note.')),
    },
    {
      label: 'Search',
      features: features.filter((f) => f.feature.startsWith('search.')),
    },
    {
      label: 'Models',
      features: features.filter((f) => f.feature.startsWith('model.')),
    },
    {
      label: 'Panels',
      features: features.filter((f) => f.feature.startsWith('panel.')),
    },
    {
      label: 'Other',
      features: features.filter((f) =>
        !f.feature.startsWith('session.') &&
        f.feature !== 'chat.message.sent' &&
        !f.feature.startsWith('note.') &&
        !f.feature.startsWith('search.') &&
        !f.feature.startsWith('model.') &&
        !f.feature.startsWith('panel.')
      ),
    },
  ].filter((cat) => cat.features.length > 0);

  return (
    <>
      <div className="settings-section__title">Usage Statistics</div>

      {/* Session summary */}
      {sessionStats.totalSessions > 0 && (
        <div className="settings-row">
          <div className="settings-row__info">
            <div className="settings-row__label">Session Summary</div>
            <div className="settings-row__desc">
              {sessionStats.totalSessions} sessions, {sessionStats.totalDurationMinutes} min total, ~{sessionStats.avgDurationMinutes} min avg
            </div>
          </div>
        </div>
      )}

      {/* Feature usage by category */}
      {categories.map((cat) => (
        <div key={cat.label} style={{ marginBottom: 16 }}>
          <div className="settings-row__label" style={{ marginBottom: 6, opacity: 0.5, fontSize: 10 }}>
            {cat.label}
          </div>
          {cat.features.map((f) => (
            <div key={f.feature} className="settings-shortcut">
              <span className="settings-shortcut__action">
                {FEATURE_LABELS[f.feature] || f.feature}
              </span>
              <span className="settings-shortcut__keys">
                {f.count}
              </span>
            </div>
          ))}
        </div>
      ))}

      {features.length === 0 && (
        <div className="settings-row">
          <div className="settings-row__info">
            <div className="settings-row__desc">
              No usage data yet. Metrics are collected as you use Guardian.
            </div>
          </div>
        </div>
      )}

      {/* Export */}
      <div style={{ marginTop: 20 }}>
        <div className="settings-row">
          <div className="settings-row__info">
            <div className="settings-row__label">Export Usage Report</div>
            <div className="settings-row__desc">
              Generate an anonymized JSON report of feature usage counts.
              No personal data, no content, just aggregate counts.
              Opt-in only.
            </div>
          </div>
          <div className="settings-row__control">
            <button className="settings-link" onClick={handleExport}>
              {exportStatus === 'copied' ? 'Copied' :
               exportStatus === 'downloaded' ? 'Saved' :
               'Export'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function AccessibilitySection({ highContrast, setHighContrast, reducedMotion, setReducedMotion }) {
  return (
    <>
      <div className="settings-section__title">Accessibility</div>
      <div className="settings-row">
        <div className="settings-row__info">
          <div className="settings-row__label">High Contrast</div>
          <div className="settings-row__desc">
            Increase contrast ratios to meet WCAG AAA (7:1). Overrides theme
            colors with higher-visibility alternatives. Also activates
            automatically when your OS preference is set.
          </div>
        </div>
        <div className="settings-row__control">
          <Toggle value={highContrast} onChange={setHighContrast} />
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-row__info">
          <div className="settings-row__label">Reduced Motion</div>
          <div className="settings-row__desc">
            Disable all animations including ambient orbs, synapse pulses,
            thinking indicators, and drift messages. Also activates
            automatically when your OS requests reduced motion.
          </div>
        </div>
        <div className="settings-row__control">
          <Toggle value={reducedMotion} onChange={setReducedMotion} />
        </div>
      </div>
    </>
  );
}

function ShortcutsSection() {
  return (
    <>
      <div className="settings-section__title">Keyboard Shortcuts</div>
      <div className="settings-shortcuts">
        {SHORTCUTS.map((s) => (
          <div key={s.action} className="settings-shortcut">
            <span className="settings-shortcut__action">{s.action}</span>
            <span className="settings-shortcut__keys">{s.keys}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function AboutSection() {
  return (
    <div className="settings-about">
      <div className="settings-about__glyph">&#9672;</div>
      <div className="settings-about__name">Guardian</div>
      <div className="settings-about__version">v0.1.0</div>
      <div className="settings-about__desc">
        Neuroprotective cognitive infrastructure for high-coupling architectures.
        Grounded in cognitive identity mapping research.
      </div>
      <div className="settings-about__credit">
        Built by A. Campos, 2026
      </div>
      <div className="settings-about__credit">
        Powered by Claude (Anthropic)
      </div>
    </div>
  );
}
