import type { SessionExtensionDefinition } from "@vetta/runtime-core/session-extensions";
import type { ConversationScenario } from "../../profiles/index.js";
import type { CodingAgentSessionConfigurationState } from "./configuration-state.js";
import {
	CODING_AGENT_SESSION_AGENT_MODE_SET,
	CODING_AGENT_SESSION_PROFILE_STATE_EXTENSION_ID,
	CODING_AGENT_SESSION_PROFILE_STATE_READ,
} from "./session-profile-state-extension-contract.js";

export interface CodingAgentSessionProfileStateExtensionOptions {
	readonly scenario: ConversationScenario;
	readonly configurationState: CodingAgentSessionConfigurationState;
}

export function createCodingAgentSessionProfileStateExtension(
	options: CodingAgentSessionProfileStateExtensionOptions,
): SessionExtensionDefinition {
	return {
		id: CODING_AGENT_SESSION_PROFILE_STATE_EXTENSION_ID,
		create: () => ({
			contributions: [
				{
					kind: "endpoint",
					token: CODING_AGENT_SESSION_PROFILE_STATE_READ,
					handle: () => ({
						scenario: options.scenario,
						agentMode: options.configurationState.readAgentMode(),
					}),
				},
				{
					kind: "endpoint",
					token: CODING_AGENT_SESSION_AGENT_MODE_SET,
					handle: ({ agentMode }) => options.configurationState.setAgentMode(agentMode),
				},
			],
			dispose: async () => {},
		}),
	};
}
