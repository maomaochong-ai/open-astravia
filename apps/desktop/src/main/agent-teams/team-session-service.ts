import {
	type AgentTeamDocument,
	type AgentTeamExtensionRegistry,
	createTeamCancelTaskTool,
	createTeamContinueTaskTool,
	createTeamDelegateTaskTool,
	createTeamGetTaskTool,
	createTeamListMembersTool,
	createTeamObservationPublisher,
	createTeamReadSharedHistoryTool,
	createTeamRetryTaskTool,
	createTeamSendMessageTool,
	createTeamWaitTasksTool,
	DEFAULT_AGENT_TEAM_EXTENSIONS,
	parseTeamSessionDocument,
	type SendTeamMessageInput,
	type TeamExternalConditionChange,
	type TeamMemberTurnAttemptMode,
	type TeamMessageControlPort,
	type TeamObservationPublisher,
	type TeamSessionDocument,
	type TeamSessionListItem,
	type TeamSessionSnapshot,
	type TeamSessionStateRecord,
	type TeamSharedHistoryPort,
	type TeamTaskControlPort,
	type UpdateTeamSessionModelSettingsInput,
} from "@vetta/agent-team";
import type { CodingAgentRuntimeToolRegistration } from "@vetta/coding-agent/runtime";
import type { ConversationDocument, RuntimeHost, SessionExecutionMode } from "@vetta/runtime-core";
import type {
	DesktopTeamConversationDisplay,
	DesktopTeamSessionStreamEvent,
} from "../../preload/api-types/team-conversation-display.js";
import {
	type ConversationOwnershipCatalogPort,
	conversationOwnershipCatalog,
} from "../conversations/conversation-ownership-catalog.js";
import { readDesktopConfig } from "../ipc/fs.js";
import { getAppLogger } from "../logger.js";
import { getSharedRuntime } from "../runtime.js";
import { assertSandboxAvailableForMode } from "../sandbox/capability.js";
import { agentTeamExtensionHost } from "./agent-team-extension-host.js";
import { agentTeamStore } from "./agent-team-store.js";
import { type TeamCollaborationState, TeamCollaborationStore } from "./team-collaboration-store.js";
import { agentTeamExternalConditionChanges } from "./team-external-condition-channel.js";
import {
	ensureTeamConversationBinding,
	migrateLegacyTeamSessionEvents,
	type TeamLegacySessionMigrationPort,
} from "./team-legacy-session-migration.js";
import { TeamMemberAttemptRunner } from "./team-member-attempt-runner.js";
import { ensureLegacyAgentTeamOwnershipCatalog } from "./team-ownership-backfill.js";
import { TeamPublicationWorkflow } from "./team-publication-workflow.js";
import { TeamRuntimeManager } from "./team-runtime-manager.js";
import { TeamSessionDisplayService } from "./team-session-display-service.js";
import { TeamSessionEventHub } from "./team-session-event-hub.js";
import { readTeamConversationDocument, resolveTeamConversationSessionId } from "./team-session-file-reader.js";
import { type LegacyTeamSessionRepository, legacyTeamSessionRepository } from "./team-session-repository.js";
import { TeamSessionStateRepository } from "./team-session-state-repository.js";
import { TeamSharedContextService } from "./team-shared-context-service.js";
import { TeamTurnCoordinator } from "./team-turn-coordinator.js";

const log = getAppLogger("agent-team-sessions");

export interface AgentTeamSessionServiceOptions {
	readonly runtime?: RuntimeHost;
	readonly extensions?: AgentTeamExtensionRegistry;
	readonly repository?: LegacyTeamSessionRepository;
	readonly readDocument?: () => Promise<AgentTeamDocument>;
	readonly ownershipCatalog?: ConversationOwnershipCatalogPort;
	readonly externalConditionChanges?: {
		subscribe(listener: (change: TeamExternalConditionChange) => void): () => void;
	};
	readonly sharedContextCompaction?: {
		readonly maxCharacters: number;
		readonly keepRecentCharacters: number;
	};
}

export interface TeamSessionSubscription {
	readonly unsubscribe: () => void;
	readonly snapshot?: Extract<DesktopTeamSessionStreamEvent, { type: "session-snapshot" }>;
}

