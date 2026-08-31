export type PluginBrowserSource = "managed" | "attach";
export type PluginBrowserRuntimePhase =
	| "checking"
	| "missing"
	| "outdated"
	| "browser-missing"
	| "ready"
	| "installing-runtime"
	| "installing-browser"
	| "error";

export interface PluginBrowserRuntimeStatus {
	phase: PluginBrowserRuntimePhase;
	version?: string;
	message?: string;
	recentOutput?: string;
}

export type PluginBrowserProfile = { type: "ephemeral" } | { type: "persistent"; id: string };
export type PluginBrowserSessionStatus = "starting" | "ready" | "closed" | "error";

export interface PluginBrowserSession {
	id: string;
	source: PluginBrowserSource;
	profile: PluginBrowserProfile;
	headed: boolean;
	status: PluginBrowserSessionStatus;
	createdAt: number;
}

export interface PluginBrowserSessionOptions {
	source?: PluginBrowserSource;
	profile?: PluginBrowserProfile;
	headed?: boolean;
	/** Optional subset of plugin.json browser.allowedHosts for this session. */
	allowedHosts?: string[];
}

export interface PluginBrowserPageState {
	sessionId: string;
	revision: number;
	url: string;
	title?: string;
}

export interface PluginBrowserSnapshot extends PluginBrowserPageState {
	content: string;
}

export interface PluginBrowserTextContent {
	sessionId: string;
	url: string;
	title?: string;
	text: string;
	truncated: boolean;
}

export interface PluginBrowserScreenshot {
	sessionId: string;
	revision: number;
	dataUrl: string;
}

export type PluginBrowserAction =
	| { type: "click"; target: string }
	| { type: "fill"; target: string; value: string }
	| { type: "type"; target: string; value: string }
	| { type: "select"; target: string; value: string }
	| { type: "check"; target: string; checked: boolean }
	| { type: "press"; key: string }
	| { type: "scroll"; direction: "up" | "down" | "left" | "right"; amount?: number }
	| { type: "wait"; milliseconds?: number; target?: string }
	| { type: "back" }
	| { type: "reload" };

export interface PluginBrowserActionResult extends PluginBrowserPageState {
	output?: string;
}

export interface PluginBrowserApi {
	/**
	 * Open a URL in the host's built-in browser panel. This is a display-only
	 * operation; it does not grant page content access or automation privileges.
	 */
	open(url: string): void;
	runtime: {
		status(): Promise<PluginBrowserRuntimeStatus>;
		install(step: "runtime" | "browser"): Promise<PluginBrowserRuntimeStatus>;
	};
	sessions: {
		create(options?: PluginBrowserSessionOptions): Promise<PluginBrowserSession>;
		get(sessionId: string): Promise<PluginBrowserSession>;
		close(sessionId: string): Promise<void>;
	};
	navigate(sessionId: string, url: string): Promise<PluginBrowserPageState>;
	snapshot(sessionId: string, options?: { interactiveOnly?: boolean }): Promise<PluginBrowserSnapshot>;
	readText(sessionId: string, options?: { maxChars?: number }): Promise<PluginBrowserTextContent>;
	screenshot(sessionId: string, options?: { fullPage?: boolean }): Promise<PluginBrowserScreenshot>;
	act(
		sessionId: string,
		action: PluginBrowserAction,
		options?: { snapshotRevision?: number },
	): Promise<PluginBrowserActionResult>;
}
