import {
	InitializationRollbackScope,
	RetryableCleanup,
	RuntimeActiveSessionHost,
	type RuntimeActiveSessionTransitionLifecycle,
	RuntimeHost,
	type RuntimeHostSession,
	type RuntimePreparedSessionBinding,
} from "@vetta/runtime-core";
import type {
	CodingAgentRuntimeComposition,
	CodingAgentRuntimeCompositionOptions,
	CodingAgentRuntimeSessionOptions,
} from "../../composition/contracts/index.js";
import { createCodingAgentRuntimeComposition } from "../../composition/runtime-composition.js";
import { createCodingAgentRuntimeHostSessionConfig } from "../../composition/runtime-host-session-config.js";
import type { CodingAgentSessionStorageTarget } from "../../public-api/sdk/sdk-create-contract.js";
import type { CodingAgentSession } from "../../public-api/sdk/sdk-session-contract.js";
import { CodingAgentSdkActiveSessionAdapter } from "./active-session-adapter.js";
import { CodingAgentSdkActiveSessionCapabilityHost } from "./active-session-capability-host.js";
import type {
	CodingAgentSdkSessionArtifactCleaner,
	CodingAgentSdkSessionIdentityRuntime,
	ResolvedCodingAgentSdkSessionStorage,
} from "./contracts/session-identity-runtime.js";
import { bindCodingAgentSdkActiveSessionRuntime } from "./runtime-binding.js";
import type {
	CodingAgentSdkActiveSessionCapabilityPort,
	CodingAgentSdkSessionCapabilityPort,
} from "./runtime-contracts.js";
import { CodingAgentSdkSessionCapabilityHost } from "./session-capability-host.js";

type CodingAgentSdkCompositionOptions = Omit<
	CodingAgentRuntimeCompositionOptions,
	"conversationDir" | "createConversationPersistence"
>;

type CodingAgentSdkRuntimeSessionOptions = Omit<CodingAgentRuntimeSessionOptions, "sessionId">;

export interface CodingAgentSdkSessionFactoryOptions {
	readonly storage: CodingAgentSessionStorageTarget;
	readonly identityRuntime: CodingAgentSdkSessionIdentityRuntime;
	readonly composition: CodingAgentSdkCompositionOptions;
	readonly session?: CodingAgentSdkRuntimeSessionOptions;
	readonly sessionArtifactCleaner?: CodingAgentSdkSessionArtifactCleaner;
	/** Composition 创建前已由产品宿主取得、并随 SDK Session 释放的资源。 */
	readonly ownedResources?: readonly CodingAgentSdkOwnedResource[];
	/** Runtime Session 创建后绑定 Extension 等 Session 级产品资源。 */
	readonly initializeSession?: CodingAgentSdkSessionInitializer;
	/** 将产品设置、模型范围和重试控制接入可切换的 Session 能力宿主。 */
	readonly createCapabilityHost?: CodingAgentSdkSessionCapabilityHostFactory;
	/** Extension 等产品绑定参与活动 Session 切换事务的生命周期。 */
	readonly transitionLifecycle?: RuntimeActiveSessionTransitionLifecycle<RuntimeHostSession>;
	/** 为 SDK 补充树导航、Bash 和 Legacy setup 等活动会话能力。 */
	readonly createActiveCapabilityHost?: CodingAgentSdkActiveSessionCapabilityHostFactory;
	/** 完整清理成功后通知外层 Host 释放 Session 所有权。 */
	readonly onSessionClosed?: () => void;
}

export interface CodingAgentSdkOwnedResource {
	readonly id: string;
	dispose(): void | Promise<void>;
}

export interface CodingAgentSdkSessionInitializationContext {
	readonly session: RuntimeHostSession;
	readonly composition: CodingAgentRuntimeComposition;
	readonly source: "initial" | "transition";
}

export type CodingAgentSdkSessionInitializer = (
	context: CodingAgentSdkSessionInitializationContext,
) => Promise<CodingAgentSdkOwnedResource | undefined>;

export type CodingAgentSdkSessionCapabilityHostFactory = (
	context: CodingAgentSdkSessionInitializationContext & { readonly readSession: () => RuntimeHostSession },
) => CodingAgentSdkSessionCapabilityPort;

export interface CodingAgentSdkActiveSessionCapabilityHostContext {
	readonly sessionHost: RuntimeActiveSessionHost<CodingAgentRuntimeSessionOptions, RuntimeHostSession>;
	readonly composition: CodingAgentRuntimeComposition;
}

export type CodingAgentSdkActiveSessionCapabilityHostFactory = (
	context: CodingAgentSdkActiveSessionCapabilityHostContext,
) => CodingAgentSdkActiveSessionCapabilityPort;

export interface CodingAgentSdkSessionFactoryResult {
	readonly session: CodingAgentSession;
}

