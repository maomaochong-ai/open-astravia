import {
	createRuntimeObservationPublisherPort,
	RuntimeObservationHub,
	type RuntimeObservationPort,
	type RuntimeObservationPublisher,
} from "@vetta/runtime-core";
import type { CodingAgentObservationHubOptions } from "../contracts/index.js";

export interface CodingAgentObservationRuntime {
	readonly hub: RuntimeObservationHub;
	readonly publisher: RuntimeObservationPublisher;
}

/**
 * 创建由单个 Coding Agent Composition 独占的观测边界。
 *
 * 父级 Port/Publisher 与本地 Adapter 均不归当前 Runtime 所有；dispose 只关闭并 flush 自有 Hub。
 */
export function createCodingAgentObservationRuntime(options: {
	readonly publisher?: RuntimeObservationPublisher;
	readonly hub?: CodingAgentObservationHubOptions;
}): CodingAgentObservationRuntime {
	if (options.publisher && options.hub?.parent) {
		throw new Error("Coding Agent observation accepts either a parent Port or Publisher, not both");
	}
	const parent =
		options.hub?.parent ?? (options.publisher ? createRuntimeObservationPublisherPort(options.publisher) : undefined);
	const hub = new RuntimeObservationHub({
		...(parent ? { parent } : {}),
		...(options.hub?.maxPendingRecords === undefined ? {} : { maxPendingRecords: options.hub.maxPendingRecords }),
		...(options.hub?.onIssue ? { onIssue: options.hub.onIssue } : {}),
	});
	for (const { port, route } of options.hub?.routes ?? []) hub.attach(port, route);
	return Object.freeze({ hub, publisher: hub.publisher() });
}

export function createChildCodingAgentObservationOptions(
	options: CodingAgentObservationHubOptions | undefined,
	parent: RuntimeObservationPort,
): CodingAgentObservationHubOptions {
	const { parent: _parent, routes: _routes, ...inheritedBehavior } = options ?? {};
	return Object.freeze({ ...inheritedBehavior, parent });
}