export class AgentTeamSessionService {
	private runtime: RuntimeHost | undefined;
	/** Known coordination paths let the bootstrap reader start restoration without blocking IPC. */
	private readonly warmingSessions = new Map<string, Promise<unknown>>();
	private readonly extensions: AgentTeamExtensionRegistry;
	private readonly repository: LegacyTeamSessionRepository;
	private readonly readDocument: () => Promise<AgentTeamDocument>;
	private readonly ownershipCatalog: ConversationOwnershipCatalogPort | undefined;
	private readonly collaborationStore: TeamCollaborationStore;
	private readonly sessionState: TeamSessionStateRepository;
	private readonly turnCoordinator: TeamTurnCoordinator;
	private readonly displayService: TeamSessionDisplayService;
	private readonly eventHub: TeamSessionEventHub;
	private readonly runtimeManager: TeamRuntimeManager;
	private readonly sharedContextService: TeamSharedContextService;
	private readonly publicationWorkflow: TeamPublicationWorkflow;
	private readonly memberAttemptRunner: TeamMemberAttemptRunner;

	constructor(options: AgentTeamSessionServiceOptions = {}) {
		this.runtime = options.runtime;
		this.extensions = options.extensions ?? DEFAULT_AGENT_TEAM_EXTENSIONS;
		this.repository = options.repository ?? legacyTeamSessionRepository;
		this.readDocument =
			options.readDocument ?? (() => Promise.reject(new Error("Agent Team configuration reader is unavailable")));
		this.ownershipCatalog = options.ownershipCatalog;
		const sharedContextCompaction = options.sharedContextCompaction ?? {
			maxCharacters: 48_000,
			keepRecentCharacters: 16_000,
		};
		this.collaborationStore = new TeamCollaborationStore({
			readSessionDocument: (sessionId) => this.getRuntime().readSessionDocument(sessionId),
			appendSessionMetadataEntry: (sessionId, customType, data) =>
				this.getRuntime().appendSessionMetadataEntry(sessionId, customType, data),
		});
		this.sessionState = new TeamSessionStateRepository({
			runtime: () => this.getRuntime(),
			...(this.ownershipCatalog ? { ownershipCatalog: this.ownershipCatalog } : {}),
		});
		this.displayService = new TeamSessionDisplayService(() => this.getRuntime(), this.collaborationStore);
		this.eventHub = new TeamSessionEventHub({
			runtime: () => this.getRuntime(),
			getSession: (sessionId) => this.sessionState.get(sessionId),
			observe: (session) => this.observations(session),
		});
		this.turnCoordinator = new TeamTurnCoordinator({
			runtime: () => this.getRuntime(),
			extensions: this.extensions,
			collaborationStore: this.collaborationStore,
			sessionState: this.sessionState,
			eventHub: this.eventHub,
			readSession: (sessionId) => this.read(sessionId),
			readDocument: () => this.readDocument(),
			observations: (session) => this.observations(session),
			publishSessionUpdated: (session) => this.publishSessionUpdated(session),
		});
		this.runtimeManager = new TeamRuntimeManager({
			runtime: () => this.getRuntime(),
			createTeamToolRegistrations: (teamSessionId) => this.createTeamToolRegistrations(teamSessionId),
			sessionState: this.sessionState,
			collaborationStore: this.collaborationStore,
		});
		this.sharedContextService = new TeamSharedContextService({
			runtime: () => this.getRuntime(),
			collaborationStore: this.collaborationStore,
			sessionState: this.sessionState,
			extensions: this.extensions,
			readSession: (teamSessionId) => this.read(teamSessionId),
			observations: (session) => this.observations(session),
			compaction: sharedContextCompaction,
		});
		this.publicationWorkflow = new TeamPublicationWorkflow({
			runtime: () => this.getRuntime(),
			collaborationStore: this.collaborationStore,
			sessionState: this.sessionState,
			observations: (session) => this.observations(session),
		});
		this.memberAttemptRunner = new TeamMemberAttemptRunner({
			extensions: this.extensions,
			collaborationStore: this.collaborationStore,
			sharedContextService: this.sharedContextService,
			publicationWorkflow: this.publicationWorkflow,
			eventHub: this.eventHub,
			runtime: () => this.getRuntime(),
			readDocument: () => this.readDocument(),
			runtimeManager: this.runtimeManager,
			sessionState: this.sessionState,
			settleAttempt: (session, workItem, attempt, terminal, resultMessageId) =>
				this.turnCoordinator.settleMemberAttempt(session, workItem, attempt, terminal, resultMessageId),
			observations: (session) => this.observations(session),
			publishSessionUpdated: (session) => this.publishSessionUpdated(session),
		});
		this.turnCoordinator.setAttemptRunner(this.memberAttemptRunner);
		options.externalConditionChanges?.subscribe((change) => {
			void this.notifyExternalConditionChanged(change).catch((error: unknown) => {
				log.warn("Agent Team external-condition recovery failed", {
					category: change.category,
					provider: change.provider,
					errorName: error instanceof Error ? error.name : "UnknownError",
				});
			});
		});
	}

