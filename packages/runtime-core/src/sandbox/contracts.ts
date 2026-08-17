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

export interface SandboxPermissionContext {
	hasUI: boolean;
	ui: {
		confirm(title: string, message: string): Promise<boolean>;
		requestSandboxGrant?(request: SandboxPermissionPrompt): Promise<SandboxPermissionDecision>;
	};
	requestEcosystemPermission?(
		request: SandboxEcosystemPermissionRequest,
	): Promise<SandboxEcosystemPermissionResult | undefined>;
}

export interface SandboxPermissionPrompt {
	title: string;
	message: string;
	toolName: string;
	capability: SandboxPermissionCapability;
	target: string;
	resolvedTarget: string;
	grantRoot?: string;
	command?: string;
	sensitive: boolean;
}

export interface SandboxEcosystemPermissionRequest {
	toolName: string;
	toolInput: unknown;
	runIdSuffix: string;
}

export interface SandboxEcosystemPermissionResult {
	decision?: "allow" | "deny";
	message?: string;
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
