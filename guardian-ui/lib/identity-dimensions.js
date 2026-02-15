"use strict";
/**
 * Guardian — Identity Dimensions
 *
 * Computes weighted dimension scores from multiple data sources
 * (reframe events, knowledge graph, compression memory, notes, queue).
 * Keyword-based classification for cost-free approximation.
 *
 * TRIM grounding: Section 9 identity coherence mapping.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIMENSION_KEYWORDS = void 0;
exports.computeDimensionScores = computeDimensionScores;
exports.computeDimensionTimeline = computeDimensionTimeline;
// ── Dimension Keywords ───────────────────────────────────────────
const DIMENSION_KEYWORDS = {
    emotional: ['feel', 'feeling', 'emotion', 'anxiety', 'stress', 'happy', 'sad', 'angry',
        'frustrated', 'overwhelmed', 'calm', 'fear', 'joy', 'grief'],
    professional: ['work', 'job', 'career', 'promotion', 'manager', 'project', 'deadline',
        'colleague', 'salary', 'role', 'company', 'interview'],
    cognitive: ['think', 'thought', 'pattern', 'recursive', 'loop', 'process', 'model',
        'framework', 'theory', 'understand', 'insight', 'realize'],
    relational: ['wife', 'husband', 'friend', 'family', 'relationship', 'trust', 'conflict',
        'partner', 'marriage', 'social', 'connection'],
    ambition: ['goal', 'future', 'plan', 'build', 'launch', 'income', 'freedom', 'legacy',
        'vision', 'strategy', 'opportunity'],
    worth: ['enough', 'deserve', 'capable', 'imposter', 'confidence', 'value', 'worth',
        'belong', 'doubt', 'prove'],
    somatic: ['body', 'weight', 'exercise', 'sleep', 'pain', 'energy', 'eat', 'physical',
        'gym', 'health', 'tired', 'muscle'],
    creative: ['build', 'design', 'create', 'art', 'write', 'make', 'aesthetic', 'craft',
        'invent', 'prototype', 'experiment'],
};
exports.DIMENSION_KEYWORDS = DIMENSION_KEYWORDS;
// Pre-compile word boundary regexes for each keyword
const DIMENSION_PATTERNS = {};
for (const [dim, keywords] of Object.entries(DIMENSION_KEYWORDS)) {
    DIMENSION_PATTERNS[dim] = keywords.map((kw) => new RegExp(`\\b${kw}\\b`, 'gi'));
}
// ── Classification ───────────────────────────────────────────────
/**
 * Classify text by counting keyword hits per dimension.
 * Uses word boundary matching to avoid partial matches.
 */
function classifyText(text) {
    const result = {};
    if (!text || typeof text !== 'string') {
        for (const dim of Object.keys(DIMENSION_KEYWORDS))
            result[dim] = 0;
        return result;
    }
    const lower = text.toLowerCase();
    for (const [dim, patterns] of Object.entries(DIMENSION_PATTERNS)) {
        let count = 0;
        for (const re of patterns) {
            re.lastIndex = 0; // reset global regex
            const matches = lower.match(re);
            if (matches)
                count += matches.length;
        }
        result[dim] = count;
    }
    return result;
}
// ── Source Weights ────────────────────────────────────────────────
const SOURCE_WEIGHTS = {
    reframes: 0.25,
    knowledgeGraph: 0.25,
    compression: 0.20,
    notes: 0.15,
    queue: 0.15,
};
// ── Dimension Score Computation ──────────────────────────────────
/**
 * Compute weighted dimension scores from multiple data sources.
 */
