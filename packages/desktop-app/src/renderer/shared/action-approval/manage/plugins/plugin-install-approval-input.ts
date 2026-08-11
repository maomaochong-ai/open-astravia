import type { DesktopActionJsonValue } from "@preload/api";

interface NpmApprovalDistribution {
	packageName: string;
	requestedSpec: string;
	resolvedVersion?: string;
	integrity?: string;
}

export interface PluginInstallFromPathApprovalInput {
	operation: "install-from-path";
	path: string;
	grantedPermissions?: string[];
	enable?: boolean;
	source?: "archive" | "npm";
	expectedSha256?: string;
	expectedId?: string;
	expectedVersion?: string;
	npm?: NpmApprovalDistribution;
	approvalUi?: string;
}

/** Preserve host-verification fields while applying the user's editable approval choices. */
export function buildInstallFromPathApprovalInput(
	input: PluginInstallFromPathApprovalInput,
	path: string,
): Record<string, DesktopActionJsonValue> {
	const preserved = input as unknown as Record<string, DesktopActionJsonValue>;
	return {
		...preserved,
		operation: "install-from-path",
		path: path.trim(),
		enable: input.enable !== false,
		approvalUi: input.approvalUi ?? "plugins.install-from-path",
	};
}
