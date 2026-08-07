import { randomUUID } from "node:crypto";
import type { RuntimeSessionCatalog } from "@vetta/runtime-core";
import { type GreenfieldRuntimeSession, InitializationRollbackScope, RetryableCleanup } from "@vetta/runtime-core";
import { FileConversationRuntimeSessionCatalog } from "@vetta/runtime-storage/conversation";
import type {
	CodingAgentRuntimeComposition,
	CodingAgentRuntimeCompositionOptions,
	CodingAgentRuntimeSessionOptions,
} from "../../composition/contracts/index.js";
import { resolveGreenfieldSessionIdFromPath } from "../../composition/greenfield-conversation-path.js";
import { createCodingAgentRuntimeComposition } from "../../composition/runtime-composition.js";
import {
	CodingAgentActiveSessionHost,
	type CodingAgentPreparedSessionBinding,
	type CodingAgentSessionTransitionLifecycle,
} from "../../composition/session-host/active-session-transition-host.js";
import { GreenfieldSdkActiveSessionAdapter } from "./active-session-adapter.js";
import { CodingAgentGreenfieldSdkActiveSessionCapabilityHost } from "./active-session-capability-host.js";
import { bindGreenfieldSdkActiveSessionRuntime } from "./runtime-binding.js";
import type {
	GreenfieldSdkActiveSession,
	GreenfieldSdkActiveSessionCapabilityPort,
	GreenfieldSdkSessionCapabilityPort,
} from "./runtime-contracts.js";
import { CodingAgentGreenfieldSessionCapabilityHost } from "./session-capability-host.js";
import {
	type GreenfieldSdkSessionStorageTarget,
	type ResolvedGreenfieldSdkSessionStorage,
	resolveGreenfieldSdkSessionStorage,
} from "./storage.js";

type GreenfieldSdkCompositionOptions = Omit<
	CodingAgentRuntimeCompositionOptions,
	"conversationDir" | "createConversationPersistence"
>;

type GreenfieldSdkRuntimeSessionOptions = Omit<CodingAgentRuntimeSessionOptions, "sessionId">;

export interface GreenfieldSdkSessionFactoryOptions {
	readonly storage: GreenfieldSdkSessionStorageTarget;
	readonly composition: GreenfieldSdkCompositionOptions;
	readonly session?: GreenfieldSdkRuntimeSessionOptions;
	/** Composition 创建前已由产品宿主取得、并随 SDK Session 释放的资源。 */
	readonly ownedResources?: readonly GreenfieldSdkOwnedResource[];
	/** Runtime Session 创建后绑定 Extension 等 Session 级产品资源。 */
	readonly initializeSession?: GreenfieldSdkSessionInitializer;
	/** 将产品设置、模型范围和重试控制接入可切换的 Session 能力宿主。 */
	readonly createCapabilityHost?: GreenfieldSdkSessionCapabilityHostFactory;
	/** Extension 等产品绑定参与活动 Session 切换事务的生命周期。 */
	readonly transitionLifecycle?: CodingAgentSessionTransitionLifecycle;
	/** 为 SDK 补充树导航、Bash 和 Legacy setup 等活动会话能力。 */
	readonly createActiveCapabilityHost?: GreenfieldSdkActiveSessionCapabilityHostFactory;
	/** 完整清理成功后通知外层 Host 释放 Session 所有权。 */
	readonly onSessionClosed?: () => void;
}

export interface GreenfieldSdkOwnedResource {
	readonly id: string;
	dispose(): void | Promise<void>;
}

export interface GreenfieldSdkSessionInitializationContext {
	readonly session: GreenfieldRuntimeSession;
	readonly composition: CodingAgentRuntimeComposition;
	readonly source: "initial" | "transition";
}

export type GreenfieldSdkSessionInitializer = (
	context: GreenfieldSdkSessionInitializationContext,
) => Promise<GreenfieldSdkOwnedResource | undefined>;

export type GreenfieldSdkSessionCapabilityHostFactory = (
	context: GreenfieldSdkSessionInitializationContext & { readonly readSession: () => GreenfieldRuntimeSession },
) => GreenfieldSdkSessionCapabilityPort;

export interface GreenfieldSdkActiveSessionCapabilityHostContext {
	readonly sessionHost: CodingAgentActiveSessionHost;
	readonly composition: CodingAgentRuntimeComposition;
}

export type GreenfieldSdkActiveSessionCapabilityHostFactory = (
	context: GreenfieldSdkActiveSessionCapabilityHostContext,
) => GreenfieldSdkActiveSessionCapabilityPort;

export interface GreenfieldSdkSessionFactoryResult {
	readonly session: GreenfieldSdkActiveSession;
}

/**
 * Greenfield SDK 的内部 Composition Root。
 *
 * 包根兼容工厂不直接进入这里；本工厂只接受已经完成产品资源解析的中立
 * Composition 参数，并显式处理存储目标、create/resume 路由与失败回滚。
 */
