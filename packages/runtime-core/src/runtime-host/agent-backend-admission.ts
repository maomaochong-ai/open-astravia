import type { RuntimeAgentDefinitionSourceRef } from "../agents/index.js";
import { createRuntimeId } from "../id-generator.js";
import { RetryableCloseController } from "../lifecycle/retryable-cleanup.js";
import type { RuntimeObservationPublisher } from "../observation/index.js";
import { runtimeObservationFailure } from "../observation/index.js";
import { RUNTIME_HOST_AGENT_BACKEND_OBSERVATION, type RuntimeHostAgentBackendOperation } from "./observations.js";
import type {
	RuntimeHostSessionAssembly,
	RuntimeHostSessionBackend,
	RuntimeSessionCreateRequest,
} from "./session-backend.js";
import type { RuntimeSessionCatalog } from "./session-services.js";

export const RUNTIME_HOST_AGENT_BACKEND_ERROR_CODES = {
	CLOSED: "RUNTIME_HOST_AGENT_BACKEND_CLOSED",
	INVALID_REGISTRATION: "RUNTIME_HOST_AGENT_BACKEND_INVALID_REGISTRATION",
	NOT_FOUND: "RUNTIME_HOST_AGENT_BACKEND_NOT_FOUND",
	SOURCE_CONFLICT: "RUNTIME_HOST_AGENT_BACKEND_SOURCE_CONFLICT",
	UNAVAILABLE: "RUNTIME_HOST_AGENT_BACKEND_UNAVAILABLE",
	AMBIGUOUS_SESSION: "RUNTIME_HOST_AGENT_BACKEND_AMBIGUOUS_SESSION",
} as const;

export type RuntimeHostAgentBackendErrorCode =
	(typeof RUNTIME_HOST_AGENT_BACKEND_ERROR_CODES)[keyof typeof RUNTIME_HOST_AGENT_BACKEND_ERROR_CODES];

export class RuntimeHostAgentBackendError extends Error {
	readonly code: RuntimeHostAgentBackendErrorCode;

	constructor(code: RuntimeHostAgentBackendErrorCode, message: string) {
		super(message);
		this.name = "RuntimeHostAgentBackendError";
		this.code = code;
	}
}

export interface RuntimeHostAgentBackendCandidate {
	readonly agentId: string;
	readonly source: RuntimeAgentDefinitionSourceRef;
	readonly backend: RuntimeHostSessionBackend;
	/** 恢复请求未携带 agentId 时，用于认领该 Agent 的持久化 Session。 */
	readonly catalog?: RuntimeSessionCatalog;
	/** 默认 false；共享 Backend 的所有权必须留在外部组合根。 */
	readonly ownsBackend?: boolean;
}

export interface RuntimeHostAgentBackendRevision {
	readonly id: string;
	readonly sequence: number;
	readonly agentId: string;
	readonly source: RuntimeAgentDefinitionSourceRef;
	readonly registeredAt: number;
}

export interface RuntimeHostAgentBackendRetirement {
	readonly revision: RuntimeHostAgentBackendRevision;
	/** 等待所有既有 Session 释放并回收 Backend；失败后可再次调用。 */
	dispose(): Promise<void>;
}

export interface RuntimeHostAgentBackendPublishResult {
	readonly status: "registered" | "replaced";
	readonly revision: RuntimeHostAgentBackendRevision;
	readonly retirement?: RuntimeHostAgentBackendRetirement;
}

export interface RuntimeHostAgentBackendEntrySnapshot {
	readonly agentId: string;
	readonly sourceId: string;
	readonly state: "active" | "retired";
	readonly currentRevisionId?: string;
	readonly lastRevisionId: string;
}

export interface RuntimeHostAgentBackendRegistrySnapshot {
	readonly closed: boolean;
	readonly entries: readonly RuntimeHostAgentBackendEntrySnapshot[];
	readonly generationCount: number;
	readonly retiredGenerationCount: number;
	readonly activeLeaseCount: number;
	readonly removedAgentCount: number;
}

export interface RuntimeHostAgentBackendRegistryOptions {
	readonly defaultBackend?: RuntimeHostSessionBackend;
	readonly observationPublisher?: RuntimeObservationPublisher;
	readonly createRevisionId?: () => string;
	readonly now?: () => number;
}

interface BackendEntry {
	readonly agentId: string;
	readonly sourceId: string;
	state: "active" | "retired";
	current?: BackendGeneration;
	lastRevisionId: string;
}

