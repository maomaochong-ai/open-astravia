import {
	defineSessionExtensionService,
	optionalSessionExtensionFunction,
	type SessionExtensionDefinition,
} from "@vetta/runtime-core/session-extensions";
import {
	CODING_AGENT_SANDBOX_AUTHORIZATION_EXTENSION_ID,
	CODING_AGENT_SANDBOX_AUTHORIZATION_FUNCTION,
	type CodingAgentSandboxAuthorizationPort,
} from "./authorization-contract.js";

export const CODING_AGENT_SANDBOX_AUTHORIZATION_RUNTIME =
	defineSessionExtensionService<CodingAgentSandboxAuthorizationPort>(
		CODING_AGENT_SANDBOX_AUTHORIZATION_EXTENSION_ID,
		"runtime",
	);

export function createCodingAgentSandboxAuthorizationSessionExtension(): SessionExtensionDefinition {
	return {
		id: CODING_AGENT_SANDBOX_AUTHORIZATION_EXTENSION_ID,
		functionDependencies: [optionalSessionExtensionFunction(CODING_AGENT_SANDBOX_AUTHORIZATION_FUNCTION)],
		create(context) {
			const runtime: CodingAgentSandboxAuthorizationPort = {
				isAvailable: () => context.functions.has(CODING_AGENT_SANDBOX_AUTHORIZATION_FUNCTION),
				request: async (sessionId, request, sensitive, signal) => {
					if (!context.functions.has(CODING_AGENT_SANDBOX_AUTHORIZATION_FUNCTION)) return "deny";
					try {
						const decision = await context.functions.invoke(
							CODING_AGENT_SANDBOX_AUTHORIZATION_FUNCTION,
							{
								requestId: context.createId(),
								sessionId,
								title: "沙箱权限请求",
								message: formatSandboxAuthorizationMessage(request, sensitive),
								toolName: request.toolName,
								capability: request.capability,
								target: request.target,
								resolvedTarget: request.resolvedTarget,
								grantRoot: request.grantRoot,
								command: request.command,
								sensitive,
							},
							signal,
						);
						return decision === "allow_session" && sensitive ? "allow_once" : decision;
					} catch (error) {
						if (signal.aborted) throw error;
						return "deny";
					}
				},
			};
			return {
				contributions: [{ kind: "service", token: CODING_AGENT_SANDBOX_AUTHORIZATION_RUNTIME, value: runtime }],
				dispose() {},
			};
		},
	};
}

function formatSandboxAuthorizationMessage(
	request: Parameters<CodingAgentSandboxAuthorizationPort["request"]>[1],
	sensitive: boolean,
): string {
	return [
		`工具：${request.toolName}`,
		`权限：${request.capability}`,
		`目标：${request.target}`,
		`解析路径：${request.resolvedTarget}`,
		request.grantRoot ? `本次授权目录：${request.grantRoot}` : undefined,
		request.command ? `命令：${request.command}` : undefined,
		"",
		sensitive
			? "该路径为敏感路径，仅支持本次允许（不可缓存到本会话）。"
			: '"允许本次"仅对当前工具调用生效；"本会话不再询问"会缓存到本会话内同 grantRoot 的后续请求。',
	]
		.filter((line): line is string => typeof line === "string")
		.join("\n");
}
