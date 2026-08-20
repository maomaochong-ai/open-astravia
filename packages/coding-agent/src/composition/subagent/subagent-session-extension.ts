import type { RuntimeDocumentParticipant } from "@vetta/runtime-core";
import type { AgentFeatureDefinition } from "@vetta/runtime-core/kernel";
import { defineSessionExtensionService, type SessionExtensionDefinition } from "@vetta/runtime-core/session-extensions";
import type { CodingAgentSubagentRuntime } from "./runtime.js";

export const CODING_AGENT_SUBAGENT_EXTENSION_ID = "coding-agent.subagents";

export interface CodingAgentSubagentRuntimeOwner {
	attach(runtime: CodingAgentSubagentRuntime): void;
	read(): CodingAgentSubagentRuntime | undefined;
}

export const CODING_AGENT_SUBAGENT_RUNTIME_OWNER = defineSessionExtensionService<CodingAgentSubagentRuntimeOwner>(
	CODING_AGENT_SUBAGENT_EXTENSION_ID,
	"runtime-owner",
);

/**
 * Session Extension owns the subagent runtime; the later context assembly only attaches the
 * fully wired instance once model, hook, MCP, persistence, and parent-session ports exist.
 */
export function createCodingAgentSubagentSessionExtension(): SessionExtensionDefinition {
	return {
		id: CODING_AGENT_SUBAGENT_EXTENSION_ID,
		async create() {
			let runtime: CodingAgentSubagentRuntime | undefined;
			const owner: CodingAgentSubagentRuntimeOwner = {
				attach(next) {
					if (runtime) throw new Error("Coding Agent Subagent runtime is already attached");
					runtime = next;
				},
				read: () => runtime,
			};
			const feature: AgentFeatureDefinition = {
				id: "coding-agent-subagents",
				prepare: (context) => requireRuntime(runtime).feature.prepare(context),
			};
			const participant: RuntimeDocumentParticipant = {
				initialize: (document, context) => requireRuntime(runtime).initialize(document, context),
				onDocumentChanged: (document) => requireRuntime(runtime).onDocumentChanged(document),
				onSessionEvent: (event) => requireRuntime(runtime).onSessionEvent(event),
			};
			return {
				contributions: [
					{ kind: "service", token: CODING_AGENT_SUBAGENT_RUNTIME_OWNER, value: owner },
					{ kind: "agent-feature", feature },
					{ kind: "document-participant", participant },
				],
				async dispose() {
					const owned = runtime;
					runtime = undefined;
					await owned?.dispose();
				},
			};
		},
	};
}

function requireRuntime(runtime: CodingAgentSubagentRuntime | undefined): CodingAgentSubagentRuntime {
	if (!runtime) throw new Error("Coding Agent Subagent runtime has not been attached");
	return runtime;
}
