import type { McpOAuthStoredState } from "./oauth-state.js";

export interface McpOAuthStateStore {
	load(serverName: string): McpOAuthStoredState | undefined;
	save(serverName: string, state: McpOAuthStoredState): void;
	clear(serverName: string): void;
	hasTokens(serverName: string): boolean;
}