	taskControls(sessionId: string): TeamTaskControlPort {
		return this.turnCoordinator.taskControls(sessionId);
	}

	sharedHistoryControls(sessionId: string): TeamSharedHistoryPort {
		return {
			readSharedHistory: (input) => this.sharedContextService.readSharedHistory(sessionId, input),
		};
	}

	messageControls(sessionId: string): TeamMessageControlPort {
		return this.turnCoordinator.messageControls(sessionId);
	}

	private getRuntime(): RuntimeHost {
		this.runtime ??= getSharedRuntime();
		return this.runtime;
	}

	private observations(session: TeamSessionDocument): TeamObservationPublisher | undefined {
		const coordinationConversationId = session.coordinationRuntime?.sessionId;
		if (!coordinationConversationId) return undefined;
		const runtime = this.getRuntime();
		if (typeof runtime.createObservationScope !== "function") return undefined;
		return createTeamObservationPublisher(
			runtime.createObservationScope({ sessionId: coordinationConversationId }),
			coordinationConversationId,
		);
	}

	private legacyMigrationPort(): TeamLegacySessionMigrationPort {
		return {
			readDocument: (sessionId) => this.getRuntime().readSessionDocument(sessionId),
			appendMessage: (sessionId, message) => this.getRuntime().appendConversationMessage(sessionId, message),
			appendMetadata: (sessionId, customType, data) =>
				this.getRuntime().appendSessionMetadataEntry(sessionId, customType, data),
		};
	}

	snapshot(session: TeamSessionDocument, coordinationDocument?: ConversationDocument): TeamSessionSnapshot {
		return this.displayService.snapshot(session, coordinationDocument);
	}

	displayProjection(session: TeamSessionDocument): Promise<DesktopTeamConversationDisplay> {
		return this.displayService.displayProjection(session);
	}

	async readSnapshot(id: string, coordinationSessionPath?: string): Promise<TeamSessionSnapshot> {
		const cached = this.sessionState.get(id);
		if (cached) return this.snapshot(cached);
		const path = coordinationSessionPath ?? this.sessionState.coordinationPath(id);
		if (!path) return this.snapshot(await this.read(id));
		this.sessionState.rememberCoordinationPath(id, path);
		const conversationSessionId = resolveTeamConversationSessionId(path);
		const document = await readTeamConversationDocument(conversationSessionId, path);
		const session = readTeamSessionStateFromDocument(id, document);
		const snapshot = this.snapshot(session, document);
		this.startSessionWarming(id, path);
		return snapshot;
	}

	private startSessionWarming(id: string, coordinationSessionPath: string): void {
		if (this.sessionState.get(id) !== undefined || this.warmingSessions.has(id)) return;
		const warming = this.read(id, coordinationSessionPath).catch((error: unknown) => {
			log.error("failed to warm team session after bootstrap", { teamSessionId: id, error: errorMessage(error) });
			throw error;
		});
		this.warmingSessions.set(id, warming);
		void warming.then(
			() => this.warmingSessions.delete(id),
			() => this.warmingSessions.delete(id),
		);
	}

	subscribe(sessionId: string, handler: (event: DesktopTeamSessionStreamEvent) => void): TeamSessionSubscription {
		const unsubscribe = this.eventHub.addSubscriber(sessionId, handler);
		const session = this.sessionState.get(sessionId);
		if (!session) {
			const path = this.sessionState.coordinationPath(sessionId);
			if (path) {
				this.startSessionWarming(sessionId, path);
				const warming = this.warmingSessions.get(sessionId);
				if (warming) {
					void warming.then(
						() => {
							const current = this.sessionState.get(sessionId);
							if (!current || !this.eventHub.hasSubscribers(sessionId)) return;
							this.eventHub.attach(current);
							this.publishSessionUpdated(current);
						},
						() => undefined,
					);
				}
			}
		}
		const snapshot = session
			? ({
					type: "session-snapshot",
					teamSessionId: sessionId,
					snapshot: this.snapshot(session),
					activeMessageEvents: this.eventHub.activeMessageEvents(sessionId),
				} satisfies Extract<DesktopTeamSessionStreamEvent, { type: "session-snapshot" }>)
			: undefined;
		if (session) this.eventHub.attach(session);
		return {
			...(snapshot ? { snapshot } : {}),
			unsubscribe,
		};
	}

