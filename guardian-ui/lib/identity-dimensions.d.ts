/**
 * Guardian — Identity Dimensions
 *
 * Computes weighted dimension scores from multiple data sources
 * (reframe events, knowledge graph, compression memory, notes, queue).
 * Keyword-based classification for cost-free approximation.
 *
 * Identity coherence mapping across weighted dimensions.
 */
type Dimension = 'emotional' | 'professional' | 'cognitive' | 'relational' | 'ambition' | 'worth' | 'somatic' | 'creative';
type Trend = 'increasing' | 'decreasing' | 'stable';
interface DimensionScore {
    score: number;
    reframeCount: number;
    entityCount: number;
    trend: Trend;
}
interface DimensionScoresResult {
    dimensions: Record<Dimension, DimensionScore>;
    totalActivity: number;
    dominantDimension: Dimension;
    neglectedDimension: Dimension;
    timeWindow: {
        start: string;
        end: string;
    };
}
interface TimelineEntry {
    week: string;
    dimensions: Record<Dimension, number>;
}
/** Minimal interface for the database module — typed fully when database.ts is migrated */
interface GuardianDb {
    db(): any;
}
declare const DIMENSION_KEYWORDS: Record<Dimension, string[]>;
/**
 * Compute weighted dimension scores from multiple data sources.
 */
declare function computeDimensionScores(db: GuardianDb, days?: number): DimensionScoresResult;
/**
 * Compute dimension scores for each of the last N weeks.
 */
declare function computeDimensionTimeline(db: GuardianDb, weeks?: number): TimelineEntry[];
export { computeDimensionScores, computeDimensionTimeline, DIMENSION_KEYWORDS };
export type { Dimension, DimensionScore, DimensionScoresResult, TimelineEntry, Trend };
