import React, { useState, useCallback } from 'react';
import useStore from '../store';
import '../styles/onboarding.css';

/**
 * Guardian Onboarding — Section VI of the Product Spec.
 *
 * 4 steps:
 *   1. Welcome — glyph, tagline, "Begin setup"
 *   2. Architecture Self-Assessment — 5 questions (TD/CD/PL signals)
 *   3. Workspace Setup — shell preference, model default, optional note import
 *   4. Transition — set onboardingComplete, open cockpit
 */

const QUESTIONS = [
  {
    text: "When you're working on a problem, can you voluntarily stop thinking about it?",
    options: [
      { label: 'Yes, easily', signal: 'td' },
      { label: 'Sometimes, with effort', signal: 'cd' },
      { label: 'Rarely \u2014 it runs until it resolves or I exhaust', signal: 'pl' },
    ],
    key: 'disengagement',
  },
  {
    text: 'Do abstract ideas (concepts, theories, code architecture) ever produce physical sensations?',
    options: [
      { label: 'No', signal: 'td' },
      { label: 'Occasionally during deep focus', signal: 'cd' },
      { label: 'Regularly \u2014 pressure, heat, or intensity in the body', signal: 'pl' },
    ],
    key: 'embodiment',
  },
  {
    text: 'When you have an insight, how do you first experience it?',
    options: [
      { label: 'As a thought or sentence', signal: 'linguistic' },
      { label: 'As a feeling that resolves into words', signal: 'mixed' },
      { label: 'As a full-body sensation before any words form', signal: 'somatic' },
    ],
    key: 'encoding',
  },
  {
    text: 'How many "open threads" (unresolved thoughts, half-formed ideas, things you\'re tracking) do you estimate you\'re holding right now?',
    options: [
      { label: '1\u20133', signal: 'low' },
      { label: '4\u20138', signal: 'moderate' },
      { label: "9+ / I can't even count", signal: 'high' },
    ],
    key: 'integrationLoad',
  },
  {
    text: 'Have you ever understood exactly why you do something counterproductive, in complete detail, and still been unable to change it?',
    options: [
      { label: 'No', signal: 'aligned' },
      { label: 'Yes, occasionally', signal: 'mild' },
      { label: 'Yes, this is my persistent experience', signal: 'trapped' },
    ],
    key: 'awarenessPattern',
  },
];

const SHELL_OPTIONS = [
  { value: 'default', label: 'System default' },
  { value: 'powershell', label: 'PowerShell' },
  { value: 'cmd', label: 'Command Prompt' },
  { value: 'bash', label: 'Bash' },
  { value: 'zsh', label: 'Zsh' },
];

const MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-5-20250929', label: 'Sonnet', desc: 'Balanced \u2014 code, writing, analysis' },
  { value: 'claude-opus-4-6', label: 'Opus', desc: 'Deep analysis \u2014 complex reasoning' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku', desc: 'Quick questions \u2014 fast responses' },
];

function deriveArchitecture(answers) {
  const archSignals = [answers.disengagement, answers.embodiment].filter(Boolean);
  const plCount = archSignals.filter((s) => s === 'pl').length;
  const cdCount = archSignals.filter((s) => s === 'cd').length;
  if (plCount >= 1) return 'pl';
  if (cdCount >= 1) return 'cd';
  return 'td';
}

function archLabel(arch) {
  if (arch === 'pl') return 'Phase-Lock';
  if (arch === 'cd') return 'Context-Dependent';
  return 'Time-Division';
}

