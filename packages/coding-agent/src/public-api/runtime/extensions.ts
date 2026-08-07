import type { RuntimeSessionExecutionObservation } from "@vetta/runtime-core";
import {
	CodingAgentExtensionObservationAdapter,
	type CodingAgentObservedExtensionEvent,
} from "../../adapters/runtime-core/extension-observation-adapter.js";
import type { ExtensionCommandContextActions } from "../../extensions/index.js";
import { createCodingAgentExtensionCommandActions } from "../../host/extensions/command-actions.js";
import { createCodingAgentExtensionCommandHost } from "../../host/extensions/command-host.js";
import type {
	CodingAgentExtensionCommandActionPorts,
	CodingAgentExtensionCommandHost,
	CodingAgentExtensionCommandHostOptions,
	CodingAgentExtensionEventHost,
	CodingAgentExtensionEventHostFactory,
	CodingAgentExtensionInitialization,
	CodingAgentExtensionSessionHost,
} from "../../host/extensions/contracts.js";
import {
	type CodingAgentExtensionEventHostOptions,
	createCodingAgentExtensionEventHost,
} from "../../host/extensions/event-host.js";
import { createCodingAgentExtensionSessionHost } from "../../host/extensions/session-host.js";

export type CodingAgentRuntimeExtensionInitialization = CodingAgentExtensionInitialization;
export type CodingAgentRuntimeExtensionEventHostOptions = CodingAgentExtensionEventHostOptions;
export type CodingAgentRuntimeExtensionEventHostFactory = CodingAgentExtensionEventHostFactory;
export type CodingAgentRuntimeExtensionCommandActionPorts = CodingAgentExtensionCommandActionPorts;
export type CodingAgentRuntimeObservedExtensionEvent = CodingAgentObservedExtensionEvent;
export type CodingAgentRuntimeExtensionCommandContextActions = ExtensionCommandContextActions;
export type CodingAgentRuntimeExtensionCommandHost = CodingAgentExtensionCommandHost;
export type CodingAgentRuntimeExtensionCommandHostOptions = CodingAgentExtensionCommandHostOptions;
export type CodingAgentRuntimeExtensionEventHost = CodingAgentExtensionEventHost;
export type CodingAgentRuntimeExtensionSessionHost = CodingAgentExtensionSessionHost;

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
	return createCodingAgentExtensionEventHost(options);
}

export function createCodingAgentRuntimeExtensionSessionHost(
	initial: CodingAgentRuntimeExtensionEventHost,
	createHost: CodingAgentRuntimeExtensionEventHostFactory,
): CodingAgentRuntimeExtensionSessionHost {
	return createCodingAgentExtensionSessionHost(initial, createHost);
}

export function createCodingAgentRuntimeExtensionObservationAdapter(
	emit: (event: CodingAgentRuntimeObservedExtensionEvent) => Promise<void>,
): CodingAgentRuntimeExtensionObservationAdapter {
	return new CodingAgentExtensionObservationAdapter(emit);
}

export function createCodingAgentRuntimeExtensionCommandActions(
	ports: CodingAgentRuntimeExtensionCommandActionPorts,
): CodingAgentRuntimeExtensionCommandContextActions {
	return createCodingAgentExtensionCommandActions(ports);
}