	private publishSessionUpdated(session: TeamSessionDocument): void {
		this.eventHub.publish({
			type: "session-updated",
			teamSessionId: session.id,
			snapshot: this.snapshot(session),
		});
	}

	async create(
		team: AgentTeamDocument["teams"][number],
		document: AgentTeamDocument,
		cwd: string,
	): Promise<TeamSessionDocument> {
		const id = crypto.randomUUID();
		const now = Date.now();
		const executionMode = (await readDesktopConfig()).defaultExecutionMode ?? "full-access";
		const memberRuntime: Record<string, TeamSessionDocument["memberRuntime"][string]> = {};
		let coordinationRuntime: TeamSessionDocument["coordinationRuntime"];

		try {
			await assertSandboxAvailableForMode(executionMode, async () => executionMode);
			coordinationRuntime = await this.runtimeManager.createCoordinationRuntime(cwd, undefined, id, executionMode);
			for (const member of team.members) {
				memberRuntime[member.id] = await this.runtimeManager.createMemberRuntime(
					id,
					member,
					team,
					document,
					cwd,
					executionMode,
				);
			}
		} catch (error) {
			await Promise.allSettled(
				[
					...Object.values(memberRuntime).map((runtimeState) => runtimeState.sessionId),
					...(coordinationRuntime ? [coordinationRuntime.sessionId] : []),
				].map((sessionId) => this.getRuntime().disposeSession(sessionId)),
			);
			log.error("team session creation rolled back", {
				teamId: team.id,
				teamSessionId: id,
				createdMemberCount: Object.keys(memberRuntime).length,
				error: errorMessage(error),
			});
			throw error;
		}

		const session: TeamSessionDocument = {
			schemaVersion: 1,
			revision: 0,
			id,
			teamId: team.id,
			workspaceId: `agent-team:${team.id}`,
			executionMode,
			teamRevision: team.revision,
			name: team.name,
			cwd,
			orchestrationPolicyId: team.orchestrationPolicyId,
			contextPolicyId: team.contextPolicyId,
			leaderMemberId: team.leaderMemberId,
			activeMemberIds: team.members.map((member) => member.id),
			memberHandles: Object.fromEntries(team.members.map((member) => [member.id, member.handle])),
			createdAt: now,
			updatedAt: now,
			coordinationRuntime,
			runtimeStatus: "ready",
			events: [],
			memberRuntime,
		};

		try {
			await ensureTeamConversationBinding(session, this.legacyMigrationPort());
			await this.persist(session);
		} catch (error) {
			await Promise.allSettled(
				[
					...Object.values(memberRuntime).map((runtimeState) => runtimeState.sessionId),
					coordinationRuntime.sessionId,
				].map((sessionId) => this.getRuntime().disposeSession(sessionId)),
			);
			throw error;
		}
		this.sessionState.set(session);
		log.info("team session created", {
			teamId: team.id,
			teamSessionId: id,
			memberCount: team.members.length,
		});
		this.observations(session)?.publishLifecycle({
			teamId: session.teamId,
			coordinationConversationId: coordinationRuntime.sessionId,
			phase: "create",
			teamRevision: team.revision,
			memberCount: team.members.length,
		});
		return session;
	}

	/**
	 * Creates the durable coordination record without blocking the first paint on
	 * member runtimes. Member runtimes are warmed eagerly by `warmup` afterwards.
	 */
	async createRecord(
		team: AgentTeamDocument["teams"][number],
		document: AgentTeamDocument,
		cwd: string,
	): Promise<TeamSessionDocument> {
		const id = crypto.randomUUID();
		const now = Date.now();
		const executionMode = (await readDesktopConfig()).defaultExecutionMode ?? "full-access";
		await assertSandboxAvailableForMode(executionMode, async () => executionMode);
		const coordinationRuntime = await this.runtimeManager.createCoordinationRuntime(
			cwd,
			undefined,
			id,
			executionMode,
		);
		const session: TeamSessionDocument = {
			schemaVersion: 1,
			revision: 0,
			id,
			teamId: team.id,
			workspaceId: `agent-team:${team.id}`,
			executionMode,
			teamRevision: team.revision,
			name: team.name,
			cwd,
			orchestrationPolicyId: team.orchestrationPolicyId,
			contextPolicyId: team.contextPolicyId,
			leaderMemberId: team.leaderMemberId,
			activeMemberIds: team.members.map((member) => member.id),
			memberHandles: Object.fromEntries(team.members.map((member) => [member.id, member.handle])),
			createdAt: now,
			updatedAt: now,
			coordinationRuntime,
			runtimeStatus: "preparing",
			events: [],
			memberRuntime: {},
		};
		try {
			await ensureTeamConversationBinding(session, this.legacyMigrationPort());
			await this.persist(session);
			this.sessionState.set(session);
			void this.warmup(id, team, document).catch((error: unknown) => {
				log.warn("team runtime warmup failed", { teamId: team.id, teamSessionId: id, error: errorMessage(error) });
			});
			log.info("team session record created", { teamId: team.id, teamSessionId: id });
			return session;
		} catch (error) {
			await this.getRuntime()
				.disposeSession(coordinationRuntime.sessionId)
				.catch(() => undefined);
			throw error;
		}
	}

