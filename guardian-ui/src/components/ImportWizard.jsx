import React, { useState, useEffect, useCallback } from 'react';
import useStore from '../store';
import '../styles/import.css';

const STEPS = ['upload', 'preview', 'processing', 'complete'];

const PHASE_LABELS = {
  parsing: 'Parsing file...',
  importing: 'Importing conversations...',
  indexing: 'Building search index...',
  complete: 'Complete',
};

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function SourceBadge({ source }) {
  const label = source === 'chatgpt' ? 'ChatGPT' : source === 'claude_export' ? 'Claude' : source;
  return <span className={`import-source-badge import-source-badge--${source}`}>{label}</span>;
}

function StepIndicator({ current }) {
  const idx = STEPS.indexOf(current);
  return (
    <div className="import-wizard__steps">
      {STEPS.map((s, i) => (
        <div
          key={s}
          className={`import-wizard__step-dot${i === idx ? ' import-wizard__step-dot--active' : ''}${i < idx ? ' import-wizard__step-dot--complete' : ''}`}
        />
      ))}
    </div>
  );
}

function ImportBatchHistory({ batches }) {
  if (!batches || batches.length === 0) return null;
  return (
    <div className="import-batch-history">
      <div className="import-batch-history__title">Past imports</div>
      {batches.slice(0, 5).map((b) => (
        <div key={b.id} className="import-batch-item">
          <div className={`import-batch-item__status import-batch-item__status--${b.status}`} />
          <span className="import-batch-item__name">
            <SourceBadge source={b.source} /> {b.file_name || 'Unknown'}
          </span>
          <span className="import-batch-item__count">{b.imported_conversations || 0} imported</span>
          <span className="import-batch-item__date">{formatDate(b.started_at)}</span>
        </div>
      ))}
    </div>
  );
}

