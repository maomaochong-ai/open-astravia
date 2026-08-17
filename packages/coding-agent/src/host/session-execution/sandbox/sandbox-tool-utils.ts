import type { RuntimeSessionHostInteractionContext } from "@vetta/runtime-core";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { SandboxPermissionContext, SandboxPermissionRequest } from "@vetta/runtime-core/sandbox";
import type { CodingToolRegistration } from "@vetta/runtime-tools";
import type { CodingAgentSandboxToolSet } from "../../../composition/contracts/session-execution-environment.js";
import { confirmSandboxPermission, isSensitiveSandboxRequest } from "./sandbox-permission-policy.js";

export interface SandboxRuntimeToolOptions {
	readonly cwd: string;
	readonly hostInteraction: RuntimeSessionHostInteractionContext;
	readonly toolSet: CodingAgentSandboxToolSet;
	/** Resolves the current session id at execute-time. Required for session-scoped grant cache. */
	readonly getSessionId?: () => string | undefined;
}

export function createSandboxToolRegistrations(options: SandboxRuntimeToolOptions): readonly CodingToolRegistration[] {
	return [
		withTool(options.toolSet.read, wrapWorkspaceGuard(options.toolSet.read.tool, options)),
		withTool(options.toolSet.write, wrapWorkspaceGuard(options.toolSet.write.tool, options)),
		withTool(options.toolSet.edit, wrapWorkspaceGuard(options.toolSet.edit.tool, options)),
		withTool(options.toolSet.command, wrapShellPermissionGuard(options.toolSet.command.tool, options)),
	];
}

function withTool<TInput extends object>(
	registration: CodingToolRegistration<TInput>,
	tool: RuntimeToolDefinition<TInput>,
): CodingToolRegistration<TInput> {
	return { ...registration, tool };
}

function extractPathFromParams(params: unknown): string | undefined {
	if (!params || typeof params !== "object" || !("path" in params)) return undefined;
	const pathValue = (params as { path?: unknown }).path;
	return typeof pathValue === "string" ? pathValue : undefined;
}

function extractCommandFromParams(params: unknown): string | undefined {
	if (!params || typeof params !== "object" || !("command" in params)) return undefined;
	const commandValue = (params as { command?: unknown }).command;
	return typeof commandValue === "string" ? commandValue : undefined;
}

function createPermissionContext(
	hostInteraction: RuntimeSessionHostInteractionContext,
	signal: AbortSignal,
): SandboxPermissionContext {
	return {
		hasUI: true,
		ui: {
			confirm: (title, message) => hostInteraction.confirm(title, message, signal),
			requestSandboxGrant: (request) => hostInteraction.requestSandboxGrant(request),
		},
	};
}

export function wrapWorkspaceGuard<TInput extends object>(
	tool: RuntimeToolDefinition<TInput>,
	options: SandboxRuntimeToolOptions,
): RuntimeToolDefinition<TInput> {
	return {
		...tool,
		async execute(request) {
			const requestedPath = extractPathFromParams(request.input);
			if (requestedPath) {
				const access = await options.toolSet.hostServices.resolveWorkspacePathAccess(requestedPath, options.cwd);
				options.toolSet.hostServices.assertPathNotDenied(access.targetBoundary, tool.name);
				options.toolSet.hostServices.assertPathNotDenied(access.targetPath, tool.name);
				if (!access.allowed) {
					const capability: SandboxPermissionRequest["capability"] =
						tool.name === "read" ? "file.read" : "file.write";
					const permissionRequest: SandboxPermissionRequest = {
						capability,
						toolName: tool.name,
						target: requestedPath,
						resolvedTarget: access.targetBoundary,
						grantRoot: access.targetBoundary,
						reason: `${tool.name} target is outside the workspace sandbox`,
					};
					const sessionId = options.getSessionId?.();
					const cached = sessionId
						? options.toolSet.hostServices.findSessionGrant(sessionId, permissionRequest)
						: undefined;
					if (!cached) {
						const decision = await confirmSandboxPermission(
							createPermissionContext(options.hostInteraction, request.signal),
							permissionRequest,
							options.toolSet.hostServices.isDeniedPath,
						);
						if (decision === "deny") {
							const currentAccess = await options.toolSet.hostServices.resolveWorkspacePathAccess(
								requestedPath,
								options.cwd,
							);
							if (currentAccess.allowed) return tool.execute(request);
							throw new Error(
								`Access denied by sandbox: "${requestedPath}" is outside workspace root for tool "${tool.name}".` +
									`\nworkspace=${currentAccess.workspaceRoot}` +
									`\nresolved=${currentAccess.targetBoundary}`,
							);
						} else if (
							decision === "allow_session" &&
							sessionId &&
							!isSensitiveSandboxRequest(permissionRequest, options.toolSet.hostServices.isDeniedPath)
						) {
							options.toolSet.hostServices.addSessionGrant(sessionId, permissionRequest);
						}
					}
				}
			}
			return tool.execute(request);
		},
	};
}

export function wrapShellPermissionGuard<TInput extends object>(
	tool: RuntimeToolDefinition<TInput>,
	options: SandboxRuntimeToolOptions,
): RuntimeToolDefinition<TInput> {
	return {
		...tool,
		async execute(request) {
			const command = extractCommandFromParams(request.input);
			const permissionRequests = command
				? options.toolSet.hostServices.collectShellWritePermissionRequests(command, options.cwd)
				: [];
			const sessionId = options.getSessionId?.();
			const allowWriteRoots: string[] = [];
			for (const permissionRequest of permissionRequests) {
				const cached = sessionId
					? options.toolSet.hostServices.findSessionGrant(sessionId, permissionRequest)
					: undefined;
				if (cached) {
					if (permissionRequest.grantRoot) allowWriteRoots.push(permissionRequest.grantRoot);
					continue;
				}
				const decision = await confirmSandboxPermission(
					createPermissionContext(options.hostInteraction, request.signal),
					permissionRequest,
					options.toolSet.hostServices.isDeniedPath,
				);
				if (decision === "deny") {
					throw new Error(
						`Access denied by sandbox: shell command requires write permission outside workspace.` +
							`\ntarget=${permissionRequest.target}` +
							`\nresolved=${permissionRequest.resolvedTarget}` +
							(permissionRequest.grantRoot ? `\ngrantRoot=${permissionRequest.grantRoot}` : ""),
					);
				}
				if (
					decision === "allow_session" &&
					sessionId &&
					!isSensitiveSandboxRequest(permissionRequest, options.toolSet.hostServices.isDeniedPath)
				) {
					options.toolSet.hostServices.addSessionGrant(sessionId, permissionRequest);
				}
				if (permissionRequest.grantRoot) allowWriteRoots.push(permissionRequest.grantRoot);
			}

			if (allowWriteRoots.length === 0) return tool.execute(request);
			const uniqueAllowWriteRoots = Array.from(new Set(allowWriteRoots));
			return options.toolSet.hostServices.runWithShellGrant(
				options.cwd,
				{
					allowReadRoots: uniqueAllowWriteRoots,
					allowWriteRoots: uniqueAllowWriteRoots,
				},
				() => tool.execute(request),
			);
		},
	};
}