function computeDimensionScores(db, days = 30) {
    const now = new Date().toISOString();
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const prevCutoff = new Date(Date.now() - days * 2 * 86400000).toISOString();
    const rawDb = db.db();
    const dimensions = Object.keys(DIMENSION_KEYWORDS);
    // Initialize accumulators
    const scores = {};
    const reframeCounts = {};
    const entityCounts = {};
    for (const dim of dimensions) {
        scores[dim] = 0;
        reframeCounts[dim] = 0;
        entityCounts[dim] = 0;
    }
    let totalActivity = 0;
    // ── Source 1: Reframe Events (weight 0.25) ──────────────────
    try {
        const reframeRows = rawDb.prepare('SELECT reframe_text, identity_dimension FROM reframe_events WHERE created_at >= ?').all(cutoff);
        // Count directly from identity_dimension column
        for (const row of reframeRows) {
            if (row.identity_dimension && scores[row.identity_dimension] !== undefined) {
                reframeCounts[row.identity_dimension]++;
            }
        }
        // Also classify reframe text for additional signal
        const allReframeText = reframeRows.map((r) => r.reframe_text || '').join(' ');
        const reframeHits = classifyText(allReframeText);
        for (const dim of dimensions) {
            scores[dim] += (reframeHits[dim] + reframeCounts[dim]) * SOURCE_WEIGHTS.reframes;
        }
        totalActivity += reframeRows.length;
    }
    catch (_) {
        // reframe_events table may not exist yet
    }
    // ── Source 2: Knowledge Graph Entities (weight 0.25) ────────
    try {
        const entityRows = rawDb.prepare(`
      SELECT DISTINCT e.name FROM entities e
      JOIN relationships r ON (r.source_entity_id = e.id OR r.target_entity_id = e.id)
      JOIN sessions s ON r.session_id = s.id
      WHERE s.started_at >= ?
    `).all(cutoff);
        const allEntityText = entityRows.map((r) => r.name || '').join(' ');
        const entityHits = classifyText(allEntityText);
        for (const dim of dimensions) {
            scores[dim] += entityHits[dim] * SOURCE_WEIGHTS.knowledgeGraph;
            entityCounts[dim] = entityHits[dim];
        }
        totalActivity += entityRows.length;
    }
    catch (_) {
        // entities/relationships tables may not exist
    }
    // ── Source 3: Compression L2/L3 (weight 0.20) ──────────────
    try {
        const compressionRows = rawDb.prepare('SELECT content FROM compression_levels WHERE level >= 2 AND created_at >= ?').all(cutoff);
        const allCompressionText = compressionRows.map((r) => r.content || '').join(' ');
        const compressionHits = classifyText(allCompressionText);
        for (const dim of dimensions) {
            scores[dim] += compressionHits[dim] * SOURCE_WEIGHTS.compression;
        }
        totalActivity += compressionRows.length;
    }
    catch (_) {
        // compression_levels table may not exist
    }
    // ── Source 4: Notes (weight 0.15) ──────────────────────────
    try {
        const noteRows = rawDb.prepare('SELECT content FROM notes WHERE updated_at >= ?').all(cutoff);
        const allNoteText = noteRows.map((r) => r.content || '').join(' ');
        const noteHits = classifyText(allNoteText);
        for (const dim of dimensions) {
            scores[dim] += noteHits[dim] * SOURCE_WEIGHTS.notes;
        }
        totalActivity += noteRows.length;
    }
    catch (_) {
        // notes table may not exist
    }
    // ── Source 5: Queue Items (weight 0.15) ────────────────────
    try {
        const queueRows = rawDb.prepare('SELECT text FROM queue_items WHERE created_at >= ?').all(cutoff);
        const allQueueText = queueRows.map((r) => r.text || '').join(' ');
        const queueHits = classifyText(allQueueText);
        for (const dim of dimensions) {
            scores[dim] += queueHits[dim] * SOURCE_WEIGHTS.queue;
        }
        totalActivity += queueRows.length;
    }
    catch (_) {
        // queue_items table may not exist
    }
    // ── Normalize scores to 0-1 ────────────────────────────────
    const maxScore = Math.max(...Object.values(scores), 1); // avoid division by zero
    const normalized = {};
    for (const dim of dimensions) {
        normalized[dim] = scores[dim] / maxScore;
    }
    // ── Compute trends (compare current vs previous window) ────
    const prevScores = computeRawScores(rawDb, prevCutoff, cutoff, dimensions);
    const trends = {};
    for (const dim of dimensions) {
        const current = scores[dim];
        const previous = prevScores[dim] || 0;
        if (previous === 0 && current === 0) {
            trends[dim] = 'stable';
        }
        else if (current > previous * 1.1) {
            trends[dim] = 'increasing';
        }
        else if (current < previous * 0.9) {
            trends[dim] = 'decreasing';
        }
        else {
            trends[dim] = 'stable';
        }
    }
    // ── Find dominant and neglected dimensions ─────────────────
    let dominantDimension = dimensions[0];
    let neglectedDimension = dimensions[0];
    let maxDim = -1;
    let minDim = Infinity;
    for (const dim of dimensions) {
        if (normalized[dim] > maxDim) {
            maxDim = normalized[dim];
            dominantDimension = dim;
        }
        if (normalized[dim] < minDim) {
            minDim = normalized[dim];
            neglectedDimension = dim;
        }
    }
    // Prefer lowest non-zero for neglected
    let minNonZero = Infinity;
    let neglectedNonZero = null;
    for (const dim of dimensions) {
        if (normalized[dim] > 0 && normalized[dim] < minNonZero) {
            minNonZero = normalized[dim];
            neglectedNonZero = dim;
        }
    }
    if (neglectedNonZero)
        neglectedDimension = neglectedNonZero;
    // ── Assemble result ────────────────────────────────────────
    const result = {};
    for (const dim of dimensions) {
        result[dim] = {
            score: Math.round(normalized[dim] * 1000) / 1000,
            reframeCount: reframeCounts[dim],
            entityCount: entityCounts[dim],
            trend: trends[dim],
        };
    }
    return {
        dimensions: result,
        totalActivity,
        dominantDimension,
        neglectedDimension,
        timeWindow: { start: cutoff, end: now },
    };
}
/**
 * Compute raw (un-normalized) dimension scores for a time window.
 * Used internally for trend comparison.
 */