export default function ImportWizard({ onNavigateToExplorer }) {
  const fetchSessions = useStore((s) => s.fetchSessions);
  const importBatches = useStore((s) => s.importBatches);
  const fetchImportBatches = useStore((s) => s.fetchImportBatches);

  const [step, setStep] = useState('upload');
  const [filePath, setFilePath] = useState(null);
  const [fileName, setFileName] = useState('');
  const [validation, setValidation] = useState(null);
  const [importProgress, setImportProgress] = useState({ phase: '', current: 0, total: 0, percent: 0 });
  const [importStats, setImportStats] = useState(null);
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [error, setError] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Fetch batch history on mount
  useEffect(() => {
    fetchImportBatches();
  }, [fetchImportBatches]);

  // Subscribe to import progress events
  useEffect(() => {
    if (step !== 'processing') return;
    const cleanup = window.guardian?.import?.conversations?.onProgress?.((payload) => {
      setImportProgress(payload);
      if (payload.phase === 'complete') {
        // Fetch final status from backend
        if (activeBatchId) {
          window.guardian?.import?.conversations?.status(activeBatchId).then((result) => {
            if (result?.ok) {
              setImportStats({
                imported: result.batch?.imported_conversations || result.importedConversations || 0,
                skipped: result.batch?.skipped_conversations || result.skippedConversations || 0,
                errors: result.batch?.error_message ? 1 : 0,
              });
            }
          });
        }
        fetchSessions();
        fetchImportBatches();
        setStep('complete');
      }
    });
    return () => { if (cleanup) cleanup(); };
  }, [step, activeBatchId, fetchSessions, fetchImportBatches]);

  const handleFileSelect = useCallback(async (path) => {
    setError(null);
    setFilePath(path);
    setFileName(path.split(/[\\/]/).pop());

    try {
      const result = await window.guardian?.import?.conversations?.validate(path);
      if (result?.ok) {
        setValidation(result);
        setStep('preview');
      } else {
        setError(result?.error || 'Could not validate file');
      }
    } catch (e) {
      setError(e.message || 'Validation failed');
    }
  }, []);

  const handleBrowse = useCallback(async () => {
    try {
      const result = await window.guardian?.import?.conversations?.selectFile();
      if (result?.ok && result.filePath) {
        handleFileSelect(result.filePath);
      }
    } catch (e) {
      setError(e.message || 'File selection failed');
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file?.path) {
      handleFileSelect(file.path);
    }
  }, [handleFileSelect]);

  const handleStartImport = useCallback(async () => {
    setError(null);
    setStep('processing');
    setImportProgress({ phase: 'parsing', current: 0, total: 0, percent: 0 });
    try {
      const result = await window.guardian?.import?.conversations?.start(filePath);
      if (result?.ok) {
        setActiveBatchId(result.batchId);
      } else {
        setError(result?.error || 'Import failed to start');
        setStep('preview');
      }
    } catch (e) {
      setError(e.message || 'Import failed');
      setStep('preview');
    }
  }, [filePath]);

  const handleCancel = useCallback(async () => {
    if (activeBatchId) {
      await window.guardian?.import?.conversations?.cancel(activeBatchId);
    }
    // Fetch final stats even on cancel
    if (activeBatchId) {
      const result = await window.guardian?.import?.conversations?.status(activeBatchId);
      if (result?.ok) {
        setImportStats({
          imported: result.batch?.imported_conversations || result.importedConversations || 0,
          skipped: result.batch?.skipped_conversations || result.skippedConversations || 0,
          errors: 0,
        });
      }
    }
    fetchImportBatches();
    setStep('complete');
  }, [activeBatchId, fetchImportBatches]);

  const handleReset = useCallback(() => {
    setStep('upload');
    setFilePath(null);
    setFileName('');
    setValidation(null);
    setImportProgress({ phase: '', current: 0, total: 0, percent: 0 });
    setImportStats(null);
    setActiveBatchId(null);
    setError(null);
  }, []);

  return (
    <>
      <div className="settings-section__title">Memory Import</div>
      <StepIndicator current={step} />

      {error && <div className="import-wizard__error">{error}</div>}

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <>
          <div
            className={`import-drop-zone${isDragOver ? ' import-drop-zone--active' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleBrowse}
          >
            <div className="import-drop-zone__icon">{'\u21E9'}</div>
            <div className="import-drop-zone__text">
              Drop a ChatGPT or Claude export file here
            </div>
            <button
              className="import-drop-zone__browse"
              onClick={(e) => { e.stopPropagation(); handleBrowse(); }}
            >
              Browse files
            </button>
            <div className="import-drop-zone__hint">.json or .zip</div>
          </div>
          <ImportBatchHistory batches={importBatches} />
        </>
      )}

      {/* Step 2: Preview */}
      {step === 'preview' && validation && (
        <>
          <div className="import-preview-card">
            <div className="import-preview-card__row">
              <span className="import-preview-card__label">File</span>
              <span className="import-preview-card__value">{fileName}</span>
            </div>
            <div className="import-preview-card__row">
              <span className="import-preview-card__label">Format</span>
              <span className="import-preview-card__value">
                <SourceBadge source={validation.format} />
              </span>
            </div>
            <div className="import-preview-card__row">
              <span className="import-preview-card__label">Conversations</span>
              <span className="import-preview-card__value">
                {validation.conversations != null ? validation.conversations : 'Determined during import'}
              </span>
            </div>
            {validation.dateRange && (
              <div className="import-preview-card__row">
                <span className="import-preview-card__label">Date range</span>
                <span className="import-preview-card__value">
                  {formatDate(validation.dateRange.earliest)} — {formatDate(validation.dateRange.latest)}
                </span>
              </div>
            )}
            <div className="import-preview-card__row">
              <span className="import-preview-card__label">Size</span>
              <span className="import-preview-card__value">{formatBytes(validation.size)}</span>
            </div>
          </div>
          <div className="import-wizard__actions">
            <button className="settings-link" onClick={handleReset}>Back</button>
            <button className="import-wizard__confirm" onClick={handleStartImport}>Import</button>
          </div>
        </>
      )}

      {/* Step 3: Processing */}
      {step === 'processing' && (
        <>
          <div className="import-progress">
            <div className="import-progress__phase">
              {PHASE_LABELS[importProgress.phase] || importProgress.phase || 'Starting...'}
            </div>
            <div className="import-progress__bar-track">
              <div
                className="import-progress__bar-fill"
                style={{ width: `${importProgress.percent || 0}%` }}
              />
            </div>
            <div className="import-progress__stats">
              <span>{Math.round(importProgress.percent || 0)}%</span>
              {importProgress.total > 0 && (
                <span>{importProgress.current} / {importProgress.total}</span>
              )}
            </div>
          </div>
          <div className="import-wizard__actions">
            <button className="import-wizard__cancel" onClick={handleCancel}>Cancel</button>
          </div>
        </>
      )}

      {/* Step 4: Complete */}
      {step === 'complete' && (
        <div className="import-complete">
          <div className="import-complete__glyph">{'\u2713'}</div>
          <div className="import-complete__stats">
            <div className="import-complete__stat">
              <div className="import-complete__stat-value">{importStats?.imported || 0}</div>
              <div className="import-complete__stat-label">imported</div>
            </div>
            {(importStats?.skipped || 0) > 0 && (
              <div className="import-complete__stat">
                <div className="import-complete__stat-value">{importStats.skipped}</div>
                <div className="import-complete__stat-label">skipped</div>
              </div>
            )}
            {(importStats?.errors || 0) > 0 && (
              <div className="import-complete__stat">
                <div className="import-complete__stat-value import-complete__stat-value--danger">
                  {importStats.errors}
                </div>
                <div className="import-complete__stat-label">errors</div>
              </div>
            )}
          </div>
          <div className="import-wizard__actions">
            {onNavigateToExplorer && (
              <button className="import-wizard__confirm" onClick={onNavigateToExplorer}>
                View in Memory Explorer
              </button>
            )}
            <button className="settings-link" onClick={handleReset}>Import another file</button>
          </div>
        </div>
      )}
    </>
  );
}
