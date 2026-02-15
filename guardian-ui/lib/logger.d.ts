/**
 * Guardian — Application Logger
 *
 * Simple file-based logger with daily rotation.
 * Writes to ~/.guardian/logs/guardian.log
 */
declare const log: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
    /** Close the stream on app shutdown */
    close(): void;
};
export = log;
