import type { RuntimeDocumentParticipant } from "@vetta/runtime-core";
import type { AgentFeatureDefinition } from "@vetta/runtime-core/kernel";
import {
	defineSessionExtensionService,
	type SessionExtensionDefinition,
	sessionExtensionObservation,
} from "@vetta/runtime-core/session-extensions";
import type { CodingAgentSubagentRuntime } from "./runtime.js";
import {
	CODING_AGENT_SUBAGENT_EXTENSION_ID,
	CODING_AGENT_SUBAGENTS_OBSERVATION,
} from "./subagent-session-extension-contract.js";

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
					{
						kind: "initial-observation-source",
						source: {
							id: `${CODING_AGENT_SUBAGENT_EXTENSION_ID}.initial-state`,
							read: () => {
								const snapshots = runtime?.list() ?? [];
								return snapshots.length > 0
									? [sessionExtensionObservation(CODING_AGENT_SUBAGENTS_OBSERVATION, snapshots)]
									: [];
							},
						},
					},
				],
				async dispose() {
					const owned = runtime;
					await owned?.dispose();
					if (runtime === owned) runtime = undefined;
				},
			};
		},
	};
}

function requireRuntime(runtime: CodingAgentSubagentRuntime | undefined): CodingAgentSubagentRuntime {
	if (!runtime) throw new Error("Coding Agent Subagent runtime has not been attached");
	return runtime;
}