/**
 * Coding Agent SDK 的内部 Composition Root。
 *
 * 包根兼容工厂不直接进入这里；本工厂只接受已经完成产品资源解析的中立
 * Composition 参数，并显式处理存储目标、create/resume 路由与失败回滚。
 */
export async function createCodingAgentSdkSession(
	options: CodingAgentSdkSessionFactoryOptions,
): Promise<CodingAgentSdkSessionFactoryResult> {
	const rollback = new InitializationRollbackScope();
	for (const resource of options.ownedResources ?? []) {
		rollback.defer({ id: resource.id, rollback: () => resource.dispose() });
	}
	let storage: ResolvedCodingAgentSdkSessionStorage;
	try {
		storage = options.identityRuntime.resolveStorage(options.storage);
	} catch (error) {
		return rollback.rollback(error, "SDK storage resolution and rollback failed");
	}
	let composition: CodingAgentRuntimeComposition;
	try {
		composition = await createCodingAgentRuntimeComposition({
			...options.composition,
			conversationDir: storage.conversationDir ?? "memory://conversation",
			createConversationPersistence: storage.createConversationPersistence,
		});
	} catch (error) {
		return rollback.rollback(error, "SDK composition initialization failed");
	}
	rollback.defer({ id: "runtime-composition", rollback: () => composition.dispose() });

	try {
		const sessionCatalog = options.identityRuntime.createSessionCatalog({
			storage,
			cwd: options.session?.cwd,
			artifactCleaner: options.sessionArtifactCleaner,
		});
		const observationPublisher = composition.observations.publisher();
		const runtimeHost = new RuntimeHost({
			sessionBackend: composition.runtimeHostBackend,
			sessionCatalog,
			observationPublisher,
			// SDK 迁移到 RuntimeHost 前默认直接执行工具；宿主仍可通过 session.executionMode 显式选择沙箱。
			getDefaultExecutionMode: () => "full-access",
		});
		rollback.defer({ id: "runtime-host", rollback: () => runtimeHost.close() });
		const sessionOptions = { ...options.session, sessionId: storage.sessionId };
		const initialCreated = await runtimeHost.createSession(
			toRuntimeHostSessionConfig(
				composition,
				sessionOptions,
				storage.operation === "resume"
					? options.identityRuntime.resolveSessionPath(storage.conversationDir ?? "", storage.sessionId)
					: undefined,
			),
		);
		const runtimeSession = runtimeHost.getSessionView(initialCreated.sessionId);
		const dismissRuntimeSessionRollback = rollback.defer({
			id: "runtime-session",
			rollback: () => runtimeHost.disposeSession(runtimeSession.sessionId),
		});
		let activeResource = await options.initializeSession?.({
			session: runtimeSession,
			composition,
			source: "initial",
		});
		if (activeResource) {
			rollback.defer({ id: activeResource.id, rollback: () => activeResource?.dispose() });
		}
		const conversationDir = storage.conversationDir ?? "memory://conversation";
		let activeCapabilities: CodingAgentSdkActiveSessionCapabilityPort | undefined;
		const sessionHost = new RuntimeActiveSessionHost<CodingAgentRuntimeSessionOptions, RuntimeHostSession>({
			runtime: {
				sessions: {
					create: async (nextOptions) => {
						const created = await runtimeHost.createSession(toRuntimeHostSessionConfig(composition, nextOptions));
						return runtimeHost.getSessionView(created.sessionId);
					},
					resume: async (nextOptions) => {
						const sessionPath = options.identityRuntime.resolveSessionPath(
							conversationDir,
							nextOptions.sessionId,
						);
						const created = await runtimeHost.createSession(
							toRuntimeHostSessionConfig(composition, nextOptions, sessionPath),
						);
						return runtimeHost.getSessionView(created.sessionId);
					},
				},
				sessionHooks: composition.sessionHooks,
				quiesceSessionBackgroundCommands: async (sessionId) => {
					await activeCapabilities?.quiesceIdentity();
					await composition.quiesceSessionBackgroundCommands(sessionId);
				},
				preserveSessionExecutionContext: (sourceSessionId, targetSessionId) =>
					composition.preserveSessionExecutionContext(sourceSessionId, targetSessionId),
			},
			initialSession: runtimeSession,
			sessionOptions: options.session ?? {},
			conversationDir,
			defaultCwd: options.identityRuntime.resolveDefaultCwd(options.session?.cwd ?? options.composition.cwd),
			sessionCatalog,
			createSessionId: () => options.identityRuntime.createSessionId(),
			resolveSessionId: (path) => options.identityRuntime.resolveSessionId(conversationDir, path),
			resolveSessionPath: (sessionId) => options.identityRuntime.resolveSessionPath(conversationDir, sessionId),
			lifecycle: createResourceAwareTransitionLifecycle(
				composition,
				options,
				() => activeResource,
				(resource) => {
					activeResource = resource;
				},
			),
			observationPublisher,
		});
		dismissRuntimeSessionRollback();
		rollback.defer({ id: "active-session-host", rollback: () => sessionHost.dispose() });
		const capabilityHost =
			options.createCapabilityHost?.({
				session: runtimeSession,
				composition,
				source: "initial",
				readSession: () => sessionHost.readSession(),
			}) ?? new CodingAgentSdkSessionCapabilityHost({ readSession: () => sessionHost.readSession() });
		activeCapabilities =
			options.createActiveCapabilityHost?.({ sessionHost, composition }) ??
			new CodingAgentSdkActiveSessionCapabilityHost({ sessionHost });
		const cleanup = createActiveSessionCleanup(
			sessionHost,
			runtimeHost,
			composition,
			activeCapabilities,
			capabilityHost,
			options.ownedResources ?? [],
			() => activeResource,
		);
		const runtime = bindCodingAgentSdkActiveSessionRuntime(sessionHost, capabilityHost, () =>
			cleanup.run("Failed to dispose SDK active session resources"),
		);
		const session = new CodingAgentSdkActiveSessionAdapter(runtime, activeCapabilities, options.onSessionClosed);
		rollback.commit();
		return { session };
	} catch (error) {
		return rollback.rollback(error, "SDK session initialization and rollback failed");
	}
}

