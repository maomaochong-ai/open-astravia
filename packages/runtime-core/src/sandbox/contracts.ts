export type SandboxPermissionCapability = "file.read" | "file.write" | "network";

export type SandboxPermissionDecision = "deny" | "allow_once" | "allow_session";

export interface SandboxPermissionRequest {
	capability: SandboxPermissionCapability;
	toolName: string;
	target: string;
	resolvedTarget: string;
	grantRoot?: string;
	reason: string;
	command?: string;
}

export interface SandboxShellGrant {
	allowReadRoots: string[];
	allowWriteRoots: string[];
}

export interface SandboxSessionGrantEntry {
	id: string;
	sessionId: string;
	toolName: string;
	capability: SandboxPermissionCapability;
	grantRoot: string;
	firstTarget: string;
	createdAt: number;
}
