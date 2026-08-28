import {
	CODING_AGENT_ASK_USER_QUESTION_FUNCTION,
	CODING_AGENT_SANDBOX_AUTHORIZATION_FUNCTION,
	CODING_AGENT_TOOL_CONSENT_FUNCTION,
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

const HEAVY_TOOL_CONSENT_TEXT = {
	question: (toolName: string) => `允许在本会话中运行「${toolName}」吗？`,
	header: "工具确认",
	allowLabel: "允许",
	allowDescription: "本会话内该工具不再重复确认。",
	denyLabel: "取消",
	denyDescription: "本次调用直接失败，不产生任何副作用。",
} as const;

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
	registry.register(CODING_AGENT_TOOL_CONSENT_FUNCTION, async (request, signal) => {
		const result = await questions.handle(
			{
				requestId: request.requestId,
				sessionId: request.sessionId,
				questions: [
					{
						question: HEAVY_TOOL_CONSENT_TEXT.question(request.toolName),
						header: HEAVY_TOOL_CONSENT_TEXT.header,
						multiSelect: false,
						options: [
							{
								label: HEAVY_TOOL_CONSENT_TEXT.allowLabel,
								description: HEAVY_TOOL_CONSENT_TEXT.allowDescription,
							},
							{
								label: HEAVY_TOOL_CONSENT_TEXT.denyLabel,
								description: HEAVY_TOOL_CONSENT_TEXT.denyDescription,
							},
						],
					},
				],
			},
			signal,
		);
		return !result.cancelled &&
			result.answers.some((answer) => answer.answers.includes(HEAVY_TOOL_CONSENT_TEXT.allowLabel))
			? "allow_session"
			: "deny";
	});
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
			if (token.id === CODING_AGENT_TOOL_CONSENT_FUNCTION.id) {
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