function createActiveSessionCleanup(
	sessionHost: RuntimeActiveSessionHost<CodingAgentRuntimeSessionOptions, RuntimeHostSession>,
	runtimeHost: RuntimeHost,
	composition: CodingAgentRuntimeComposition,
	activeCapabilities: CodingAgentSdkActiveSessionCapabilityPort,
	capabilityHost: CodingAgentSdkSessionCapabilityPort,
	ownedResources: readonly CodingAgentSdkOwnedResource[],
	readActiveResource: () => CodingAgentSdkOwnedResource | undefined,
): RetryableCleanup {
	const cleanup = new RetryableCleanup();
	cleanup.add({ id: "session-capability-host", phase: 0, cleanup: () => capabilityHost.abortRetry() });
	cleanup.add({ id: "active-capability-host", phase: 0, cleanup: () => activeCapabilities.dispose() });
	cleanup.add({ id: "active-session-host", phase: 1, cleanup: () => sessionHost.dispose() });
	cleanup.add({
		id: "active-session-resource",
		phase: 2,
		cleanup: () => readActiveResource()?.dispose(),
	});
	cleanup.add({ id: "runtime-host", phase: 3, cleanup: () => runtimeHost.close() });
	cleanup.add({ id: "runtime-composition", phase: 4, cleanup: () => composition.dispose() });
	for (const resource of ownedResources) {
		cleanup.add({ id: resource.id, phase: 5, cleanup: () => resource.dispose() });
	}
	return cleanup;
}

function createResourceAwareTransitionLifecycle(
	composition: CodingAgentRuntimeComposition,
	options: CodingAgentSdkSessionFactoryOptions,
	readActiveResource: () => CodingAgentSdkOwnedResource | undefined,
	setActiveResource: (resource: CodingAgentSdkOwnedResource | undefined) => void,
): RuntimeActiveSessionTransitionLifecycle<RuntimeHostSession> | undefined {
	if (!options.initializeSession && !options.transitionLifecycle) return undefined;
	return {
		before: (transition) => options.transitionLifecycle?.before?.(transition) ?? Promise.resolve(undefined),
		prepare: async (transition) => {
			const previousResource = readActiveResource();
			let nextResource: CodingAgentSdkOwnedResource | undefined;
			let externalPrepared: RuntimePreparedSessionBinding | undefined;
			try {
				nextResource = await options.initializeSession?.({
					session: transition.next,
					composition,
					source: "transition",
				});
				externalPrepared = await options.transitionLifecycle?.prepare?.(transition);
			} catch (error) {
				await nextResource?.dispose();
				throw error;
			}
			return {
				commit: async () => {
					await externalPrepared?.commit();
					setActiveResource(nextResource);
				},
				rollback: async () => {
					setActiveResource(previousResource);
					await externalPrepared?.rollback();
					await nextResource?.dispose();
				},
				finalize: async () => {
					await externalPrepared?.finalize();
					await previousResource?.dispose();
				},
			};
		},
		after: (transition) => options.transitionLifecycle?.after?.(transition) ?? Promise.resolve(),
	};
}

function toRuntimeHostSessionConfig(
	composition: CodingAgentRuntimeComposition,
	options: CodingAgentRuntimeSessionOptions,
	sessionPath?: string,
) {
	return createCodingAgentRuntimeHostSessionConfig(composition.agentRuntime, options, {
		...(sessionPath ? { sessionPath } : {}),
	});
}
