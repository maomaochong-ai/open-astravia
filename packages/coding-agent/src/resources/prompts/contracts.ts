import type { ResourceAccessPort } from "../contracts/resource-access.js";

/** A fully materialized prompt template snapshot. */
export interface PromptTemplate {
	readonly name: string;
	readonly description: string;
	readonly content: string;
	readonly source: string;
	readonly filePath: string;
}

export interface LoadPromptTemplatesOptions {
	readonly resourceAccess: ResourceAccessPort;
	/** Working directory used for project-local and relative explicit paths. */
	readonly cwd: string;
	/** Agent configuration directory. Defaults to ~/.vetta/agent. */
	readonly agentDir?: string;
	/** Explicit prompt template files or directories. */
	readonly promptPaths?: readonly string[];
	/** Whether to discover the standard global and project directories. */
	readonly includeDefaults?: boolean;
	readonly signal?: AbortSignal;
}