	/** Eager background preparation: leader first, remaining members in parallel. */
	async warmup(
		sessionId: string,
		team: AgentTeamDocument["teams"][number],
		document: AgentTeamDocument,
	): Promise<void> {
		const existing = this.warmingSessions.get(`runtime:${sessionId}`);
		if (existing) {
			await existing;
			return;
		}
		const warming = this.warmupInternal(sessionId, team, document);
		this.warmingSessions.set(`runtime:${sessionId}`, warming);
		try {
			await warming;
		} catch (error) {
			await this.sessionState.coordinateLoaded(sessionId, async (session) => {
				const next: TeamSessionDocument = {
					...session,
					revision: session.revision + 1,
					updatedAt: Date.now(),
					runtimeStatus: "failed",
				};
				await this.persist(next);
				this.publishSessionUpdated(next);
			});
			throw error;
		} finally {
			if (this.warmingSessions.get(`runtime:${sessionId}`) === warming)
				this.warmingSessions.delete(`runtime:${sessionId}`);
		}
	}

	private async warmupInternal(
		sessionId: string,
		team: AgentTeamDocument["teams"][number],
		document: AgentTeamDocument,
	): Promise<void> {
		const leader = team.members.find((member) => member.id === team.leaderMemberId);
		if (!leader) throw new Error(`Team leader not found: ${team.leaderMemberId}`);
		const leaderWarming = this.ensureMemberRuntime(sessionId, leader, team, document);
		// Give the leader preparation lane the first scheduling opportunity, then
		// warm the rest eagerly instead of waiting for the leader to become ready.
		await Promise.resolve();
		const others = team.members.filter((member) => member.id !== leader.id);
		const results = await Promise.allSettled([
			leaderWarming,
			...others.map((member) => this.ensureMemberRuntime(sessionId, member, team, document)),
		]);
		const failed = results.some((result) => result.status === "rejected");
		await this.sessionState.coordinateLoaded(sessionId, async (session) => {
			const next: TeamSessionDocument = {
				...session,
				revision: session.revision + 1,
				updatedAt: Date.now(),
				runtimeStatus: failed ? "failed" : "ready",
			};
			await this.persist(next);
			this.publishSessionUpdated(next);
		});
	}

	private async ensureMemberRuntime(
		sessionId: string,
		member: AgentTeamDocument["teams"][number]["members"][number],
		team: AgentTeamDocument["teams"][number],
		document: AgentTeamDocument,
	): Promise<void> {
		const current = this.sessionState.get(sessionId);
		if (!current) throw new Error(`Team session is not loaded: ${sessionId}`);
		if (current.memberRuntime[member.id]) return;
		// Runtime construction may load providers, plugins and histories. Keep it
		// outside the session transaction so coordination messages remain writable.
		const runtimeState = await this.runtimeManager.createMemberRuntime(
			sessionId,
			member,
			team,
			document,
			current.cwd,
			current.executionMode ?? "full-access",
		);
		let adopted = false;
		try {
			await this.sessionState.coordinateLoaded(sessionId, async (session) => {
				if (session.memberRuntime[member.id]) return;
				const activeMemberIds = session.activeMemberIds ?? Object.keys(session.memberRuntime);
				if (!activeMemberIds.includes(member.id)) return;
				if (session.executionMode && session.executionMode !== current.executionMode) {
					await this.getRuntime().setExecutionMode(runtimeState.sessionId, session.executionMode);
				}
				const next: TeamSessionDocument = {
					...session,
					revision: session.revision + 1,
					updatedAt: Date.now(),
					memberRuntime: { ...session.memberRuntime, [member.id]: runtimeState },
				};
				await ensureTeamConversationBinding(next, this.legacyMigrationPort());
				await this.persist(next);
				adopted = true;
				this.publishSessionUpdated(next);
			});
		} finally {
			if (!adopted) await this.getRuntime().disposeSession(runtimeState.sessionId);
		}
	}

