import type { RuntimeAgentRuntime, RuntimeAgentSession } from "../agents/index.js";
import { RUNTIME_AGENT_ERROR_CODES, RuntimeAgentError } from "../agents/index.js";
import { createRuntimeId } from "../id-generator.js";
import { RetryableCleanup, RetryableCloseController } from "../lifecycle/retryable-cleanup.js";
import type { RuntimeObservationPublisher } from "../observation/index.js";
import {
	ComposedRuntimeFactory,
	type ComposedRuntimeFactoryOptions,
	type RuntimeResourceContext,
} from "./composed-runtime-factory.js";
import { KernelRuntimeSessionBackend, type RuntimeSession } from "./kernel-runtime-session-backend.js";
import { RuntimeAgentInstancePool, type RuntimeAgentInstancePoolLease } from "./runtime-agent-instance-pool.js";
import {
	assessRuntimeHostSessionAssembly,
	type RuntimeHostSessionAssembly,
	type RuntimeHostSessionBackend,
	type RuntimeSessionCreateRequest,
} from "./session-backend.js";

export interface RuntimeAgentSessionIdentity {
	readonly sessionId: string;
}

/** 平台负责把可选持久化路径映射成稳定 Session identity。 */
export interface RuntimeAgentSessionIdentityResolver {
	resolve(request: RuntimeSessionCreateRequest): RuntimeAgentSessionIdentity | Promise<RuntimeAgentSessionIdentity>;
}

export interface RuntimeAgentSessionConfigurationContext {
	readonly request: RuntimeSessionCreateRequest;
	readonly sessionId: string;
	readonly resourceContext: RuntimeResourceContext;
}

/** 将通用 Host 请求适配成 Definition 自己校验的 Session configuration。 */
export interface RuntimeAgentSessionConfigurationResolver {
	resolve(context: RuntimeAgentSessionConfigurationContext): unknown | Promise<unknown>;
}

export interface RuntimeAgentSessionResourceFactoryContext extends RuntimeAgentSessionConfigurationContext {
	readonly agentSession: RuntimeAgentSession;
}

/** 简单 Definition 没有 activate() 时，由最终宿主提供 Conversation/Model 等环境资源。 */
export interface RuntimeAgentSessionResourceFactory {
	create(
		context: RuntimeAgentSessionResourceFactoryContext,
	): Promise<ReturnType<RuntimeAgentSession["requireRuntimeResources"]>>;
}

export interface RuntimeAgentSessionAssemblyDecoratorContext {
	readonly request: RuntimeSessionCreateRequest;
	readonly session: RuntimeSession;
	readonly assembly: RuntimeHostSessionAssembly;
}

export interface RuntimeAgentSessionAssemblyBackendOptions {
	readonly runtime: RuntimeAgentRuntime;
	readonly identity?: RuntimeAgentSessionIdentityResolver;
	readonly sessionConfiguration?: RuntimeAgentSessionConfigurationResolver;
	readonly fallbackResources?: RuntimeAgentSessionResourceFactory;
	readonly observationPublisher?: RuntimeObservationPublisher;
	readonly engine?: Omit<
		ComposedRuntimeFactoryOptions<RuntimeAgentAssemblyCreateInput>,
		"createResources" | "observationPublisher"
	>;
	readonly decorateAssembly?: (
		context: RuntimeAgentSessionAssemblyDecoratorContext,
	) => RuntimeHostSessionAssembly | Promise<RuntimeHostSessionAssembly>;
	readonly mapCreationError?: (error: unknown) => unknown;
}

export interface RuntimeAgentAssemblyCreateInput {
	readonly request: RuntimeSessionCreateRequest;
	readonly sessionId: string;
}

export interface RuntimeAgentPreparedInstance {
	readonly identity: {
		readonly agentId: string;
		readonly instanceId: string;
		readonly revisionId: string;
	};
	readonly selection: RuntimeSessionCreateRequest["agent"];
}

/**
 * 将 RuntimeHost 的 Agent 选择统一装配为 Agent Session、Kernel Runtime 和完整 Host Ports。
 * 产品只负责 Definition/Plan 和窄配置转换，不再实现第二套 Instance/Session 生命周期。
 */
export class RuntimeAgentSessionAssemblyBackend implements RuntimeHostSessionBackend {
	private readonly instancePool: RuntimeAgentInstancePool;
	private readonly kernelBackend: KernelRuntimeSessionBackend<RuntimeAgentAssemblyCreateInput>;
	private readonly identity: RuntimeAgentSessionIdentityResolver;
	private readonly pendingCreations = new Set<Promise<unknown>>();
	private readonly closeController: RetryableCloseController;
	private closed = false;

