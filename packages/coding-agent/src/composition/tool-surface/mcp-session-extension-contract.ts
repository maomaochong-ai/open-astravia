import type { RuntimeFailure, SessionEvent } from "@vetta/runtime-core";
import { readRuntimeFailure } from "@vetta/runtime-core/failures";
import { defineSessionExtensionObservation } from "@vetta/runtime-core/session-extensions";

export const CODING_AGENT_MCP_EXTENSION_ID = "coding-agent.mcp";

export const CODING_AGENT_MCP_RELOAD_STARTED = defineSessionExtensionObservation<Record<string, never>>(
	CODING_AGENT_MCP_EXTENSION_ID,
	"reload.started",
);

export interface CodingAgentMcpReloadResult {
	readonly changed: boolean;
	readonly errorMessage?: string;
	readonly failure?: RuntimeFailure;
}

export const CODING_AGENT_MCP_RELOAD_FINISHED = defineSessionExtensionObservation<CodingAgentMcpReloadResult>(
	CODING_AGENT_MCP_EXTENSION_ID,
	"reload.finished",
);

export function isCodingAgentMcpReloadStarted(event: SessionEvent): boolean {
	return (
		event.type === "session.extension" &&
		event.extensionId === CODING_AGENT_MCP_RELOAD_STARTED.extensionId &&
		event.event === CODING_AGENT_MCP_RELOAD_STARTED.event &&
		isRecord(event.payload)
	);
}

export function readCodingAgentMcpReloadFinished(event: SessionEvent): CodingAgentMcpReloadResult | undefined {
	if (
		event.type !== "session.extension" ||
		event.extensionId !== CODING_AGENT_MCP_RELOAD_FINISHED.extensionId ||
		event.event !== CODING_AGENT_MCP_RELOAD_FINISHED.event ||
		!isRecord(event.payload) ||
		typeof event.payload.changed !== "boolean" ||
		(event.payload.errorMessage !== undefined && typeof event.payload.errorMessage !== "string")
	) {
		return undefined;
	}
	const failure = readRuntimeFailure(event.payload.failure);
	if (event.payload.failure !== undefined && !failure) return undefined;
	return {
		changed: event.payload.changed,
		...(event.payload.errorMessage === undefined ? {} : { errorMessage: event.payload.errorMessage }),
		...(failure ? { failure } : {}),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