function computeRawScores(rawDb, startDate, endDate, dimensions) {
    const scores = {};
    for (const dim of dimensions)
        scores[dim] = 0;
    // Reframes
    try {
        const rows = rawDb.prepare('SELECT reframe_text FROM reframe_events WHERE created_at >= ? AND created_at < ?').all(startDate, endDate);
        const text = rows.map((r) => r.reframe_text || '').join(' ');
        const hits = classifyText(text);
        for (const dim of dimensions)
            scores[dim] += hits[dim] * SOURCE_WEIGHTS.reframes;
    }
    catch (_) { }
    // Entities
    try {
        const rows = rawDb.prepare(`
      SELECT DISTINCT e.name FROM entities e
      JOIN relationships r ON (r.source_entity_id = e.id OR r.target_entity_id = e.id)
      JOIN sessions s ON r.session_id = s.id
      WHERE s.started_at >= ? AND s.started_at < ?
    `).all(startDate, endDate);
        const text = rows.map((r) => r.name || '').join(' ');
        const hits = classifyText(text);
        for (const dim of dimensions)
            scores[dim] += hits[dim] * SOURCE_WEIGHTS.knowledgeGraph;
    }
    catch (_) { }
    // Compression
    try {
        const rows = rawDb.prepare('SELECT content FROM compression_levels WHERE level >= 2 AND created_at >= ? AND created_at < ?').all(startDate, endDate);
        const text = rows.map((r) => r.content || '').join(' ');
        const hits = classifyText(text);
        for (const dim of dimensions)
            scores[dim] += hits[dim] * SOURCE_WEIGHTS.compression;
    }
    catch (_) { }
    // Notes
    try {
        const rows = rawDb.prepare('SELECT content FROM notes WHERE updated_at >= ? AND updated_at < ?').all(startDate, endDate);
        const text = rows.map((r) => r.content || '').join(' ');
        const hits = classifyText(text);
        for (const dim of dimensions)
            scores[dim] += hits[dim] * SOURCE_WEIGHTS.notes;
    }
    catch (_) { }
    // Queue
    try {
        const rows = rawDb.prepare('SELECT text FROM queue_items WHERE created_at >= ? AND created_at < ?').all(startDate, endDate);
        const text = rows.map((r) => r.text || '').join(' ');
        const hits = classifyText(text);
        for (const dim of dimensions)
            scores[dim] += hits[dim] * SOURCE_WEIGHTS.queue;
    }
    catch (_) { }
    return scores;
}
// ── Timeline Computation ─────────────────────────────────────────
/**
 * Compute dimension scores for each of the last N weeks.
 */
function computeDimensionTimeline(db, weeks = 12) {
    const rawDb = db.db();
    const dimensions = Object.keys(DIMENSION_KEYWORDS);
    const timeline = [];
    for (let w = weeks - 1; w >= 0; w--) {
        const weekEnd = new Date(Date.now() - w * 7 * 86400000);
        const weekStart = new Date(weekEnd.getTime() - 7 * 86400000);
        const startStr = weekStart.toISOString();
        const endStr = weekEnd.toISOString();
        // Compute week number label
        const yearStart = new Date(weekEnd.getFullYear(), 0, 1);
        const weekNum = Math.ceil(((weekEnd.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7);
        const weekLabel = `${weekEnd.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
        const scores = computeRawScores(rawDb, startStr, endStr, dimensions);
        // Normalize this week's scores
        const maxScore = Math.max(...Object.values(scores), 1);
        const normalized = {};
        for (const dim of dimensions) {
            normalized[dim] = Math.round((scores[dim] / maxScore) * 1000) / 1000;
        }
        timeline.push({ week: weekLabel, dimensions: normalized });
    }
    return timeline;
}
