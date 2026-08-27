import type { RuntimeAgentRuntime } from "../agents/index.js";
import { type RuntimeObservationPublisher, runtimeObservationFailure } from "../observation/index.js";
import type { RuntimeHostAgentBackendRegistry } from "./agent-backend-admission.js";
import { RUNTIME_HOST_AGENT_BACKEND_OBSERVATION } from "./observations.js";
import type { RuntimeHostAgentInstallation, RuntimeHostAgentInstallationOptions } from "./types.js";

export interface RuntimeHostAgentInstallerOptions {
	readonly agents: RuntimeAgentRuntime;
	readonly agentBackends: RuntimeHostAgentBackendRegistry;
	readonly observations: RuntimeObservationPublisher;
	readonly assertHostOpen: () => void;
}

/** Atomically publishes one peer Agent Definition and its Host Backend generation. */
export class RuntimeHostAgentInstaller {
	constructor(private readonly options: RuntimeHostAgentInstallerOptions) {}

	async install(options: RuntimeHostAgentInstallationOptions): Promise<RuntimeHostAgentInstallation> {
		this.options.assertHostOpen();
		const agentId = options.definition.id;
		this.options.observations.record(
			RUNTIME_HOST_AGENT_BACKEND_OBSERVATION,
			{
				operation: "install",
				phase: "started",
				sourceId: options.source.id,
				sourceRevision: options.source.revision,
			},
			{ agentId },
		);
		let backend: Awaited<ReturnType<RuntimeHostAgentInstallationOptions["createBackend"]>> | undefined;
		let definitionRevisionId: string | undefined;
		try {
			if (this.options.agents.registry.snapshot().entries.some((entry) => entry.agentId === agentId)) {
				throw new Error(`Runtime Agent is already installed: ${agentId}`);
			}
			if (this.options.agentBackends.snapshot().entries.some((entry) => entry.agentId === agentId)) {
				throw new Error(`Runtime Host Agent Backend is already installed: ${agentId}`);
			}
			backend = await options.createBackend({
				agents: this.options.agents,
				observationPublisher: this.options.observations,
			});
			this.options.assertHostOpen();
			const definitionPublish = this.options.agents.registry.upsert({
				source: options.source,
				definition: options.definition,
			});
			definitionRevisionId = definitionPublish.revision.id;
			const backendPublish = this.options.agentBackends.upsert({
				agentId,
				source: options.source,
				backend,
				catalog: options.catalog,
				ownsBackend: options.ownsBackend ?? true,
			});
			this.options.observations.record(
				RUNTIME_HOST_AGENT_BACKEND_OBSERVATION,
				{
					operation: "install",
					phase: "completed",
					backendRevisionId: backendPublish.revision.id,
					sourceId: options.source.id,
					sourceRevision: options.source.revision,
				},
				{ agentId, revisionId: definitionPublish.revision.id },
			);
			let retirement: ReturnType<RuntimeHostAgentInstallation["retire"]> | undefined;
			return Object.freeze({
				agentId,
				definitionRevisionId: definitionPublish.revision.id,
				backendRevision: backendPublish.revision,
				retire: () => {
					if (retirement) return retirement;
					const definitionRemoved = this.options.agents.registry.remove(agentId, definitionPublish.revision.id);
					const backendRetirement = this.options.agentBackends.remove(agentId, backendPublish.revision.id);
					retirement = Object.freeze({
						definitionRemoved,
						...(backendRetirement ? { backendRetirement } : {}),
					});
					return retirement;
				},
			});
		} catch (error) {
			const cleanupErrors: unknown[] = [];
			if (definitionRevisionId) {
				try {
					this.options.agents.registry.remove(agentId, definitionRevisionId);
				} catch (cleanupError) {
					cleanupErrors.push(cleanupError);
				}
			}
			if (backend && (options.ownsBackend ?? true)) {
				try {
					await backend.dispose?.();
				} catch (cleanupError) {
					cleanupErrors.push(cleanupError);
				}
			}
			this.options.observations.record(
				RUNTIME_HOST_AGENT_BACKEND_OBSERVATION,
				{
					operation: "install",
					phase: "failed",
					sourceId: options.source.id,
					sourceRevision: options.source.revision,
					failure: runtimeObservationFailure(error),
				},
				{ agentId },
			);
			if (cleanupErrors.length > 0) {
				throw new AggregateError([error, ...cleanupErrors], "Runtime Host Agent installation and rollback failed", {
					cause: error,
				});
			}
			throw error;
		}
	}
}