	async listSessions(teamId: string): Promise<readonly TeamSessionListItem[]> {
		if (!this.ownershipCatalog) return [];
		await ensureLegacyAgentTeamOwnershipCatalog(this.repository, this.ownershipCatalog);
		const records = await this.ownershipCatalog.listByTeam(teamId);
		return records
			.filter((record) => record.owner.role === "coordination")
			.map((record) => ({
				id: record.owner.teamSessionId,
				coordinationSessionPath: record.sessionPath,
				title: record.title,
				createdAt: record.createdAt,
				updatedAt: record.updatedAt,
			}))
			.sort((left, right) => right.updatedAt - left.updatedAt);
	}

	async updateModelSettings(id: string, settings: UpdateTeamSessionModelSettingsInput): Promise<TeamSessionDocument> {
		return this.coordinate(id, async (session) => {
			const next: TeamSessionDocument = {
				...session,
				modelSettings: { ...settings },
				revision: session.revision + 1,
				updatedAt: Date.now(),
			};
			await this.persist(next);
			this.publishSessionUpdated(next);
			return next;
		});
	}

	async setExecutionMode(id: string, mode: SessionExecutionMode): Promise<TeamSessionDocument> {
		await assertSandboxAvailableForMode(mode, async () => mode);
		return this.coordinate(id, async (session) => {
			if (session.executionMode === mode) return session;
			const runtimeIds = [
				...(session.coordinationRuntime ? [session.coordinationRuntime.sessionId] : []),
				...Object.values(session.memberRuntime).map((runtime) => runtime.sessionId),
			];
			await Promise.all(runtimeIds.map((runtimeId) => this.getRuntime().setExecutionMode(runtimeId, mode)));
			const next: TeamSessionDocument = {
				...session,
				executionMode: mode,
				revision: session.revision + 1,
				updatedAt: Date.now(),
			};
			await this.persist(next);
			this.publishSessionUpdated(next);
			return next;
		});
	}

	async read(id: string, coordinationSessionPath?: string): Promise<TeamSessionDocument> {
		if (coordinationSessionPath) this.sessionState.rememberCoordinationPath(id, coordinationSessionPath);
		return this.sessionState.coordinate(
			id,
			() => this.readInternal(id, coordinationSessionPath ?? this.sessionState.coordinationPath(id)),
			async (session) => {
				await this.registerSessionOwnership(session);
				return session;
			},
		);
	}

	private async readInternal(id: string, coordinationSessionPath?: string): Promise<TeamSessionDocument> {
		const cached = this.sessionState.get(id);
		if (cached) {
			const reconciled = await this.reconcileTeamRoster(cached, await this.readDocument());
			return this.migrateLoadedSession(reconciled);
		}

		try {
			const persisted = coordinationSessionPath
				? await this.readConversationSessionState(id, coordinationSessionPath)
				: await this.repository.read(id);
			const document = await this.readDocument();
			const team = document.teams.find((candidate) => candidate.id === persisted.teamId);
			if (!team) throw new Error(`Agent team not found: ${persisted.teamId}`);
			const desiredMemberIds = new Set(team.members.map((member) => member.id));
			const prepared: TeamSessionDocument = {
				...persisted,
				workspaceId: persisted.workspaceId ?? `agent-team:${persisted.teamId}`,
				memberRuntime: Object.fromEntries(
					Object.entries(persisted.memberRuntime).filter(([memberId]) => desiredMemberIds.has(memberId)),
				),
			};
			const restored = await this.runtimeManager.restoreMembers(prepared, document);
			const coordinated = await this.migrateLoadedSession(
				await this.runtimeManager.ensureCoordinationRuntime(restored),
			);
			if (coordinated.coordinationRuntime && coordinated.executionMode) {
				await this.getRuntime().setExecutionMode(
					coordinated.coordinationRuntime.sessionId,
					coordinated.executionMode,
				);
			}
			this.sessionState.set(coordinated);
			const reconciled = await this.migrateLoadedSession(await this.reconcileTeamRoster(coordinated, document));
			this.sessionState.set(reconciled);
			await this.recoverRestoredSession(reconciled);
			return this.sessionState.get(id) ?? reconciled;
		} catch (error) {
			log.error("failed to load team session", { teamSessionId: id, error: errorMessage(error) });
			throw new Error(`Team session could not be loaded: ${id}`, { cause: error });
		}
	}

