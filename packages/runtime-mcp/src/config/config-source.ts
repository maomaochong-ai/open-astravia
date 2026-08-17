import type { McpConfig } from "../protocol/index.js";

export interface McpConfigSource {
	loadGlobal(): McpConfig | null;
	loadProject(): McpConfig | null;
	loadMerged(): McpConfig;
	getMergedSignature(): string;
	getConfigPaths(): { readonly global: string; readonly project: string };
}
