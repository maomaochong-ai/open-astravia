export interface CodingAgentSessionSeedTarget {
	readonly cwd: string;
	readonly parentSession?: string;
	readonly targetRootDir: string;
	readonly targetSessionId: string;
}

export interface CodingAgentSessionSeedInitializer {
	initializeSeed(target: CodingAgentSessionSeedTarget): Promise<void>;
}

export interface CodingAgentNewSessionOptions {
	readonly parentSession?: string;
	readonly seedInitializer?: CodingAgentSessionSeedInitializer;
}
