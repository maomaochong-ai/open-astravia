import type { RuntimeSessionHostInteractionContext } from "@vetta/runtime-core";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import {
	addSessionGrant,
	assertSandboxPathNotDenied,
	collectShellWritePermissionRequests,
	confirmSandboxPermission,
	findSessionGrant,
	isSensitiveSandboxRequest,
	runWithSandboxShellGrant,
	type SandboxPermissionContext,
	type SandboxPermissionRequest,
} from "@vetta/runtime-core/sandbox";
import type {
	CodingToolRegistration,
	EditPathPolicy,
	ForegroundCommandOperations,
	WritePathPolicy,
} from "@vetta/runtime-tools/coding";
import {
	createBashToolRegistration,
	createEditToolRegistration,
	createForegroundCommandToolExecutor,
	createReadToolRegistration,
	createShellToolRegistration,
	createWriteToolRegistration,
} from "@vetta/runtime-tools/coding";
import { assertWorkspacePathAllowed, resolveWorkspacePathAccess } from "./workspace-guard.js";

export interface SandboxRuntimeToolOptions {
	readonly cwd: string;
	readonly hostInteraction: RuntimeSessionHostInteractionContext;
	readonly editPathPolicy: EditPathPolicy;
	readonly writePathPolicy: WritePathPolicy;
	readonly commandEnvironment?: () => NodeJS.ProcessEnv;
	readonly protectedDirectories?: readonly string[];
	/** Resolves the current session id at execute-time. Required for session-scoped grant cache. */
	readonly getSessionId?: () => string | undefined;
}

export interface CreateSandboxToolRegistrationsOptions extends SandboxRuntimeToolOptions {
	readonly platform: NodeJS.Platform;
	readonly commandOperations: ForegroundCommandOperations;
}

export function createSandboxToolRegistrations(
	options: CreateSandboxToolRegistrationsOptions,
): readonly CodingToolRegistration[] {
	const executor = createForegroundCommandToolExecutor({
		operations: options.commandOperations,
		environment: options.commandEnvironment,
		protectedDirectories: options.protectedDirectories,
	});
	const readRegistration = createReadToolRegistration(options.cwd);
	const writeRegistration = createWriteToolRegistration(options.cwd, { pathPolicy: options.writePathPolicy });
	const editRegistration = createEditToolRegistration(options.cwd, { pathPolicy: options.editPathPolicy });
	const commandRegistration =
		options.platform === "win32"
			? createShellToolRegistration(options.cwd, { executor, platform: options.platform })
			: createBashToolRegistration(options.cwd, { executor, platform: options.platform });

	return [
		withTool(readRegistration, wrapWorkspaceGuard(readRegistration.tool, options)),
		withTool(writeRegistration, wrapWorkspaceGuard(writeRegistration.tool, options)),
		withTool(editRegistration, wrapWorkspaceGuard(editRegistration.tool, options)),
		withTool(commandRegistration, wrapShellPermissionGuard(commandRegistration.tool, options)),
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
				const access = await resolveWorkspacePathAccess(requestedPath, options.cwd);
				assertSandboxPathNotDenied(access.targetBoundary, tool.name);
				assertSandboxPathNotDenied(access.targetPath, tool.name);
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
					const cached = sessionId ? findSessionGrant(sessionId, permissionRequest) : undefined;
					if (!cached) {
						const decision = await confirmSandboxPermission(
							createPermissionContext(options.hostInteraction, request.signal),
							permissionRequest,
						);
						if (decision === "deny") {
							await assertWorkspacePathAllowed(requestedPath, options.cwd, tool.name);
						} else if (
							decision === "allow_session" &&
							sessionId &&
							!isSensitiveSandboxRequest(permissionRequest)
						) {
							addSessionGrant(sessionId, permissionRequest);
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
			const permissionRequests = command ? collectShellWritePermissionRequests(command, options.cwd) : [];
			const sessionId = options.getSessionId?.();
			const allowWriteRoots: string[] = [];
			for (const permissionRequest of permissionRequests) {
				const cached = sessionId ? findSessionGrant(sessionId, permissionRequest) : undefined;
				if (cached) {
					if (permissionRequest.grantRoot) allowWriteRoots.push(permissionRequest.grantRoot);
					continue;
				}
				const decision = await confirmSandboxPermission(
					createPermissionContext(options.hostInteraction, request.signal),
					permissionRequest,
				);
				if (decision === "deny") {
					throw new Error(
						`Access denied by sandbox: shell command requires write permission outside workspace.` +
							`\ntarget=${permissionRequest.target}` +
							`\nresolved=${permissionRequest.resolvedTarget}` +
							(permissionRequest.grantRoot ? `\ngrantRoot=${permissionRequest.grantRoot}` : ""),
					);
				}
				if (decision === "allow_session" && sessionId && !isSensitiveSandboxRequest(permissionRequest)) {
					addSessionGrant(sessionId, permissionRequest);
				}
				if (permissionRequest.grantRoot) allowWriteRoots.push(permissionRequest.grantRoot);
			}

			if (allowWriteRoots.length === 0) return tool.execute(request);
			const uniqueAllowWriteRoots = Array.from(new Set(allowWriteRoots));
			return runWithSandboxShellGrant(
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