	constructor(private readonly options: RuntimeAgentSessionAssemblyBackendOptions) {
		this.instancePool = new RuntimeAgentInstancePool({
			runtime: options.runtime,
			observationPublisher: options.observationPublisher,
		});
		this.identity = options.identity ?? createDefaultIdentityResolver();
		this.closeController = new RetryableCloseController({
			cleanup: async () => {
				await Promise.allSettled([...this.pendingCreations]);
				await this.instancePool.dispose();
			},
		});
		this.kernelBackend = new KernelRuntimeSessionBackend({
			runtimeFactory: new ComposedRuntimeFactory({
				...options.engine,
				observationPublisher: options.observationPublisher,
				createResources: (input, resourceContext) => this.createResources(input, resourceContext),
			}),
		});
	}

	createAssembly(request: RuntimeSessionCreateRequest): Promise<RuntimeHostSessionAssembly> {
		return this.trackCreation(() => this.assembleSession(request));
	}

	private async assembleSession(request: RuntimeSessionCreateRequest): Promise<RuntimeHostSessionAssembly> {
		const session = await this.initializeRuntimeSession(request);
		try {
			const assessment = assessRuntimeHostSessionAssembly(session.createRuntimeHostAssemblyCandidate());
			if (!assessment.ready) {
				throw new Error(`RuntimeHost assembly is incomplete: ${assessment.missingPorts.join(", ")}`);
			}
			return this.options.decorateAssembly
				? await this.options.decorateAssembly({ request, session, assembly: assessment.assembly })
				: assessment.assembly;
		} catch (error) {
			try {
				await session.dispose();
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], "Runtime Agent assembly validation and rollback failed", {
					cause: error,
				});
			}
			throw error;
		}
	}

	createRuntimeSession(request: RuntimeSessionCreateRequest): Promise<RuntimeSession> {
		return this.trackCreation(() => this.initializeRuntimeSession(request));
	}

	private async initializeRuntimeSession(request: RuntimeSessionCreateRequest): Promise<RuntimeSession> {
		try {
			const identity = await this.identity.resolve(request);
			assertSessionId(identity.sessionId);
			const input = { request, sessionId: identity.sessionId } satisfies RuntimeAgentAssemblyCreateInput;
			return request.sessionPath ? await this.kernelBackend.resume(input) : await this.kernelBackend.create(input);
		} catch (error) {
			throw this.options.mapCreationError?.(error) ?? error;
		}
	}

	prepareInstance(
		selection: NonNullable<RuntimeSessionCreateRequest["agent"]>,
	): Promise<RuntimeAgentPreparedInstance> {
		return this.trackCreation(() => this.initializePreparedInstance(selection));
	}

	private async initializePreparedInstance(
		selection: NonNullable<RuntimeSessionCreateRequest["agent"]>,
	): Promise<RuntimeAgentPreparedInstance> {
		if (!selection.instanceKey) {
			throw new RuntimeAgentError(
				RUNTIME_AGENT_ERROR_CODES.INVALID_INSTANCE,
				"Preparing a Runtime Agent Instance requires an instanceKey",
			);
		}
		const lease = await this.instancePool.acquire(selection);
		const identity = {
			agentId: lease.instance.agentId,
			instanceId: lease.instance.id,
			revisionId: lease.instance.revisionId,
		};
		await lease.release();
		return Object.freeze({
			identity: Object.freeze(identity),
			selection: Object.freeze({ ...selection, definitionRevisionId: identity.revisionId }),
		});
	}

	dispose(): Promise<void> {
		this.closed = true;
		return this.closeController.run();
	}

	private trackCreation<T>(create: () => Promise<T>): Promise<T> {
		if (this.closed) {
			return Promise.reject(
				new RuntimeAgentError(RUNTIME_AGENT_ERROR_CODES.CLOSED, "Runtime Agent Backend is closed"),
			);
		}
		// Register before initialization starts: disposal must also wait for Plan activation and rollback.
		const operation = Promise.resolve().then(create);
		this.pendingCreations.add(operation);
		return operation.then(
			(value) => {
				this.pendingCreations.delete(operation);
				return value;
			},
			(error: unknown) => {
				this.pendingCreations.delete(operation);
				throw error;
			},
		);
	}

	private async createResources(
		input: RuntimeAgentAssemblyCreateInput,
		resourceContext: RuntimeAgentSessionConfigurationContext["resourceContext"],
	) {
		const selection = input.request.agent;
		if (!selection) {
			throw new RuntimeAgentError(
				RUNTIME_AGENT_ERROR_CODES.INVALID_INSTANCE,
				"Runtime Agent Session Backend requires an explicit Agent selection",
			);
		}

		let instanceLease: RuntimeAgentInstancePoolLease | undefined;
		let agentSession: RuntimeAgentSession | undefined;
		try {
			instanceLease = await this.instancePool.acquire(selection);
			const configurationContext: RuntimeAgentSessionConfigurationContext = {
				request: input.request,
				sessionId: input.sessionId,
				resourceContext,
			};
			const configuration = this.options.sessionConfiguration
				? await this.options.sessionConfiguration.resolve(configurationContext)
				: selection.sessionConfiguration;
			agentSession = await instanceLease.instance.createSession({
				sessionId: input.sessionId,
				configuration,
			});
			const activatedResources = agentSession.readRuntimeResources();
			const resources =
				activatedResources ??
				(await this.options.fallbackResources?.create({
					...configurationContext,
					agentSession,
				}));
			if (!resources) {
				throw new RuntimeAgentError(
					RUNTIME_AGENT_ERROR_CODES.INVALID_INSTANCE,
					`Runtime Agent ${selection.id} must activate Runtime resources or use a Host resource factory`,
				);
			}
			if (resources.snapshotProvider !== agentSession) {
				throw new RuntimeAgentError(
					RUNTIME_AGENT_ERROR_CODES.INVALID_INSTANCE,
					`Runtime Agent Session ${agentSession.id} must be the only Runtime Snapshot Provider`,
				);
			}
			if (resources.sessionId !== agentSession.id) {
				throw new RuntimeAgentError(
					RUNTIME_AGENT_ERROR_CODES.INVALID_INSTANCE,
					`Runtime Agent Session identity ${agentSession.id} does not match Runtime resources ${resources.sessionId}`,
				);
			}

			const cleanup = createSessionCleanup({
				agentSession,
				instanceLease,
				fallbackDispose: activatedResources ? undefined : resources.dispose,
			});
			return {
				...resources,
				identity: { ...resources.identity, agentId: agentSession.agentId },
				snapshotProvider: agentSession,
				dispose: cleanup,
			};
		} catch (error) {
			const cleanup = new RetryableCleanup();
			if (agentSession) cleanup.add({ id: "agent-session", phase: 0, cleanup: () => agentSession?.close() });
			if (instanceLease) cleanup.add({ id: "instance-lease", phase: 1, cleanup: () => instanceLease?.release() });
			try {
				await cleanup.run("Runtime Agent resource initialization rollback failed");
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					"Runtime Agent resource initialization and rollback failed",
					{
						cause: error,
					},
				);
			}
			throw error;
		}
	}
}

