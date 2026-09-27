import type {
	BrowserAction,
	BrowserRuntimeInstallInput,
	BrowserRuntimeStatus,
	BrowserSession,
} from "@astravia/capability-sdk";

// ========== Errors ==========

export class BrowserAutomationError extends Error {
	public readonly code: string;
	public readonly cause?: unknown;

	constructor(code: string, message: string, options?: { cause?: unknown }) {
		super(message);
		this.name = "BrowserAutomationError";
		this.code = code;
		this.cause = options?.cause;
		Object.setPrototypeOf(this, BrowserAutomationError.prototype);
	}
}

// ========== Logger ==========

export interface BrowserAutomationLogger {
	info(message: string, meta?: Record<string, unknown>): void;
	warn(message: string, meta?: Record<string, unknown>): void;
	error(message: string, meta?: Record<string, unknown>): void;
}

// ========== Browser Engine ==========

/** 跨 BrowserEngineSession / SessionResources / BrowserSession 三处复用的核心身份字段。 */
export interface BrowserSessionIdentity {
	id: string;
	source: BrowserSession["source"];
	profile: BrowserSession["profile"];
	headed: boolean;
}

export interface BrowserEngineSession extends BrowserSessionIdentity {
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

// ========== Browser Runtime Port ==========

export interface BrowserRuntimePort {
	status(signal?: AbortSignal): Promise<BrowserRuntimeStatus>;
	install(input: BrowserRuntimeInstallInput, signal?: AbortSignal): Promise<BrowserRuntimeStatus>;
}

// ========== Session Registry ==========

export interface BrowserSessionRecord {
	namespace: string;
	session: BrowserSession;
	allowedHosts: readonly string[];
	/** 每次 navigate / act 成功返回时 +1，snapshot 后用于防 stale act。 */
	revision: number;
	currentUrl: string;
	currentTitle?: string;
	resources: SessionResources;
}

export interface SessionResources {
	configPath: string;
	profileDir?: string;
	namespace: string;
	sessionId: string;
	source: BrowserSession["source"];
	profile: BrowserSession["profile"];
	headed: boolean;
}

export interface BrowserProfilePort {
	prepareSession(input: {
		namespace: string;
		sessionId: string;
		source: BrowserSession["source"];
		profile: BrowserSession["profile"];
		headed: boolean;
	}): Promise<SessionResources>;
	releaseSession(resources: SessionResources): Promise<void>;
	listPersistentProfileSessions?(input: { namespace: string; profileId: string }): Promise<SessionResources[]>;
}
