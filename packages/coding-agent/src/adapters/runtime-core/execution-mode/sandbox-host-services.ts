import type {
	SandboxPermissionRequest,
	SandboxSessionGrantEntry,
	SandboxShellGrant,
} from "@vetta/runtime-core/sandbox";
import type { ForegroundCommandOperations } from "@vetta/runtime-tools";

export type SandboxCommandPlatform = "win32" | "linux" | "darwin";

export interface SandboxWorkspacePathAccess {
	readonly allowed: boolean;
	readonly workspaceRoot: string;
	readonly targetPath: string;
	readonly targetBoundary: string;
}

export interface SandboxHostServices {
	readonly platform: SandboxCommandPlatform;
	readonly commandOperations: ForegroundCommandOperations;
	resolveWorkspacePathAccess(requestedPath: string, workspaceCwd: string): Promise<SandboxWorkspacePathAccess>;
	assertPathNotDenied(targetPath: string, toolName: string): void;
	collectShellWritePermissionRequests(command: string, cwd: string): SandboxPermissionRequest[];
	isDeniedPath(targetPath: string): boolean;
	findSessionGrant(sessionId: string, request: SandboxPermissionRequest): SandboxSessionGrantEntry | undefined;
	addSessionGrant(sessionId: string, request: SandboxPermissionRequest): SandboxSessionGrantEntry;
	runWithShellGrant<T>(cwd: string, grant: SandboxShellGrant, callback: () => Promise<T>): Promise<T>;
}
