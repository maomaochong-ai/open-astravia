import {
	defineSessionExtensionService,
	optionalSessionExtensionFunction,
	type SessionExtensionDefinition,
} from "@vetta/runtime-core/session-extensions";
import { HeavyToolConfirmationLedger, type HeavyToolConsentPort } from "./heavy-tool-confirmation.js";
import {
	CODING_AGENT_HEAVY_TOOL_POLICY_EXTENSION_ID,
	CODING_AGENT_TOOL_CONSENT_FUNCTION,
} from "./tool-consent-contract.js";

export interface CodingAgentHeavyToolPolicyRuntime {
	readonly ledger: HeavyToolConfirmationLedger;
	readonly consent: HeavyToolConsentPort;
}

export const CODING_AGENT_HEAVY_TOOL_POLICY_RUNTIME = defineSessionExtensionService<CodingAgentHeavyToolPolicyRuntime>(
	CODING_AGENT_HEAVY_TOOL_POLICY_EXTENSION_ID,
	"runtime",
);

export function createCodingAgentHeavyToolPolicySessionExtension(): SessionExtensionDefinition {
	return {
		id: CODING_AGENT_HEAVY_TOOL_POLICY_EXTENSION_ID,
		functionDependencies: [optionalSessionExtensionFunction(CODING_AGENT_TOOL_CONSENT_FUNCTION)],
		create(context) {
			const runtime: CodingAgentHeavyToolPolicyRuntime = {
				ledger: new HeavyToolConfirmationLedger(),
				consent: {
					isAvailable: () => context.functions.has(CODING_AGENT_TOOL_CONSENT_FUNCTION),
					request: ({ sessionId, toolName }, signal) =>
						context.functions.invoke(
							CODING_AGENT_TOOL_CONSENT_FUNCTION,
							{
								requestId: context.createId(),
								sessionId,
								toolName,
								reason: "heavy-side-effect",
							},
							signal,
						),
				},
			};
			return {
				contributions: [{ kind: "service", token: CODING_AGENT_HEAVY_TOOL_POLICY_RUNTIME, value: runtime }],
				dispose() {},
			};
		},
	};
}