	private async readConversationSessionState(id: string, sessionPath: string): Promise<TeamSessionDocument> {
		const coordination = await this.runtimeManager.createCoordinationRuntime(
			process.cwd(),
			sessionPath,
			id,
			"full-access",
		);
		const document = this.getRuntime().readSessionDocument(coordination.sessionId);
		for (let index = document.entries.length - 1; index >= 0; index -= 1) {
			const entry = document.entries[index];
			if (entry?.type !== "custom" || entry.customType !== "agent-team.session-state.v1") continue;
			if (!isTeamSessionStateRecord(entry.data)) continue;
			const session = parseTeamSessionDocument(entry.data.session);
			if (session.id !== id) throw new Error("Team coordination Conversation belongs to another session");
			if (
				session.coordinationRuntime?.sessionId !== coordination.sessionId ||
				session.coordinationRuntime.sessionPath !== coordination.sessionPath
			) {
				throw new Error("Team coordination Conversation binding changed");
			}
			return session;
		}
		throw new Error(`Team session state is missing from coordination Conversation: ${id}`);
	}

	private async migrateLoadedSession(session: TeamSessionDocument): Promise<TeamSessionDocument> {
		const migrated = await migrateLegacyTeamSessionEvents(session, this.legacyMigrationPort());
		if (!migrated.migrated) return migrated.session;
		await this.persist(migrated.session);
		return migrated.session;
	}

	private async recoverRestoredSession(session: TeamSessionDocument): Promise<void> {
		await this.publicationWorkflow.recover(session);
		const current = this.sessionState.get(session.id) ?? session;
		await this.turnCoordinator.recoverSession(current);
	}
	private async reconcileTeamRoster(
		session: TeamSessionDocument,
		document: AgentTeamDocument,
	): Promise<TeamSessionDocument> {
		const team = document.teams.find((candidate) => candidate.id === session.teamId);
		if (!team) throw new Error(`Agent team not found: ${session.teamId}`);
		const desiredIds = team.members.map((member) => member.id);
		const currentIds = session.activeMemberIds ?? Object.keys(session.memberRuntime);
		const handlesChanged = team.members.some((member) => session.memberHandles[member.id] !== member.handle);
		if (
			session.teamRevision === team.revision &&
			session.leaderMemberId === team.leaderMemberId &&
			sameMemberIds(currentIds, desiredIds) &&
			!handlesChanged
		) {
			return session;
		}
		if (this.turnCoordinator.hasPending(session.id)) {
			throw new Error("Team members cannot be refreshed while a request is running");
		}

		const desiredIdSet = new Set(desiredIds);
		const nextRuntime = Object.fromEntries(
			Object.entries(session.memberRuntime).filter(([memberId]) => desiredIdSet.has(memberId)),
		);
		const createdRuntimeIds: string[] = [];
		try {
			for (const member of team.members) {
				if (nextRuntime[member.id]) continue;
				const runtimeState = await this.runtimeManager.createMemberRuntime(
					session.id,
					member,
					team,
					document,
					session.cwd,
					session.executionMode ?? "full-access",
				);
				nextRuntime[member.id] = runtimeState;
				createdRuntimeIds.push(runtimeState.sessionId);
			}
			const next: TeamSessionDocument = {
				...session,
				revision: session.revision + 1,
				teamRevision: team.revision,
				name: team.name,
				orchestrationPolicyId: team.orchestrationPolicyId,
				contextPolicyId: team.contextPolicyId,
				leaderMemberId: team.leaderMemberId,
				activeMemberIds: desiredIds,
				memberHandles: {
					...session.memberHandles,
					...Object.fromEntries(team.members.map((member) => [member.id, member.handle])),
				},
				memberRuntime: nextRuntime,
				updatedAt: Date.now(),
			};
			await this.persist(next);
			for (const [memberId, runtimeState] of Object.entries(session.memberRuntime)) {
				if (desiredIdSet.has(memberId)) continue;
				this.eventHub.detach(runtimeState.sessionId);
				void this.getRuntime()
					.disposeSession(runtimeState.sessionId)
					.catch((error: unknown) => {
						log.warn("failed to dispose removed team member runtime", {
							teamSessionId: session.id,
							memberId,
							error: errorMessage(error),
						});
					});
			}
			this.eventHub.attach(next);
			this.publishSessionUpdated(next);
			return next;
		} catch (error) {
			await Promise.allSettled(createdRuntimeIds.map((runtimeId) => this.getRuntime().disposeSession(runtimeId)));
			throw error;
		}
	}

