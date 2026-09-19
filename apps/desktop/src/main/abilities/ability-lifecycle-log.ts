import type { AppMonitorEvent, AppMonitorResourceKind } from "../../preload/api-types/app-monitor.js";
import { getAppLogger } from "../logger.js";

const log = getAppLogger("ability");

type ResourceLifecycleEvent = Extract<AppMonitorEvent, { type: "resource.lifecycle" }>;

export function logAbilityLifecycleEvent(event: ResourceLifecycleEvent): void {
	log.info("lifecycle completed", {
		abilityType: event.resourceKind,
		abilityId: event.resourceId,
		operation: event.operation,
		...(event.source ? { source: event.source } : {}),
		...(event.system !== undefined ? { system: event.system } : {}),
		...(event.permissionCount !== undefined ? { permissionCount: event.permissionCount } : {}),
		...(event.commandCount !== undefined ? { commandCount: event.commandCount } : {}),
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
