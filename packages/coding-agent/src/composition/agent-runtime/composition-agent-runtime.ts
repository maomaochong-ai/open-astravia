import {
	RetryableCleanup,
	type RuntimeAgentDefinition,
	type RuntimeAgentDefinitionSourceRef,
	RuntimeAgentHost,
	type RuntimeAgentInstance,
	type RuntimeAgentPublishResult,
	type RuntimeAgentSessionPreparationContext,
	type RuntimeObservationPublisher,
	type RuntimeResources,
} from "@vetta/runtime-core";
import type { CodingAgentRuntimeAgentOptions } from "../contracts/index.js";
import { DEFAULT_CODING_AGENT_RUNTIME_ID } from "../runtime-agent-definition.js";
import type { CodingAgentCapabilitySessionBinding } from "../session-lifecycle/resource-lifecycle.js";
import { createCodingAgentExecutionRuntimeDefinition } from "./execution-definition.js";
import {
	type CodingAgentPreparedRuntimeAgentSession,
	CodingAgentRuntimeAgentSessionAssemblyRequest,
} from "./session-assembly-request.js";

export const CODING_AGENT_BUILTIN_SOURCE: RuntimeAgentDefinitionSourceRef = Object.freeze({
	id: "coding-agent.builtin",
	revision: "1",
});

export interface CodingAgentCompositionAgentRuntime {
	readonly agentId: string;
	readonly instanceId: string;
	readonly revisionId: string;
	childConfiguration(): CodingAgentRuntimeAgentOptions;
	createSession(
		sessionId: string,
		prepare: (context: RuntimeAgentSessionPreparationContext) => Promise<CodingAgentPreparedRuntimeAgentSession>,
	): Promise<RuntimeResources>;
	close(): Promise<void>;
}

export async function createCodingAgentCompositionAgentRuntime(options: {
	readonly configuration?: CodingAgentRuntimeAgentOptions;
	readonly observationPublisher: RuntimeObservationPublisher;
}): Promise<CodingAgentCompositionAgentRuntime> {
	const configured = options.configuration;
	if (configured?.host && (configured.definition || configured.source)) {
		throw new Error("Injected Runtime Agent Host owns Definition publication; definition/source cannot be provided");
	}
	const agentId = configured?.agentId ?? configured?.definition?.id ?? DEFAULT_CODING_AGENT_RUNTIME_ID;
	if (configured?.definition && configured.definition.id !== agentId) {
		throw new Error("Coding Agent Runtime definition id must match agentRuntime.agentId");
	}
	const ownsHost = configured?.host === undefined;
	const host = configured?.host ?? new RuntimeAgentHost({ observationPublisher: options.observationPublisher });
	if (ownsHost) {
		publishDefinition(host, configured?.definition ?? createCodingAgentExecutionRuntimeDefinition({ id: agentId }), {
			...(configured?.source ?? CODING_AGENT_BUILTIN_SOURCE),
		});
	}

	let instance: RuntimeAgentInstance;
	try {
		instance = await host.createInstance({
			agentId,
			...(configured?.instanceId ? { instanceId: configured.instanceId } : {}),
			configuration: configured?.instanceConfiguration,
		});
	} catch (error) {
		if (ownsHost) return rollbackCodingAgentRuntime(error, () => host.close(), "Coding Agent Host rollback failed");
		throw error;
	}

	return new DefaultCodingAgentCompositionAgentRuntime(host, instance, ownsHost);
}

export function publishCodingAgentExecutionRuntimeDefinition(
	host: RuntimeAgentHost,
	options: {
		readonly definition?: RuntimeAgentDefinition;
		readonly source?: RuntimeAgentDefinitionSourceRef;
		readonly agentId?: string;
	} = {},
): RuntimeAgentPublishResult {
	const agentId = options.agentId ?? options.definition?.id ?? DEFAULT_CODING_AGENT_RUNTIME_ID;
	const definition = options.definition ?? createCodingAgentExecutionRuntimeDefinition({ id: agentId });
	if (definition.id !== agentId) throw new Error("Coding Agent Runtime definition id does not match agentId");
	return publishDefinition(host, definition, options.source ?? CODING_AGENT_BUILTIN_SOURCE);
}

class DefaultCodingAgentCompositionAgentRuntime implements CodingAgentCompositionAgentRuntime {
	readonly agentId: string;
	readonly instanceId: string;
	readonly revisionId: string;
	private closePromise?: Promise<void>;

	constructor(
		private readonly host: RuntimeAgentHost,
		private readonly instance: RuntimeAgentInstance,
		private readonly ownsHost: boolean,
	) {
		this.agentId = instance.agentId;
		this.instanceId = instance.id;
		this.revisionId = instance.revisionId;
	}

	async createSession(
		sessionId: string,
		prepare: (context: RuntimeAgentSessionPreparationContext) => Promise<CodingAgentPreparedRuntimeAgentSession>,
	): Promise<RuntimeResources> {
		const request = new CodingAgentRuntimeAgentSessionAssemblyRequest(prepare);
		let prepared: CodingAgentPreparedRuntimeAgentSession | undefined;
		let binding: CodingAgentCapabilitySessionBinding | undefined;
		try {
			const session = await this.instance.createSession({ sessionId, configuration: request });
			prepared = request.consume();
			const cleanup = new RetryableCleanup();
			cleanup.add({ id: "runtime-agent-session", phase: 0, cleanup: () => session.close() });
			cleanup.add({ id: "coding-agent-session-resources", phase: 1, cleanup: () => prepared?.dispose() });
			binding = {
				snapshotProvider: session,
				acquirePreviewSnapshot: () => session.acquire(),
				rebindSession: async (nextSessionId) => {
					this.host.rebindSession(session.id, nextSessionId);
				},
				dispose: () => cleanup.run("Failed to dispose Coding Agent Runtime Agent session"),
			};
			return await prepared.activate(binding);
		} catch (error) {
			let rollback: () => Promise<void>;
			if (binding) {
				const activeBinding = binding;
				rollback = () => activeBinding.dispose();
			} else if (prepared) {
				const preparedSession = prepared;
				rollback = () => preparedSession.dispose();
			} else {
				rollback = () => request.rollback();
			}
			return rollbackCodingAgentRuntime(error, rollback, "Coding Agent Session assembly rollback failed");
		}
	}

	childConfiguration(): CodingAgentRuntimeAgentOptions {
		return Object.freeze({ host: this.host, agentId: this.agentId });
	}

	close(): Promise<void> {
		if (this.closePromise) return this.closePromise;
		this.closePromise = this.closeResources();
		return this.closePromise;
	}

	private async closeResources(): Promise<void> {
		const cleanup = new RetryableCleanup();
		cleanup.add({ id: "runtime-agent-instance", phase: 0, cleanup: () => this.instance.close() });
		if (this.ownsHost) cleanup.add({ id: "runtime-agent-host", phase: 1, cleanup: () => this.host.close() });
		await cleanup.run("Failed to close Coding Agent Runtime Agent resources");
	}
}

function publishDefinition(
	host: RuntimeAgentHost,
	definition: RuntimeAgentDefinition,
	source: RuntimeAgentDefinitionSourceRef,
): RuntimeAgentPublishResult {
	return host.registry.upsert({ source, definition });
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
