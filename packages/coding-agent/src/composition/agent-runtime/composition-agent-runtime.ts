import {
	RetryableCleanup,
	type RuntimeAgentDefinition,
	type RuntimeAgentDefinitionSourceRef,
	type RuntimeAgentInstance,
	type RuntimeAgentPublishResult,
	RuntimeAgentRuntime,
	type RuntimeObservationPublisher,
	type RuntimeResources,
} from "@vetta/runtime-core";
import type { CodingAgentRuntimeAgentOptions } from "../contracts/index.js";
import { DEFAULT_CODING_AGENT_RUNTIME_ID } from "../runtime-agent-definition.js";
import { createCodingAgentExecutionRuntimeDefinition } from "./execution-definition.js";
import type {
	CodingAgentExecutionRuntimeInstanceConfiguration,
	CodingAgentExecutionSessionRequest,
} from "./execution-instance-configuration.js";

export const CODING_AGENT_BUILTIN_SOURCE: RuntimeAgentDefinitionSourceRef = Object.freeze({
	id: "coding-agent.builtin",
	revision: "1",
});

export interface CodingAgentCompositionAgentRuntime {
	readonly agentId: string;
	readonly instanceId: string;
	readonly revisionId: string;
	createSession(request: CodingAgentExecutionSessionRequest): Promise<RuntimeResources>;
	close(): Promise<void>;
}

export interface CodingAgentCompositionAgentRuntimeScope {
	readonly agentId: string;
	childConfiguration(): CodingAgentRuntimeAgentOptions;
	createInstance(
		prepareSession: CodingAgentExecutionRuntimeInstanceConfiguration["prepareSession"],
	): Promise<CodingAgentCompositionAgentRuntime>;
	close(): Promise<void>;
}

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
			{
				...(configured?.source ?? CODING_AGENT_BUILTIN_SOURCE),
			},
		);
	}

	let instanceCreated = false;
	let activeAgentRuntime: CodingAgentCompositionAgentRuntime | undefined;
	let closePromise: Promise<void> | undefined;
	return {
		agentId,
		childConfiguration: () => Object.freeze({ runtime, agentId }),
		async createInstance(prepareSession) {
			if (instanceCreated) throw new Error("Coding Agent Composition Agent Instance is already created");
			instanceCreated = true;
			let instance: RuntimeAgentInstance;
			try {
				instance = await runtime.createInstance({
					agentId,
					...(configured?.instanceId ? { instanceId: configured.instanceId } : {}),
					configuration: {
						applicationConfiguration: configured?.instanceConfiguration,
						prepareSession,
					} satisfies CodingAgentExecutionRuntimeInstanceConfiguration,
				});
			} catch (error) {
				if (ownsRuntime) {
					return rollbackCodingAgentRuntime(error, () => runtime.close(), "Coding Agent runtime rollback failed");
				}
				throw error;
			}
			activeAgentRuntime = new DefaultCodingAgentCompositionAgentRuntime(runtime, instance, ownsRuntime);
			return activeAgentRuntime;
		},
		close() {
			if (closePromise) return closePromise;
			closePromise = activeAgentRuntime?.close() ?? (ownsRuntime ? runtime.close() : Promise.resolve());
			return closePromise;
		},
	};
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

class DefaultCodingAgentCompositionAgentRuntime implements CodingAgentCompositionAgentRuntime {
	readonly agentId: string;
	readonly instanceId: string;
	readonly revisionId: string;
	private closePromise?: Promise<void>;

	constructor(
		private readonly runtime: RuntimeAgentRuntime,
		private readonly instance: RuntimeAgentInstance,
		private readonly ownsRuntime: boolean,
	) {
		this.agentId = instance.agentId;
		this.instanceId = instance.id;
		this.revisionId = instance.revisionId;
	}

	async createSession(request: CodingAgentExecutionSessionRequest): Promise<RuntimeResources> {
		const session = await this.instance.createSession({
			sessionId: request.options.sessionId,
			configuration: request,
		});
		return session.requireRuntimeResources();
	}

	close(): Promise<void> {
		if (this.closePromise) return this.closePromise;
		this.closePromise = this.closeResources();
		return this.closePromise;
	}

	private async closeResources(): Promise<void> {
		const cleanup = new RetryableCleanup();
		cleanup.add({ id: "runtime-agent-instance", phase: 0, cleanup: () => this.instance.close() });
		if (this.ownsRuntime) {
			cleanup.add({ id: "runtime-agent-control-plane", phase: 1, cleanup: () => this.runtime.close() });
		}
		await cleanup.run("Failed to close Coding Agent Runtime Agent resources");
	}
}

function publishDefinition(
	runtime: RuntimeAgentRuntime,
	definition: RuntimeAgentDefinition,
	source: RuntimeAgentDefinitionSourceRef,
): RuntimeAgentPublishResult {
	return runtime.registry.upsert({ source, definition });
}

async function rollbackCodingAgentRuntime(
	cause: unknown,
	rollback: () => Promise<void>,
	message: string,
): Promise<never> {
	try {
		await rollback();
	} catch (rollbackError) {
		throw new AggregateError([cause, rollbackError], message, { cause });
	}
	throw cause;
}