interface BackendGeneration {
	readonly revision: RuntimeHostAgentBackendRevision;
	readonly backend: RuntimeHostSessionBackend;
	readonly catalog: RuntimeSessionCatalog | undefined;
	readonly ownsBackend: boolean;
	readonly closeController: RetryableCloseController;
	readonly unusedWaiters: Array<() => void>;
	activeLeases: number;
	retired: boolean;
}

interface BackendLease {
	readonly generation: BackendGeneration;
	readonly routeSource: "agent" | "catalog";
	release(): Promise<void>;
}

/**
 * RuntimeHost 内的主 Agent admission 控制面。
 *
 * Definition Registry 决定 Agent 的定义与 revision；本 Registry 只决定新 Host Session
 * 由哪个 Backend 装配。Backend generation 的 lease 由返回 Assembly 的 lifecycle 持有。
 */
export class RuntimeHostAgentBackendRegistry implements RuntimeHostSessionBackend {
	private readonly entries = new Map<string, BackendEntry>();
	private readonly generations = new Map<string, BackendGeneration>();
	private readonly knownAgentIds = new Set<string>();
	private readonly defaultBackend: RuntimeHostSessionBackend | undefined;
	private readonly observations: RuntimeObservationPublisher | undefined;
	private readonly createRevisionId: () => string;
	private readonly now: () => number;
	private readonly closeController: RetryableCloseController;
	private sequence = 0;
	private closed = false;

	constructor(options: RuntimeHostAgentBackendRegistryOptions = {}) {
		this.defaultBackend = options.defaultBackend;
		this.observations = options.observationPublisher;
		this.createRevisionId = options.createRevisionId ?? createRuntimeId;
		this.now = options.now ?? Date.now;
		this.closeController = new RetryableCloseController({ cleanup: () => this.disposeAll() });
	}

	upsert(candidate: RuntimeHostAgentBackendCandidate): RuntimeHostAgentBackendPublishResult {
		this.assertOpen();
		const prepared = validateCandidate(candidate);
		const existing = this.entries.get(prepared.agentId);
		if (existing && existing.sourceId !== prepared.source.id) {
			throw new RuntimeHostAgentBackendError(
				RUNTIME_HOST_AGENT_BACKEND_ERROR_CODES.SOURCE_CONFLICT,
				`Runtime Host Agent Backend ${prepared.agentId} is owned by source ${existing.sourceId}, not ${prepared.source.id}`,
			);
		}
		const generation = this.createGeneration(prepared);
		const previous = existing?.current;
		this.generations.set(generation.revision.id, generation);
		this.knownAgentIds.add(prepared.agentId);
		this.entries.set(prepared.agentId, {
			agentId: prepared.agentId,
			sourceId: prepared.source.id,
			state: "active",
			current: generation,
			lastRevisionId: generation.revision.id,
		});
		const retirement = previous ? this.retireGeneration(previous) : undefined;
		this.record(previous ? "replace" : "register", "completed", generation);
		return Object.freeze({
			status: previous ? "replaced" : "registered",
			revision: generation.revision,
			...(retirement ? { retirement } : {}),
		});
	}

	/** 保留 Source ownership 与 tombstone，但立即停止该 Agent 的新会话 admission。 */
	retire(agentId: string): RuntimeHostAgentBackendRetirement | undefined {
		this.assertOpen();
		const entry = this.entries.get(agentId);
		if (!entry || entry.state === "retired" || !entry.current) return undefined;
		entry.state = "retired";
		const generation = entry.current;
		entry.current = undefined;
		const retirement = this.retireGeneration(generation);
		this.record("retire", "completed", generation);
		return retirement;
	}

	/** 删除发现项；tombstone 仍阻止显式 Agent 请求回退到默认 Backend。 */
	remove(agentId: string, expectedRevisionId?: string): RuntimeHostAgentBackendRetirement | undefined {
		this.assertOpen();
		const entry = this.entries.get(agentId);
		if (!entry) return undefined;
		if (expectedRevisionId !== undefined && entry.current?.revision.id !== expectedRevisionId) return undefined;
		this.entries.delete(agentId);
		const generation = entry.current;
		if (!generation) return undefined;
		const retirement = this.retireGeneration(generation);
		this.record("remove", "completed", generation);
		return retirement;
	}

