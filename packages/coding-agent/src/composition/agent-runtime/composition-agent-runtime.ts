import {
	type RuntimeAgentDefinition,
	type RuntimeAgentDefinitionSourceRef,
	type RuntimeAgentPublishResult,
	RuntimeAgentRuntime,
	type RuntimeObservationPublisher,
	type RuntimeSessionAgentSelection,
} from "@vetta/runtime-core";
import type { CodingAgentRuntimeAgentOptions } from "../contracts/index.js";
import { DEFAULT_CODING_AGENT_RUNTIME_ID } from "../runtime-agent-definition.js";
import { createCodingAgentExecutionRuntimeDefinition } from "./execution-definition.js";
import type { CodingAgentExecutionRuntimeInstanceConfiguration } from "./execution-instance-configuration.js";

export const CODING_AGENT_BUILTIN_SOURCE: RuntimeAgentDefinitionSourceRef = Object.freeze({
	id: "coding-agent.builtin",
	revision: "1",
});

export interface CodingAgentCompositionAgentRuntimeScope {
	readonly agentId: string;
	readonly runtime: RuntimeAgentRuntime;
	childConfiguration(): CodingAgentRuntimeAgentOptions;
	createSelection(
		prepareSession: CodingAgentExecutionRuntimeInstanceConfiguration["prepareSession"],
	): RuntimeSessionAgentSelection;
	close(): Promise<void>;
}

/**
 * 只管理 Coding Agent Definition 的发布边界与 Runtime 所有权。
 * Instance/Session 生命周期统一交给 RuntimeAgentSessionAssemblyBackend，避免产品层再建一套 owner。
 */
export function createCodingAgentCompositionAgentRuntimeScope(options: {
	readonly configuration?: CodingAgentRuntimeAgentOptions;
	readonly observationPublisher: RuntimeObservationPublisher;
}): CodingAgentCompositionAgentRuntimeScope {
	const configured = options.configuration;
	if (configured?.runtime && (configured.definition || configured.source)) {
		throw new Error(
			"Injected Runtime Agent control plane owns Definition publication; definition/source cannot be provided",
		);
	}
	const agentId = configured?.agentId ?? configured?.definition?.id ?? DEFAULT_CODING_AGENT_RUNTIME_ID;
	if (configured?.definition && configured.definition.id !== agentId) {
		throw new Error("Coding Agent Runtime definition id must match agentRuntime.agentId");
	}
	const ownsRuntime = configured?.runtime === undefined;
	const runtime =
		configured?.runtime ?? new RuntimeAgentRuntime({ observationPublisher: options.observationPublisher });
	if (ownsRuntime) {
		publishDefinition(
			runtime,
			configured?.definition ?? createCodingAgentExecutionRuntimeDefinition({ id: agentId }),
			configured?.source ?? CODING_AGENT_BUILTIN_SOURCE,
		);
	}

	return Object.freeze({
		agentId,
		runtime,
		childConfiguration: () => Object.freeze({ runtime, agentId }),
		createSelection: (prepareSession: CodingAgentExecutionRuntimeInstanceConfiguration["prepareSession"]) =>
			Object.freeze({
				id: agentId,
				instanceConfiguration: {
					applicationConfiguration: configured?.instanceConfiguration,
					prepareSession,
				} satisfies CodingAgentExecutionRuntimeInstanceConfiguration,
			}),
		close: () => (ownsRuntime ? runtime.close() : Promise.resolve()),
	});
}

export function publishCodingAgentExecutionRuntimeDefinition(
	runtime: RuntimeAgentRuntime,
	options: {
		readonly definition?: RuntimeAgentDefinition;
		readonly source?: RuntimeAgentDefinitionSourceRef;
		readonly agentId?: string;
	} = {},
): RuntimeAgentPublishResult {
	const agentId = options.agentId ?? options.definition?.id ?? DEFAULT_CODING_AGENT_RUNTIME_ID;
	const definition = options.definition ?? createCodingAgentExecutionRuntimeDefinition({ id: agentId });
	if (definition.id !== agentId) throw new Error("Coding Agent Runtime definition id does not match agentId");
	return publishDefinition(runtime, definition, options.source ?? CODING_AGENT_BUILTIN_SOURCE);
}

function publishDefinition(
	runtime: RuntimeAgentRuntime,
	definition: RuntimeAgentDefinition,
	source: RuntimeAgentDefinitionSourceRef,
): RuntimeAgentPublishResult {
	return runtime.registry.upsert({ source, definition });
}
