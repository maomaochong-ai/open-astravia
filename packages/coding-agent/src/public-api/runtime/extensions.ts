import type { RuntimeSessionExecutionObservation } from "@vetta/runtime-core";
import {
	CodingAgentGreenfieldExtensionEventHost,
	type CodingAgentGreenfieldExtensionEventHostOptions,
} from "../../adapters/runtime-core/greenfield-extension-event-host.js";
import {
	CodingAgentGreenfieldExtensionObservationAdapter,
	type CodingAgentGreenfieldObservedExtensionEvent,
} from "../../adapters/runtime-core/greenfield-extension-observation-adapter.js";
import type { ExtensionCommandContextActions } from "../../extensions/index.js";
import { createCodingAgentExtensionCommandActions } from "../../host/extensions/command-actions.js";
import { createCodingAgentExtensionCommandHost } from "../../host/extensions/command-host.js";
import type {
	CodingAgentExtensionCommandActionPorts,
	CodingAgentExtensionCommandHost,
	CodingAgentExtensionCommandHostOptions,
	CodingAgentExtensionEventHost,
	CodingAgentExtensionInitialization,
} from "../../host/extensions/contracts.js";

export type CodingAgentRuntimeExtensionInitialization = CodingAgentExtensionInitialization;
export type CodingAgentRuntimeExtensionEventHostOptions = CodingAgentGreenfieldExtensionEventHostOptions;
export type CodingAgentRuntimeExtensionCommandActionPorts = CodingAgentExtensionCommandActionPorts;
export type CodingAgentRuntimeObservedExtensionEvent = CodingAgentGreenfieldObservedExtensionEvent;
export type CodingAgentRuntimeExtensionCommandContextActions = ExtensionCommandContextActions;
export type CodingAgentRuntimeExtensionCommandHost = CodingAgentExtensionCommandHost;
export type CodingAgentRuntimeExtensionCommandHostOptions = CodingAgentExtensionCommandHostOptions;
export type CodingAgentRuntimeExtensionEventHost = CodingAgentExtensionEventHost;

export interface CodingAgentRuntimeExtensionObservationAdapter {
	observe(observation: RuntimeSessionExecutionObservation): Promise<void>;
}

export function createCodingAgentRuntimeExtensionCommandHost(
	options: CodingAgentRuntimeExtensionCommandHostOptions,
): CodingAgentRuntimeExtensionCommandHost {
	return createCodingAgentExtensionCommandHost(options);
}

export function createCodingAgentRuntimeExtensionEventHost(
	options: CodingAgentRuntimeExtensionEventHostOptions,
): CodingAgentRuntimeExtensionEventHost {
	return new CodingAgentGreenfieldExtensionEventHost(options);
}

export function createCodingAgentRuntimeExtensionObservationAdapter(
	emit: (event: CodingAgentRuntimeObservedExtensionEvent) => Promise<void>,
): CodingAgentRuntimeExtensionObservationAdapter {
	return new CodingAgentGreenfieldExtensionObservationAdapter(emit);
}

export function createCodingAgentRuntimeExtensionCommandActions(
	ports: CodingAgentRuntimeExtensionCommandActionPorts,
): CodingAgentRuntimeExtensionCommandContextActions {
	return createCodingAgentExtensionCommandActions(ports);
}
