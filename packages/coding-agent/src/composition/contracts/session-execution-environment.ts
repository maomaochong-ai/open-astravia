import type { ConversationScenario } from "@vetta/runtime-core";
import type { RuntimeConfigurationSnapshotSource } from "@vetta/runtime-core/configuration";
import type {
	SandboxPermissionRequest,
	SandboxSessionGrantEntry,
	SandboxShellGrant,
} from "@vetta/runtime-core/sandbox";
import type { BackgroundCommandService, CodingToolRegistration } from "@vetta/runtime-tools";

export interface CodingAgentSandboxWorkspacePathAccess {
	readonly allowed: boolean;
	readonly workspaceRoot: string;
	readonly targetPath: string;
	readonly targetBoundary: string;
}

export interface CodingAgentSandboxHostServices {
	resolveWorkspacePathAccess(
		requestedPath: string,
		workspaceCwd: string,
	): Promise<CodingAgentSandboxWorkspacePathAccess>;
	assertPathNotDenied(targetPath: string, toolName: string): void;
	collectShellWritePermissionRequests(command: string, cwd: string): SandboxPermissionRequest[];
	isDeniedPath(targetPath: string): boolean;
	findSessionGrant(sessionId: string, request: SandboxPermissionRequest): SandboxSessionGrantEntry | undefined;
	addSessionGrant(sessionId: string, request: SandboxPermissionRequest): SandboxSessionGrantEntry;
	runWithShellGrant<T>(cwd: string, grant: SandboxShellGrant, callback: () => Promise<T>): Promise<T>;
}

export interface CodingAgentSandboxHostOptions {
	readonly windowsSandboxHostPath?: string;
	readonly linuxBubblewrapPath?: string;
	readonly macosSandboxExecPath?: string;
}

export interface CodingAgentSandboxToolSet {
	readonly read: CodingToolRegistration;
	readonly write: CodingToolRegistration;
	readonly edit: CodingToolRegistration;
	readonly command: CodingToolRegistration;
	readonly hostServices: CodingAgentSandboxHostServices;
}

export interface CodingAgentSandboxEnvironment {
	createToolSet(options: CodingAgentSandboxHostOptions): CodingAgentSandboxToolSet | undefined;
}

export interface CodingAgentSessionExecutionEnvironmentContext {
	readonly cwd: string;
	readonly agentDir?: string;
	readonly scenario: ConversationScenario;
	readonly env?: Readonly<Record<string, string>>;
	readonly configurationSource?: RuntimeConfigurationSnapshotSource;
}

/** Session 独占的命令 Tool 与后台任务宿主；任务控制 Tool、产品模式和激活策略不属于该环境。 */
export interface CodingAgentSessionExecutionEnvironment {
	readonly registrations: readonly CodingToolRegistration[];
	readonly backgroundService: BackgroundCommandService;
	readonly sandbox: CodingAgentSandboxEnvironment;
	dispose(): void | Promise<void>;
}

export type CodingAgentSessionExecutionEnvironmentFactory = (
	context: CodingAgentSessionExecutionEnvironmentContext,
) => CodingAgentSessionExecutionEnvironment | Promise<CodingAgentSessionExecutionEnvironment>;