	snapshot(): RuntimeHostAgentBackendRegistrySnapshot {
		const entries = [...this.entries.values()]
			.map((entry) =>
				Object.freeze({
					agentId: entry.agentId,
					sourceId: entry.sourceId,
					state: entry.state,
					...(entry.current ? { currentRevisionId: entry.current.revision.id } : {}),
					lastRevisionId: entry.lastRevisionId,
				}),
			)
			.sort((left, right) => left.agentId.localeCompare(right.agentId));
		let activeLeaseCount = 0;
		let retiredGenerationCount = 0;
		for (const generation of this.generations.values()) {
			activeLeaseCount += generation.activeLeases;
			if (generation.retired) retiredGenerationCount += 1;
		}
		return Object.freeze({
			closed: this.closed,
			entries: Object.freeze(entries),
			generationCount: this.generations.size,
			retiredGenerationCount,
			activeLeaseCount,
			removedAgentCount: [...this.knownAgentIds].filter((agentId) => !this.entries.has(agentId)).length,
		});
	}

	async createAssembly(request: RuntimeSessionCreateRequest): Promise<RuntimeHostSessionAssembly> {
		this.assertOpen();
		const route = await this.acquireRoute(request);
		if (!route) {
			if (!this.defaultBackend) {
				const error = new RuntimeHostAgentBackendError(
					RUNTIME_HOST_AGENT_BACKEND_ERROR_CODES.NOT_FOUND,
					"No Runtime Host Session Backend accepts this request",
				);
				this.observations?.record(RUNTIME_HOST_AGENT_BACKEND_OBSERVATION, {
					operation: "route.acquire",
					phase: "failed",
					failure: runtimeObservationFailure(error),
				});
				throw error;
			}
			this.observations?.record(RUNTIME_HOST_AGENT_BACKEND_OBSERVATION, {
				operation: "route.acquire",
				phase: "completed",
				routeSource: "default",
			});
			try {
				return await this.defaultBackend.createAssembly(request);
			} catch (error) {
				this.observations?.record(RUNTIME_HOST_AGENT_BACKEND_OBSERVATION, {
					operation: "route.acquire",
					phase: "failed",
					routeSource: "default",
					failure: runtimeObservationFailure(error),
				});
				throw error;
			}
		}

		try {
			const assembly = await route.generation.backend.createAssembly(request);
			return wrapAssemblyLease(assembly, route);
		} catch (error) {
			this.record("route.acquire", "failed", route.generation, route.routeSource, error);
			try {
				await route.release();
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					"Runtime Host Agent Backend creation and lease rollback failed",
					{ cause: error },
				);
			}
			throw error;
		}
	}

	close(): Promise<void> {
		if (!this.closed) {
			this.closed = true;
			for (const entry of this.entries.values()) {
				entry.state = "retired";
				if (entry.current) {
					this.retireGeneration(entry.current);
					entry.current = undefined;
				}
			}
		}
		return this.closeController.run();
	}

	private async acquireRoute(request: RuntimeSessionCreateRequest): Promise<BackendLease | undefined> {
		const requestedAgentId = request.agent?.id;
		if (requestedAgentId) {
			const entry = this.entries.get(requestedAgentId);
			if (entry?.state === "active" && entry.current) {
				return this.acquireGeneration(entry.current, "agent");
			}
			if (entry || this.knownAgentIds.has(requestedAgentId)) {
				throw new RuntimeHostAgentBackendError(
					RUNTIME_HOST_AGENT_BACKEND_ERROR_CODES.UNAVAILABLE,
					`Runtime Host Agent Backend is unavailable: ${requestedAgentId}`,
				);
			}
			return undefined;
		}

		const sessionPath = request.sessionPath?.trim();
		if (!sessionPath) return undefined;
		return this.acquireCatalogRoute(sessionPath);
	}

	private async acquireCatalogRoute(sessionPath: string): Promise<BackendLease | undefined> {
		for (;;) {
			this.assertOpen();
			const candidates = [...this.entries.values()]
				.map((entry) => entry.current)
				.filter((generation): generation is BackendGeneration => generation !== undefined && !!generation.catalog);
			for (const generation of candidates) generation.activeLeases += 1;
			let claims: BackendGeneration[];
			try {
				const results = await Promise.all(
					candidates.map(async (generation) => ({
						generation,
						owns: await generation.catalog?.ownsSession(sessionPath),
					})),
				);
				claims = results.filter(({ owns }) => owns === true).map(({ generation }) => generation);
			} catch (error) {
				await this.releaseProbes(candidates);
				this.observations?.record(RUNTIME_HOST_AGENT_BACKEND_OBSERVATION, {
					operation: "route.acquire",
					phase: "failed",
					routeSource: "catalog",
					failure: runtimeObservationFailure(error),
				});
				throw error;
			}

			const stableClaims = claims.filter((generation) => {
				const entry = this.entries.get(generation.revision.agentId);
				return entry?.state === "active" && entry.current === generation;
			});
			const topologyChanged = candidates.some((generation) => {
				const entry = this.entries.get(generation.revision.agentId);
				return entry?.state !== "active" || entry.current !== generation;
			});
			if (topologyChanged) {
				await this.releaseProbes(candidates);
				continue;
			}
			if (stableClaims.length > 1) {
				await this.releaseProbes(candidates);
				const error = new RuntimeHostAgentBackendError(
					RUNTIME_HOST_AGENT_BACKEND_ERROR_CODES.AMBIGUOUS_SESSION,
					"Multiple Runtime Host Agent Backends claim the persisted Session",
				);
				this.record("route.acquire", "failed", stableClaims[0]!, "catalog", error);
				throw error;
			}
			const winner = stableClaims[0];
			await this.releaseProbes(candidates.filter((generation) => generation !== winner));
			if (!winner) return undefined;
			this.record("route.acquire", "completed", winner, "catalog");
			return this.createLease(winner, "catalog");
		}
	}

	private acquireGeneration(generation: BackendGeneration, routeSource: "agent" | "catalog"): BackendLease {
		generation.activeLeases += 1;
		this.record("route.acquire", "completed", generation, routeSource);
		return this.createLease(generation, routeSource);
	}

	private createLease(generation: BackendGeneration, routeSource: "agent" | "catalog"): BackendLease {
		let countReleased = false;
		let completed = false;
		return {
			generation,
			routeSource,
			release: async () => {
				if (completed) return;
				if (!countReleased) {
					countReleased = true;
					generation.activeLeases -= 1;
					if (generation.activeLeases === 0) {
						for (const resolve of generation.unusedWaiters.splice(0)) resolve();
					}
				}
				try {
					if (generation.retired) await this.disposeGenerationIfUnused(generation);
					completed = true;
					this.record("route.release", "completed", generation);
				} catch (error) {
					this.record("route.release", "failed", generation, undefined, error);
					throw error;
				}
			},
		};
	}

	private async releaseProbes(generations: readonly BackendGeneration[]): Promise<void> {
		for (const generation of generations) {
			generation.activeLeases -= 1;
			if (generation.activeLeases === 0) {
				for (const resolve of generation.unusedWaiters.splice(0)) resolve();
				if (generation.retired) await this.disposeGenerationIfUnused(generation);
			}
		}
	}

	private createGeneration(
		candidate: Required<Pick<RuntimeHostAgentBackendCandidate, "agentId" | "source" | "backend">> &
			Pick<RuntimeHostAgentBackendCandidate, "catalog" | "ownsBackend">,
	): BackendGeneration {
		this.sequence += 1;
		const revisionId = this.createRevisionId();
		if (!revisionId || revisionId.trim() !== revisionId || this.generations.has(revisionId)) {
			throw new RuntimeHostAgentBackendError(
				RUNTIME_HOST_AGENT_BACKEND_ERROR_CODES.INVALID_REGISTRATION,
				`Invalid or duplicate Runtime Host Agent Backend revision id: ${revisionId}`,
			);
		}
		const revision = Object.freeze({
			id: revisionId,
			sequence: this.sequence,
			agentId: candidate.agentId,
			source: candidate.source,
			registeredAt: this.now(),
		});
		let generation!: BackendGeneration;
		const closeController = new RetryableCloseController({ cleanup: () => this.disposeBackend(generation) });
		generation = {
			revision,
			backend: candidate.backend,
			catalog: candidate.catalog,
			ownsBackend: candidate.ownsBackend === true,
			unusedWaiters: [],
			activeLeases: 0,
			retired: false,
			closeController,
		};
		return generation;
	}

	private retireGeneration(generation: BackendGeneration): RuntimeHostAgentBackendRetirement {
		generation.retired = true;
		const retirement = Object.freeze({
			revision: generation.revision,
			dispose: async () => {
				await waitUntilUnused(generation);
				await generation.closeController.run();
			},
		});
		if (generation.activeLeases === 0) void retirement.dispose().catch(() => undefined);
		return retirement;
	}

	private disposeGenerationIfUnused(generation: BackendGeneration): Promise<void> {
		if (!generation.retired || generation.activeLeases > 0) return Promise.resolve();
		return generation.closeController.run();
	}

	private async disposeBackend(generation: BackendGeneration): Promise<void> {
		try {
			if (generation.ownsBackend) await generation.backend.dispose?.();
			this.generations.delete(generation.revision.id);
			this.record("backend.dispose", "completed", generation);
		} catch (error) {
			this.record("backend.dispose", "failed", generation, undefined, error);
			throw error;
		}
	}

	private async disposeAll(): Promise<void> {
		const results = await Promise.allSettled(
			[...this.generations.values()].map(async (generation) => {
				await waitUntilUnused(generation);
				await generation.closeController.run();
			}),
		);
		const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
		if (errors.length === 1) throw errors[0];
		if (errors.length > 1) {
			throw new AggregateError(errors, "Failed to close Runtime Host Agent Backends");
		}
		this.entries.clear();
	}

	private record(
		operation: RuntimeHostAgentBackendOperation,
		phase: "completed" | "failed",
		generation: BackendGeneration,
		routeSource?: "agent" | "catalog",
		error?: unknown,
	): void {
		this.observations?.record(
			RUNTIME_HOST_AGENT_BACKEND_OBSERVATION,
			{
				operation,
				phase,
				backendRevisionId: generation.revision.id,
				sourceId: generation.revision.source.id,
				sourceRevision: generation.revision.source.revision,
				...(routeSource ? { routeSource } : {}),
				activeLeaseCount: generation.activeLeases,
				...(error !== undefined ? { failure: runtimeObservationFailure(error) } : {}),
			},
			{ agentId: generation.revision.agentId },
		);
	}

	private assertOpen(): void {
		if (this.closed) {
			throw new RuntimeHostAgentBackendError(
				RUNTIME_HOST_AGENT_BACKEND_ERROR_CODES.CLOSED,
				"Runtime Host Agent Backend registry is closed",
			);
		}
	}
}

