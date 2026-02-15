/**
 * Guardian — Path Constants & Directory Initialization
 *
 * All persistent data lives under ~/.guardian/
 * This module defines the directory structure and ensures it exists.
 */
export declare const GUARDIAN_HOME: string;
export declare const DIRS: {
    readonly root: string;
    readonly config: string;
    readonly data: string;
    readonly notes: string;
    readonly notesStratch: string;
    readonly notesStructured: string;
    readonly notesJournal: string;
    readonly artifacts: string;
    readonly artifactsCode: string;
    readonly artifactsDocs: string;
    readonly artifactsMedia: string;
    readonly backups: string;
    readonly logs: string;
};
export declare const FILES: {
    readonly database: string;
    readonly settings: string;
    readonly layout: string;
    readonly profile: string;
    readonly keybindings: string;
    readonly log: string;
};
export declare function initDirectories(): void;
export declare function readJSON<T = Record<string, unknown>>(filePath: string, fallback?: T): T;
export declare function writeJSON(filePath: string, data: unknown): void;