	send(sessionId: string, input: SendTeamMessageInput): Promise<TeamSessionDocument> {
		return this.turnCoordinator.send(sessionId, input);
	}

	abort(sessionId: string): Promise<void> {
		return this.turnCoordinator.abort(sessionId);
	}

	readCollaborationState(sessionId: string): Promise<TeamCollaborationState> {
		return this.turnCoordinator.readCollaborationState(sessionId);
	}

	notifyExternalConditionChanged(change: TeamExternalConditionChange): Promise<number> {
		return this.turnCoordinator.notifyExternalConditionChanged(change);
	}

	recoverWorkItem(
		sessionId: string,
		workItemId: string,
		mode: Extract<TeamMemberTurnAttemptMode, "continue" | "retry" | "recovery">,
	): Promise<TeamSessionDocument> {
		return this.turnCoordinator.recoverWorkItem(sessionId, workItemId, mode);
	}

	private createListMembersRegistration(teamSessionId: string) {
		const tool = createTeamListMembersTool({
			listMembers: ({ sourceRuntimeSessionId }) =>
				this.turnCoordinator.listMembers(teamSessionId, sourceRuntimeSessionId),
		});
		return {
			tool,
			scopeUse: ["project", "conversation"] as const,
			category: "agent-control" as const,
			modelOrder: 2430,
		};
	}

	private createTeamToolRegistrations(teamSessionId: string): readonly CodingAgentRuntimeToolRegistration[] {
		const port = this.taskControls(teamSessionId);
		const tools = [
			createTeamDelegateTaskTool(port),
			createTeamGetTaskTool(port),
			createTeamWaitTasksTool(port),
			createTeamContinueTaskTool(port),
			createTeamRetryTaskTool(port),
			createTeamCancelTaskTool(port),
			createTeamSendMessageTool(this.messageControls(teamSessionId)),
			createTeamReadSharedHistoryTool(this.sharedHistoryControls(teamSessionId)),
		];
		return [
			this.createListMembersRegistration(teamSessionId),
			...tools.map((tool, index) => ({
				tool,
				scopeUse: ["project", "conversation"] as const,
				category: "agent-control" as const,
				modelOrder: 2450 + index,
			})),
		];
	}

	private async persist(session: TeamSessionDocument): Promise<void> {
		await this.sessionState.persist(session);
	}

	private registerSessionOwnership(session: TeamSessionDocument): Promise<void> {
		return this.sessionState.registerOwnership(session);
	}

	/** Re-read inside the lane; callers must not return a document derived from a stale snapshot. */
	private coordinate<T>(sessionId: string, operation: (session: TeamSessionDocument) => Promise<T>): Promise<T> {
		return this.sessionState.coordinate(sessionId, () => this.readInternal(sessionId), operation);
	}
}

export const agentTeamSessionService = new AgentTeamSessionService({
	extensions: agentTeamExtensionHost,
	readDocument: () => agentTeamStore.read(),
	ownershipCatalog: conversationOwnershipCatalog,
	externalConditionChanges: agentTeamExternalConditionChanges,
});

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function sameMemberIds(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) return false;
	const sortedLeft = [...left].sort();
	const sortedRight = [...right].sort();
	return sortedLeft.every((memberId, index) => memberId === sortedRight[index]);
}

function isTeamSessionStateRecord(value: unknown): value is TeamSessionStateRecord {
	return (
		typeof value === "object" &&
		value !== null &&
		"customType" in value &&
		value.customType === "agent-team.session-state.v1" &&
		"session" in value
	);
}

function readTeamSessionStateFromDocument(id: string, document: ConversationDocument): TeamSessionDocument {
	for (let index = document.entries.length - 1; index >= 0; index -= 1) {
		const entry = document.entries[index];
		if (entry?.type !== "custom" || entry.customType !== "agent-team.session-state.v1") continue;
		if (!isTeamSessionStateRecord(entry.data)) continue;
		const session = parseTeamSessionDocument(entry.data.session);
		if (session.id !== id) throw new Error("Team coordination Conversation belongs to another session");
		return session;
	}
	throw new Error(`Team session state is missing from coordination Conversation: ${id}`);
}