function validateCandidate(candidate: RuntimeHostAgentBackendCandidate) {
	assertTrimmed(candidate.agentId, "Runtime Host Agent Backend agentId");
	assertTrimmed(candidate.source.id, "Runtime Host Agent Backend source id");
	assertTrimmed(candidate.source.revision, "Runtime Host Agent Backend source revision");
	if (!candidate.backend || typeof candidate.backend.createAssembly !== "function") {
		throw new RuntimeHostAgentBackendError(
			RUNTIME_HOST_AGENT_BACKEND_ERROR_CODES.INVALID_REGISTRATION,
			"Runtime Host Agent Backend must implement createAssembly()",
		);
	}
	if (candidate.catalog && typeof candidate.catalog.ownsSession !== "function") {
		throw new RuntimeHostAgentBackendError(
			RUNTIME_HOST_AGENT_BACKEND_ERROR_CODES.INVALID_REGISTRATION,
			"Runtime Host Agent Backend catalog must implement ownsSession()",
		);
	}
	return Object.freeze({ ...candidate });
}

function assertTrimmed(value: string, label: string): void {
	if (!value || value.trim() !== value) {
		throw new RuntimeHostAgentBackendError(
			RUNTIME_HOST_AGENT_BACKEND_ERROR_CODES.INVALID_REGISTRATION,
			`${label} must be a non-empty trimmed string`,
		);
	}
}

function waitUntilUnused(generation: BackendGeneration): Promise<void> {
	if (generation.activeLeases === 0) return Promise.resolve();
	return new Promise((resolve) => generation.unusedWaiters.push(resolve));
}

function wrapAssemblyLease(assembly: RuntimeHostSessionAssembly, lease: BackendLease): RuntimeHostSessionAssembly {
	const lifecycle = assembly.lifecycle;
	let lifecycleDisposed = false;
	return {
		...assembly,
		lifecycle: {
			...lifecycle,
			dispose: async () => {
				if (!lifecycleDisposed) {
					await lifecycle.dispose();
					lifecycleDisposed = true;
				}
				await lease.release();
			},
		},
	};
}
