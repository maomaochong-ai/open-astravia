import type { JsonValue } from "@vetta/action-rpc";

export type { JsonValue } from "@vetta/action-rpc";

export interface DebugExample {
	description: string;
	input: JsonValue;
}

export interface DebugInputSchema {
	description: string;
}

export interface DebugMetadata {
	id: string;
	category: string;
	title: string;
	summary: string;
	keywords?: string[];
	inputSchema: DebugInputSchema;
	examples: DebugExample[];
}

export interface DebugSearchResult {
	id: string;
	category: string;
	title: string;
	summary: string;
}

export interface DebugContext {
	source: "local-server";
	requestId?: string;
	signal?: AbortSignal;
}

export interface DebugDefinition extends DebugMetadata {
	validateInput: (input: unknown) => JsonValue;
	run: (input: JsonValue, context: DebugContext) => Promise<JsonValue> | JsonValue;
}

export class DebugError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly details?: JsonValue,
	) {
		super(message);
		this.name = "DebugError";
	}
}
