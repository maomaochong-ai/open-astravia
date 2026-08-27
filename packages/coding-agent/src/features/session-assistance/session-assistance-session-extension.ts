import { defineSessionExtensionService, type SessionExtensionDefinition } from "@vetta/runtime-core/session-extensions";
import {
	CODING_AGENT_NEXT_PROMPT_SUGGESTIONS,
	CODING_AGENT_SESSION_ASSISTANCE_EXTENSION_ID,
	CODING_AGENT_SESSION_TITLE_GENERATE,
} from "./session-assistance-contract.js";
import type { CodingAgentSessionAssistanceRuntime } from "./session-assistance-runtime.js";

export interface CodingAgentSessionAssistanceRuntimeOwner {
	attach(runtime: CodingAgentSessionAssistanceRuntime): void;
	read(): CodingAgentSessionAssistanceRuntime | undefined;
}

export const CODING_AGENT_SESSION_ASSISTANCE_RUNTIME_OWNER =
	defineSessionExtensionService<CodingAgentSessionAssistanceRuntimeOwner>(
		CODING_AGENT_SESSION_ASSISTANCE_EXTENSION_ID,
		"runtime-owner",
	);

export function createCodingAgentSessionAssistanceExtension(): SessionExtensionDefinition {
	return {
		id: CODING_AGENT_SESSION_ASSISTANCE_EXTENSION_ID,
		create() {
			let runtime: CodingAgentSessionAssistanceRuntime | undefined;
			const owner: CodingAgentSessionAssistanceRuntimeOwner = {
				attach(next) {
					if (runtime) throw new Error("Coding Agent session assistance runtime is already attached");
					runtime = next;
				},
				read: () => runtime,
			};
			return {
				contributions: [
					{ kind: "service", token: CODING_AGENT_SESSION_ASSISTANCE_RUNTIME_OWNER, value: owner },
					{
						kind: "endpoint",
						token: CODING_AGENT_SESSION_TITLE_GENERATE,
						handle: ({ userText, assistantText }) =>
							requireRuntime(runtime).generateTitle(userText, assistantText),
					},
					{
						kind: "endpoint",
						token: CODING_AGENT_NEXT_PROMPT_SUGGESTIONS,
						handle: ({ conversation }) => requireRuntime(runtime).generateNextPrompts(conversation),
					},
				],
				dispose() {
					runtime = undefined;
				},
			};
		},
	};
}

function requireRuntime(runtime: CodingAgentSessionAssistanceRuntime | undefined): CodingAgentSessionAssistanceRuntime {
	if (!runtime) throw new Error("Coding Agent session assistance runtime has not been attached");
	return runtime;
}
