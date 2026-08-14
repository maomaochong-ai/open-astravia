import type { McpOAuthStateStore } from "./oauth-state-store.js";

export interface McpDeviceAuthorizationScheduler {
	now(): number;
	wait(milliseconds: number): Promise<void>;
}

export interface McpDeviceCodePresentation {
	readonly url: string;
	close(): Promise<void>;
}

export interface McpDeviceCodeInfo {
	readonly userCode: string;
	readonly verificationUri: string;
	readonly verificationUriComplete?: string;
}

export interface McpDeviceAuthorizationFlowOptions {
	readonly serverName: string;
	readonly serverUrl: string;
	readonly clientId: string;
	readonly scopes?: string;
	readonly pollTimeoutMs?: number;
	readonly fallbackIssuer: string;
	readonly store: McpOAuthStateStore;
	readonly fetchFn?: typeof fetch;
	readonly scheduler?: McpDeviceAuthorizationScheduler;
	readonly onUserCode?: (info: { userCode: string; verificationUri: string }) => void | Promise<void>;
	readonly createPresentation: (info: McpDeviceCodeInfo) => Promise<McpDeviceCodePresentation>;
	readonly openUrl: (url: string) => void | Promise<void>;
}

export interface McpDeviceAuthorizationFlowResult {
	readonly serverName: string;
	readonly serverUrl: string;
}

export class McpDeviceCodeRequestError extends Error {
	constructor(
		readonly status: number,
		readonly bodyPreview: string,
	) {
		super(`Device code request failed (${status}): ${bodyPreview}`);
		this.name = "McpDeviceCodeRequestError";
	}
}
