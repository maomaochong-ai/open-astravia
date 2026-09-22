export declare function resolveInstallManifests(repoRoot?: string): Promise<string[]>;
export declare function computeInstallFingerprint(repoRoot?: string): Promise<string>;
export declare function resolveStampPath(repoRoot?: string): string;
export declare function isInstallFresh(repoRoot?: string): Promise<boolean>;
