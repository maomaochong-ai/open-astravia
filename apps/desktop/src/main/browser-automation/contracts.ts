import type {
	BrowserAction,
	BrowserRuntimeInstallInput,
	BrowserRuntimeStatus,
	BrowserSession,
	BrowserSessionProfile,
	BrowserSource,
} from "@vetta/capability-sdk";

export interface BrowserAutomationLogger {
	info(message: string, fields?: Record<string, unknown>): void;
	warn(message: string, fields?: Record<string, unknown>): void;
	error(message: string, fields?: Record<string, unknown>): void;
}

export interface BrowserSessionResources {
	configPath: string;
	profilePath?: string;
	sessionDirectory: string;
	persistentProfile: boolean;
}

export interface BrowserEngineSession {
	id: string;
	source: BrowserSource;
	profile: BrowserSessionProfile;
	headed: boolean;
	configPath: string;
}

export interface BrowserEnginePageResult {
	url: string;
	title?: string;
	output?: string;
}

export interface BrowserEngine {
	navigate(session: BrowserEngineSession, url: string, signal?: AbortSignal): Promise<BrowserEnginePageResult>;
	snapshot(
		session: BrowserEngineSession,
		interactiveOnly: boolean,
		signal?: AbortSignal,
	): Promise<BrowserEnginePageResult>;
	readText(session: BrowserEngineSession, signal?: AbortSignal): Promise<BrowserEnginePageResult>;
	screenshot(
		session: BrowserEngineSession,
		fullPage: boolean,
		signal?: AbortSignal,
	): Promise<BrowserEnginePageResult & { dataUrl: string }>;
	act(session: BrowserEngineSession, action: BrowserAction, signal?: AbortSignal): Promise<BrowserEnginePageResult>;
	close(session: BrowserEngineSession, signal?: AbortSignal): Promise<void>;
}

export interface BrowserRuntimePort {
	status(signal?: AbortSignal): Promise<BrowserRuntimeStatus>;
	install(input: BrowserRuntimeInstallInput, signal?: AbortSignal): Promise<BrowserRuntimeStatus>;
}

export interface BrowserProfilePort {
	prepareSession(input: {
		namespace: string;
		sessionId: string;
		source: BrowserSource;
		profile: BrowserSessionProfile;
		headed: boolean;
	}): Promise<BrowserSessionResources>;
	releaseSession(resources: BrowserSessionResources): Promise<void>;
}

export interface BrowserSessionRecord {
	namespace: string;
	session: BrowserSession;
	allowedHosts: readonly string[];
	revision: number;
	currentUrl: string;
	currentTitle?: string;
	resources: BrowserSessionResources;
}

export type BrowserAutomationErrorCode =
	| "runtime_not_ready"
	| "session_not_found"
	| "session_forbidden"
	| "policy_denied"
	| "stale_snapshot"
	| "engine_failed"
	| "invalid_request"
	| "output_too_large";

export class BrowserAutomationError extends Error {
	constructor(
		readonly code: BrowserAutomationErrorCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "BrowserAutomationError";
	}
}
