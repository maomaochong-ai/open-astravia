import type {
	SandboxPermissionRequest,
	SandboxSessionGrantEntry,
	SandboxShellGrant,
} from "@vetta/runtime-core/sandbox";
import type { ForegroundCommandOperations } from "@vetta/runtime-tools";
import type { NodeSandboxPlatform, NodeSandboxShell } from "./commands/contracts.js";
import { createLinuxBubblewrapCommandOperations } from "./commands/linux-bubblewrap.js";
import { createMacosSeatbeltCommandOperations } from "./commands/macos-seatbelt.js";
import { createWindowsSandboxCommandOperations } from "./commands/windows-host.js";
import {
	addSessionGrant,
	assertSandboxPathNotDenied,
	collectShellWritePermissionRequests,
	findSessionGrant,
	isDeniedSandboxPath,
	runWithSandboxShellGrant,
} from "./sandbox-permissions.js";
import { type NodeWorkspacePathAccess, resolveNodeWorkspacePathAccess } from "./workspace-path-access.js";

export interface NodeSandboxHostOptions {
	readonly platform?: NodeJS.Platform;
	readonly windowsSandboxHostPath?: string;
	readonly linuxBubblewrapPath?: string;
	readonly macosSandboxExecPath?: string;
	readonly resolveShell?: () => NodeSandboxShell;
	readonly commandOperations?: ForegroundCommandOperations;
}

export interface NodeSandboxHost {
	readonly platform: NodeSandboxPlatform;
	readonly commandOperations: ForegroundCommandOperations;
	resolveWorkspacePathAccess(requestedPath: string, workspaceCwd: string): Promise<NodeWorkspacePathAccess>;
	assertPathNotDenied(targetPath: string, toolName: string): void;
	collectShellWritePermissionRequests(command: string, cwd: string): SandboxPermissionRequest[];
	isDeniedPath(targetPath: string): boolean;
	findSessionGrant(sessionId: string, request: SandboxPermissionRequest): SandboxSessionGrantEntry | undefined;
	addSessionGrant(sessionId: string, request: SandboxPermissionRequest): SandboxSessionGrantEntry;
	runWithShellGrant<T>(cwd: string, grant: SandboxShellGrant, callback: () => Promise<T>): Promise<T>;
}

export function createNodeSandboxHost(options: NodeSandboxHostOptions = {}): NodeSandboxHost | undefined {
	const platform = resolveSupportedPlatform(options.platform ?? process.platform);
	if (!platform) return undefined;
	const commandOperations = options.commandOperations ?? createPlatformCommandOperations(platform, options);
	return {
		platform,
		commandOperations,
		resolveWorkspacePathAccess: resolveNodeWorkspacePathAccess,
		assertPathNotDenied: assertSandboxPathNotDenied,
		collectShellWritePermissionRequests,
		isDeniedPath: isDeniedSandboxPath,
		findSessionGrant,
		addSessionGrant,
		runWithShellGrant: runWithSandboxShellGrant,
	};
}

function resolveSupportedPlatform(platform: NodeJS.Platform): NodeSandboxPlatform | undefined {
	return platform === "win32" || platform === "linux" || platform === "darwin" ? platform : undefined;
}

function createPlatformCommandOperations(
	platform: NodeSandboxPlatform,
	options: NodeSandboxHostOptions,
): ForegroundCommandOperations {
	if (platform === "win32") return createWindowsSandboxCommandOperations(options.windowsSandboxHostPath);
	const resolveShell = options.resolveShell;
	if (!resolveShell) throw new Error(`${platform} sandbox requires an injected shell resolver`);
	if (platform === "linux") {
		return createLinuxBubblewrapCommandOperations({
			bubblewrapPath: options.linuxBubblewrapPath,
			resolveShell,
		});
	}
	return createMacosSeatbeltCommandOperations({
		sandboxExecPath: options.macosSandboxExecPath,
		resolveShell,
	});
}
