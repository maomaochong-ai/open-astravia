import type { AppMonitorEvent, AppMonitorResourceKind } from "../../preload/api-types/app-monitor.js";
import { getAppLogger } from "../logger.js";

const log = getAppLogger("ability");

type ResourceLifecycleEvent = Extract<AppMonitorEvent, { type: "resource.lifecycle" }>;

export type AbilityInstallMode = "marketplace" | "manual-package" | "plugin-cli" | "plugin-workbench" | "plugin-api";

export type AbilityArtifactKind =
	| "vettapkg"
	| "legacy-zip"
	| "snapshot-source"
	| "npm-package"
	| "remote-archive"
	| "archive-buffer"
	| "development-project";

export interface AbilityLifecycleLogContext {
	version?: string;
	installMode?: AbilityInstallMode;
	artifactKind?: AbilityArtifactKind;
	artifactName?: string;
	artifactUrl?: string;
	artifactSha256?: string;
	npmPackage?: string;
	marketplaceSourceId?: string;
	marketplaceName?: string;
	marketplaceVersion?: string;
	marketplaceRepository?: string;
	marketplaceRef?: string;
	projectDir?: string;
	persisted?: boolean;
}

export interface AbilityInstallLogInput extends AbilityLifecycleLogContext {
	abilityType: AppMonitorResourceKind;
	abilityId?: string;
}

export function logAbilityLifecycleEvent(
	event: ResourceLifecycleEvent,
	context: AbilityLifecycleLogContext = {},
): void {
	log.info("lifecycle completed", {
		abilityType: event.resourceKind,
		abilityId: event.resourceId,
		operation: event.operation,
		...(event.source ? { source: event.source } : {}),
		...(event.system !== undefined ? { system: event.system } : {}),
		...(event.permissionCount !== undefined ? { permissionCount: event.permissionCount } : {}),
		...(event.commandCount !== undefined ? { commandCount: event.commandCount } : {}),
		...context,
	});
}

export function logAbilityInstallStarted(input: AbilityInstallLogInput): void {
	log.info("installation started", input);
}

export function logAbilityInstallFailed(input: AbilityInstallLogInput, error: unknown): void {
	log.error("installation failed", input, error);
}

export function logAbilityDevelopmentLink(
	operation: "linked" | "unlinked",
	input: Omit<AbilityInstallLogInput, "installMode" | "artifactKind" | "persisted">,
): void {
	log.info(`development source ${operation}`, {
		...input,
		installMode: "plugin-cli",
		artifactKind: "development-project",
		persisted: false,
	});
}

export function logAbilityRuntimeLoaded(input: {
	abilityType: AppMonitorResourceKind;
	abilityId: string;
	version?: string;
	source?: string;
	activationId?: string;
}): void {
	log.info("runtime loaded", input);
}