export default function Onboarding() {
  const [phase, setPhase] = useState('welcome');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [workspace, setWorkspace] = useState({
    shell: 'default',
    model: 'claude-sonnet-4-5-20250929',
  });
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const saveProfile = useStore((s) => s.saveProfile);

  const handleAnswer = useCallback((key, signal) => {
    setAnswers((prev) => ({ ...prev, [key]: signal }));
    if (questionIndex < QUESTIONS.length - 1) {
      setQuestionIndex((i) => i + 1);
    } else {
      setPhase('workspace');
    }
  }, [questionIndex]);

  const handleImportNotes = useCallback(async () => {
    setImporting(true);
    setImportResult(null);
    try {
      const result = await window.guardian?.file.open();
      if (result?.ok && result.files?.length > 0) {
        let imported = 0;
        for (const file of result.files) {
          if (!file.isImage && file.data) {
            await window.guardian?.notes.create({
              id: Date.now().toString() + '_' + imported,
              type: 'structured',
              title: file.name.replace(/\.\w+$/, ''),
              content: file.data,
            });
            imported++;
          }
        }
        setImportResult(`${imported} note${imported !== 1 ? 's' : ''} imported`);
      }
    } catch (e) {
      console.error('[onboarding] import failed:', e);
    }
    setImporting(false);
  }, []);

  const handleComplete = useCallback(async () => {
    const architecture = deriveArchitecture(answers);

    const profile = {
      architecture,
      encoding: answers.encoding || 'linguistic',
      integrationLoad: answers.integrationLoad || 'low',
      awarenessPatterns: answers.awarenessPattern === 'trapped',
      onboardingComplete: true,
      completedAt: new Date().toISOString(),
    };

    // Save shell preference
    if (workspace.shell !== 'default') {
      try {
        await window.guardian?.config.set('preferredShell', workspace.shell);
      } catch (_) {}
    }

    // Save model preference
    try {
      await window.guardian?.model?.set(workspace.model);
    } catch (_) {}

    saveProfile(profile);
  }, [answers, workspace, saveProfile]);

  // ── Welcome ──────────────────────────────────────────────
  if (phase === 'welcome') {
    return (
      <div className="onboarding" role="dialog" aria-label="Guardian setup - Welcome">
        <div className="onboarding__glyph" aria-hidden="true">&#9672;</div>
        <div className="onboarding__title">Guardian</div>
        <div className="onboarding__subtitle">
          external cognitive infrastructure for minds that don't turn off.
        </div>
        <button className="onboarding__begin" onClick={() => setPhase('assessment')}>
          Begin setup
        </button>
      </div>
    );
  }

  // ── Architecture Self-Assessment ─────────────────────────
  if (phase === 'assessment') {
    const q = QUESTIONS[questionIndex];
    return (
      <div className="onboarding" role="dialog" aria-label={`Architecture self-assessment - Question ${questionIndex + 1} of ${QUESTIONS.length}`}>
        <div className="onboarding__step-label">
          architecture self-assessment
        </div>
        <div className="onboarding__progress" role="status" aria-live="polite" aria-label={`Question ${questionIndex + 1} of ${QUESTIONS.length}`}>
          {questionIndex + 1} / {QUESTIONS.length}
        </div>
        <div className="onboarding__question" id="onboarding-question">{q.text}</div>
        <div className="onboarding__options" role="radiogroup" aria-labelledby="onboarding-question">
          {q.options.map((opt, i) => (
            <button
              key={i}
              className="onboarding__option"
              role="radio"
              aria-checked={answers[q.key] === opt.signal}
              onClick={() => handleAnswer(q.key, opt.signal)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Workspace Setup ──────────────────────────────────────
  if (phase === 'workspace') {
    const arch = deriveArchitecture(answers);
    return (
      <div className="onboarding" role="dialog" aria-label="Workspace setup">
        <div className="onboarding__step-label">workspace setup</div>
        <div className="onboarding__arch-result" role="status" aria-live="polite">
          calibrated for <strong>{archLabel(arch)}</strong> architecture
        </div>

        <div className="onboarding__workspace">
          {/* Shell preference */}
          <div className="onboarding__field">
            <label className="onboarding__field-label" id="shell-label">preferred shell</label>
            <div className="onboarding__select-group" role="radiogroup" aria-labelledby="shell-label">
              {SHELL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`onboarding__select-btn${
                    workspace.shell === opt.value ? ' onboarding__select-btn--active' : ''
                  }`}
                  role="radio"
                  aria-checked={workspace.shell === opt.value}
                  onClick={() => setWorkspace((w) => ({ ...w, shell: opt.value }))}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Model default */}
          <div className="onboarding__field">
            <label className="onboarding__field-label" id="model-label">default model</label>
            <div className="onboarding__model-group" role="radiogroup" aria-labelledby="model-label">
              {MODEL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`onboarding__model-btn${
                    workspace.model === opt.value ? ' onboarding__model-btn--active' : ''
                  }`}
                  role="radio"
                  aria-checked={workspace.model === opt.value}
                  onClick={() => setWorkspace((w) => ({ ...w, model: opt.value }))}
                >
                  <span className="onboarding__model-name">{opt.label}</span>
                  <span className="onboarding__model-desc">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Note import */}
          <div className="onboarding__field">
            <label className="onboarding__field-label">import existing notes</label>
            <div className="onboarding__import-row">
              <button
                className="onboarding__import-btn"
                onClick={handleImportNotes}
                disabled={importing}
              >
                {importing ? 'importing...' : 'select markdown files'}
              </button>
              {importResult && (
                <span className="onboarding__import-result">{importResult}</span>
              )}
            </div>
            <span className="onboarding__field-hint">
              optional — import .md files from Obsidian or other tools
            </span>
          </div>
        </div>

        <button
          className="onboarding__begin"
          onClick={() => setPhase('transition')}
        >
          Continue
        </button>
      </div>
    );
  }

  // ── Transition ───────────────────────────────────────────
  if (phase === 'transition') {
    return (
      <div className="onboarding" role="dialog" aria-label="Guardian setup complete">
        <div className="onboarding__glyph" aria-hidden="true">&#9672;</div>
        <div className="onboarding__subtitle">
          Guardian is ready. Everything here persists — your conversations,
          your notes, your artifacts. Nothing is lost.
        </div>
        <div className="onboarding__detail">
          Type anything.
        </div>
        <button className="onboarding__begin" onClick={handleComplete}>
          Enter Guardian
        </button>
      </div>
    );
  }

  return null;
}