export async function createGreenfieldSdkSession(
	options: GreenfieldSdkSessionFactoryOptions,
): Promise<GreenfieldSdkSessionFactoryResult> {
	const rollback = new InitializationRollbackScope();
	for (const resource of options.ownedResources ?? []) {
		rollback.defer({ id: resource.id, rollback: () => resource.dispose() });
	}
	let storage: ResolvedGreenfieldSdkSessionStorage;
	try {
		storage = resolveGreenfieldSdkSessionStorage(options.storage);
	} catch (error) {
		return rollback.rollback(error, "Greenfield SDK storage resolution and rollback failed");
	}
	let composition: CodingAgentRuntimeComposition;
	try {
		composition = await createCodingAgentRuntimeComposition({
			...options.composition,
			conversationDir: storage.conversationDir ?? "memory://conversation",
			createConversationPersistence: storage.createConversationPersistence,
		});
	} catch (error) {
		return rollback.rollback(error, "Greenfield SDK composition initialization failed");
	}
	rollback.defer({ id: "runtime-composition", rollback: () => composition.dispose() });

	try {
		const sessionOptions = { ...options.session, sessionId: storage.sessionId };
		const runtimeSession = await composition.backend[storage.operation](sessionOptions);
		const dismissRuntimeSessionRollback = rollback.defer({
			id: "runtime-session",
			rollback: () => runtimeSession.dispose(),
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
		let activeCapabilities: GreenfieldSdkActiveSessionCapabilityPort | undefined;
		const sessionHost = new CodingAgentActiveSessionHost({
			runtime: {
				...composition,
				quiesceSessionBackgroundCommands: async (sessionId) => {
					await activeCapabilities?.quiesceIdentity();
					await composition.quiesceSessionBackgroundCommands(sessionId);
				},
			},
			initialSession: runtimeSession,
			sessionOptions: options.session ?? {},
			conversationDir,
			sessionCatalog: createSessionCatalog(storage, options.session?.cwd),
			createSessionId: randomUUID,
			resolveSessionId: (path) => resolveGreenfieldSessionIdFromPath(conversationDir, path),
			lifecycle: createResourceAwareTransitionLifecycle(
				composition,
				options,
				() => activeResource,
				(resource) => {
					activeResource = resource;
				},
			),
		});
		dismissRuntimeSessionRollback();
		rollback.defer({ id: "active-session-host", rollback: () => sessionHost.dispose() });
		const capabilityHost =
			options.createCapabilityHost?.({
				session: runtimeSession,
				composition,
				source: "initial",
				readSession: () => sessionHost.readSession(),
			}) ?? new CodingAgentGreenfieldSessionCapabilityHost({ readSession: () => sessionHost.readSession() });
		activeCapabilities =
			options.createActiveCapabilityHost?.({ sessionHost, composition }) ??
			new CodingAgentGreenfieldSdkActiveSessionCapabilityHost({ sessionHost });
		const cleanup = createActiveSessionCleanup(
			sessionHost,
			composition,
			activeCapabilities,
			capabilityHost,
			options.ownedResources ?? [],
			() => activeResource,
		);
		const runtime = bindGreenfieldSdkActiveSessionRuntime(sessionHost, capabilityHost, () =>
			cleanup.run("Failed to dispose Greenfield SDK active session resources"),
		);
		const session = new GreenfieldSdkActiveSessionAdapter(runtime, activeCapabilities, options.onSessionClosed);
		rollback.commit();
		return { session };
	} catch (error) {
		return rollback.rollback(error, "Greenfield SDK session initialization and rollback failed");
	}
}

function createActiveSessionCleanup(
	sessionHost: CodingAgentActiveSessionHost,
	composition: CodingAgentRuntimeComposition,
	activeCapabilities: GreenfieldSdkActiveSessionCapabilityPort,
	capabilityHost: GreenfieldSdkSessionCapabilityPort,
	ownedResources: readonly GreenfieldSdkOwnedResource[],
	readActiveResource: () => GreenfieldSdkOwnedResource | undefined,
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
	cleanup.add({ id: "runtime-composition", phase: 3, cleanup: () => composition.dispose() });
	for (const resource of ownedResources) {
		cleanup.add({ id: resource.id, phase: 4, cleanup: () => resource.dispose() });
	}
	return cleanup;
}

function createSessionCatalog(
	storage: ResolvedGreenfieldSdkSessionStorage,
	cwd: string | undefined,
): RuntimeSessionCatalog {
	if (!storage.conversationDir) return EMPTY_SESSION_CATALOG;
	return new FileConversationRuntimeSessionCatalog({
		roots: [{ cwd: cwd ?? process.cwd(), sessionDir: storage.conversationDir }],
	});
}

function createResourceAwareTransitionLifecycle(
	composition: CodingAgentRuntimeComposition,
	options: GreenfieldSdkSessionFactoryOptions,
	readActiveResource: () => GreenfieldSdkOwnedResource | undefined,
	setActiveResource: (resource: GreenfieldSdkOwnedResource | undefined) => void,
): CodingAgentSessionTransitionLifecycle | undefined {
	if (!options.initializeSession && !options.transitionLifecycle) return undefined;
	return {
		before: (transition) => options.transitionLifecycle?.before?.(transition) ?? Promise.resolve(undefined),
		prepare: async (transition) => {
			const previousResource = readActiveResource();
			let nextResource: GreenfieldSdkOwnedResource | undefined;
			let externalPrepared: CodingAgentPreparedSessionBinding | undefined;
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

const EMPTY_SESSION_CATALOG: RuntimeSessionCatalog = {
	ownsSession: async () => false,
	listProjects: async () => [],
	listSessions: async () => [],
	renameSession: async () => {
		throw new Error("In-memory Greenfield SDK sessions cannot be renamed through a file catalog");
	},
	deleteSessionArtifacts: async () => {},
};
