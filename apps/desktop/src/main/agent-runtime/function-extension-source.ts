import {
	CODING_AGENT_ASK_USER_QUESTION_FUNCTION,
	CODING_AGENT_SANDBOX_AUTHORIZATION_FUNCTION,
} from "@vetta/coding-agent/function-extensions";
import {
	SessionExtensionFunctionRegistry,
	type SessionExtensionFunctionSource,
} from "@vetta/runtime-core/session-extensions";
import { getDesktopSandboxAuthorizationBroker } from "../conversations/sandbox-authorization-broker.js";
import { getDesktopUserQuestionBroker } from "../conversations/user-question-broker.js";
import { getAppLogger } from "../logger.js";

export interface DesktopCodingAgentFunctionSourceLogger {
	warn(message: string, context: { readonly functionId: string; readonly errorName?: string }): void;
}

export interface DesktopCodingAgentFunctionSourceOptions {
	readonly logger?: DesktopCodingAgentFunctionSourceLogger;
}

/** Desktop product composition adapter; Runtime only receives the generic function source. */
export function createDesktopCodingAgentFunctionSource(
	options: DesktopCodingAgentFunctionSourceOptions = {},
): SessionExtensionFunctionSource {
	const questions = getDesktopUserQuestionBroker();
	const sandbox = getDesktopSandboxAuthorizationBroker();
	const warn: DesktopCodingAgentFunctionSourceLogger["warn"] = (message, context) =>
		(options.logger ?? getAppLogger("agent-runtime")).warn(message, context);
	const registry = new SessionExtensionFunctionRegistry();
	registry.register(CODING_AGENT_ASK_USER_QUESTION_FUNCTION, (request, signal) => questions.handle(request, signal));
	registry.register(CODING_AGENT_SANDBOX_AUTHORIZATION_FUNCTION, (request, signal) => sandbox.handle(request, signal));
	const unavailable = new Set<string>();
	const readAvailability = (functionId: string, available: boolean): boolean => {
		if (available) {
			unavailable.delete(functionId);
			return true;
		}
		if (!unavailable.has(functionId)) {
			unavailable.add(functionId);
			warn("coding agent function unavailable", { functionId });
		}
		return false;
	};

	return {
		has(token) {
			if (token.id === CODING_AGENT_ASK_USER_QUESTION_FUNCTION.id) {
				return readAvailability(token.id, questions.isAvailable());
			}
			if (token.id === CODING_AGENT_SANDBOX_AUTHORIZATION_FUNCTION.id) {
				return readAvailability(token.id, sandbox.isAvailable());
			}
			return false;
		},
		async invoke(token, input, signal) {
			try {
				return await registry.invoke(token, input, signal);
			} catch (error) {
				if (!signal?.aborted) {
					warn("coding agent function invocation failed", {
						functionId: token.id,
						errorName: error instanceof Error ? error.name : "UnknownError",
					});
				}
				throw error;
			}
		},
	};
}