function createSessionCleanup(options: {
	readonly agentSession: RuntimeAgentSession;
	readonly instanceLease: RuntimeAgentInstancePoolLease;
	readonly fallbackDispose?: () => Promise<void>;
}): () => Promise<void> {
	const cleanup = new RetryableCleanup();
	let phase = 0;
	if (options.fallbackDispose) {
		const dispose = options.fallbackDispose;
		cleanup.add({ id: "fallback-resources", phase: phase++, cleanup: () => dispose() });
	}
	cleanup.add({ id: "agent-session", phase: phase++, cleanup: () => options.agentSession.close() });
	cleanup.add({ id: "instance-lease", phase, cleanup: () => options.instanceLease.release() });
	return () => cleanup.run("Failed to close Runtime Agent Session resources");
}

function createDefaultIdentityResolver(): RuntimeAgentSessionIdentityResolver {
	return {
		resolve: (request) => {
			if (request.sessionPath) {
				throw new Error("Resuming a Runtime Agent Session requires a platform identity resolver");
			}
			return { sessionId: `session-${createRuntimeId()}` };
		},
	};
}

function assertSessionId(sessionId: string): void {
	if (!sessionId || sessionId.trim() !== sessionId) {
		throw new RuntimeAgentError(
			RUNTIME_AGENT_ERROR_CODES.INVALID_INSTANCE,
			"Runtime Agent Session id must be a non-empty trimmed string",
		);
	}
}
