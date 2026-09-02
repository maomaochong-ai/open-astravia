import {
	type AgentAbilitySelection,
	type AgentTeamDocument,
	type AgentTeamExtensionRegistry,
	createMemberDelegationEvent,
	createMemberResultEvent,
	createTeamDelegateTool,
	createUserMessageEvent,
	DEFAULT_AGENT_TEAM_EXTENSIONS,
	finalizeTeamMemberTurn,
	findAgentBlueprint,
	resolveMemberByHandle,
	resolveMemberProfile,
	type SendTeamMessageInput,
	type TeamFeedEvent,
	type TeamSessionDocument,
	type TeamSessionStreamEvent,
	type TeamStreamingTurnSnapshot,
} from "@vetta/agent-team";
import type { CodingAgentRuntimeToolRegistration } from "@vetta/coding-agent/runtime";
import type { PromptAttachmentRef, RuntimeHost } from "@vetta/runtime-core";
import { resolveDesktopSessionConfig } from "../conversations/resolve-session-config.js";
import { getAppLogger } from "../logger.js";
import { getSharedRuntime } from "../runtime.js";
import { agentTeamExtensionHost } from "./agent-team-extension-host.js";
import { agentTeamStore } from "./agent-team-store.js";
import { reconfigureTeamMemberRuntime } from "./team-member-runtime-reconfiguration.js";
import { restoreTeamMemberRuntimes } from "./team-runtime-restorer.js";
import { createTeamSessionRepository, type TeamSessionRepository } from "./team-session-repository.js";

const log = getAppLogger("agent-team-sessions");

export interface AgentTeamSessionServiceOptions {
	readonly runtime?: RuntimeHost;
	readonly extensions?: AgentTeamExtensionRegistry;
	readonly repository?: TeamSessionRepository;
	readonly readDocument?: () => Promise<AgentTeamDocument>;
}

export interface TeamSessionSubscription {
	readonly unsubscribe: () => void;
	readonly snapshot?: Extract<TeamSessionStreamEvent, { type: "session-snapshot" }>;
}

export class AgentTeamSessionService {
	private runtime: RuntimeHost | undefined;
	private readonly sessions = new Map<string, TeamSessionDocument>();
	private readonly sendQueues = new Map<string, Promise<void>>();
	private readonly activeSends = new Map<string, AbortController>();
	private readonly subscribers = new Map<string, Set<(event: TeamSessionStreamEvent) => void>>();
	private readonly runtimeSubscriptions = new Map<
		string,
		{ readonly teamSessionId: string; readonly unsubscribe: () => void }
	>();
	private readonly activeMemberTurns = new Map<
		string,
		{
			readonly teamSessionId: string;
			readonly memberId: string;
			readonly requestId: string;
			readonly turnId: string;
			readonly startedAt: number;
			seq: number;
			text: string;
		}
	>();

	private readonly extensions: AgentTeamExtensionRegistry;
	private readonly repository: TeamSessionRepository;
	private readonly readDocument: () => Promise<AgentTeamDocument>;

	constructor(options: AgentTeamSessionServiceOptions = {}) {
		this.runtime = options.runtime;
		this.extensions = options.extensions ?? DEFAULT_AGENT_TEAM_EXTENSIONS;
		this.repository = options.repository ?? createTeamSessionRepository();
		this.readDocument =
			options.readDocument ?? (() => Promise.reject(new Error("Agent Team configuration reader is unavailable")));
	}

	private getRuntime(): RuntimeHost {
		this.runtime ??= getSharedRuntime();
		return this.runtime;
	}

	subscribe(sessionId: string, handler: (event: TeamSessionStreamEvent) => void): TeamSessionSubscription {
		const listeners = this.subscribers.get(sessionId) ?? new Set();
		listeners.add(handler);
		this.subscribers.set(sessionId, listeners);
		const session = this.sessions.get(sessionId);
		const snapshot = session
			? ({
					type: "session-snapshot",
					teamSessionId: sessionId,
					session,
					activeTurns: this.activeTurnSnapshots(sessionId),
				} satisfies Extract<TeamSessionStreamEvent, { type: "session-snapshot" }>)
			: undefined;
		if (session) this.attachRuntimeSubscriptions(session);
		return {
			...(snapshot ? { snapshot } : {}),
			unsubscribe: () => {
				listeners.delete(handler);
				if (listeners.size === 0) {
					this.subscribers.delete(sessionId);
					this.detachIdleRuntimeSubscriptions(sessionId);
				}
			},
		};
	}

	private publish(event: TeamSessionStreamEvent): void {
		for (const listener of this.subscribers.get(event.teamSessionId) ?? []) listener(event);
	}

	private attachRuntimeSubscriptions(session: TeamSessionDocument): void {
		for (const runtimeState of Object.values(session.memberRuntime)) {
			if (this.runtimeSubscriptions.has(runtimeState.sessionId)) continue;
			const unsubscribe = this.getRuntime().subscribe(runtimeState.sessionId, (event) => {
				const active = this.activeMemberTurns.get(runtimeState.sessionId);
				if (!active) return;
				if (event.channel === "assistant" && event.type === "text_delta" && event.delta) {
					active.seq += 1;
					active.text += event.delta;
					this.publish({
						type: "member-delta",
						teamSessionId: active.teamSessionId,
						memberId: active.memberId,
						requestId: active.requestId,
						turnId: active.turnId,
						seq: active.seq,
						delta: event.delta,
						timestamp: event.timestamp,
					});
					return;
				}
				if (event.type === "message.delta" && event.delta) {
					active.seq += 1;
					active.text += event.delta;
					this.publish({
						type: "member-delta",
						teamSessionId: active.teamSessionId,
						memberId: active.memberId,
						requestId: active.requestId,
						turnId: active.turnId,
						seq: active.seq,
						delta: event.delta,
						timestamp: event.timestamp,
					});
				}
			});
			this.runtimeSubscriptions.set(runtimeState.sessionId, {
				teamSessionId: session.id,
				unsubscribe,
			});
		}
	}

	private activeTurnSnapshots(teamSessionId: string): TeamStreamingTurnSnapshot[] {
		return [...this.activeMemberTurns.values()]
			.filter((turn) => turn.teamSessionId === teamSessionId)
			.map((turn) => ({
				turnId: turn.turnId,
				memberId: turn.memberId,
				requestId: turn.requestId,
				seq: turn.seq,
				text: turn.text,
				startedAt: turn.startedAt,
			}));
	}

	private detachIdleRuntimeSubscriptions(teamSessionId: string): void {
		const hasActiveTurn = [...this.activeMemberTurns.values()].some((turn) => turn.teamSessionId === teamSessionId);
		if (hasActiveTurn || this.subscribers.has(teamSessionId)) return;
		for (const [runtimeSessionId, subscription] of this.runtimeSubscriptions) {
			if (subscription.teamSessionId !== teamSessionId) continue;
			subscription.unsubscribe();
			this.runtimeSubscriptions.delete(runtimeSessionId);
		}
	}

	private async createMemberRuntime(
		teamSessionId: string,
		member: AgentTeamDocument["teams"][number]["members"][number],
		document: AgentTeamDocument,
		cwd: string,
	): Promise<TeamSessionDocument["memberRuntime"][string]> {
		const profile = resolveMemberProfile(document, member);
		const blueprint = findAgentBlueprint(profile.blueprintId);
		if (!blueprint) throw new Error(`Unknown agent blueprint: ${profile.blueprintId}`);
		const resolved = await resolveDesktopSessionConfig(
			{
				cwd,
				appendSystemPrompt: blueprint.systemPrompt,
				agentConfiguration: {
					template: null,
					overrides: toAgentConfigurationOverrides(profile.abilities),
				},
				sessionRuntimeTools: [this.createDelegateRegistration(teamSessionId)],
			},
			"other",
			"interactive",
		);
		const created = await this.getRuntime().createSession({
			...resolved.config,
			sessionDir: this.repository.memberSessionDirectory(teamSessionId, member.id),
		});
		const sessionPath = this.getRuntime().getSessionPath(created.sessionId);
		if (!sessionPath) throw new Error("Runtime did not expose team member session path");
		return {
			sessionId: created.sessionId,
			sessionPath,
			agentProfileId: profile.id,
			agentProfileRevision: profile.revision,
			deliveredEventIds: [],
		};
	}

	async create(
		team: AgentTeamDocument["teams"][number],
		document: AgentTeamDocument,
		cwd: string,
	): Promise<TeamSessionDocument> {
		const id = crypto.randomUUID();
		const now = Date.now();
		const memberRuntime: Record<string, TeamSessionDocument["memberRuntime"][string]> = {};

		try {
			for (const member of team.members) {
				memberRuntime[member.id] = await this.createMemberRuntime(id, member, document, cwd);
			}
		} catch (error) {
			await Promise.allSettled(
				Object.values(memberRuntime).map((runtimeState) =>
					this.getRuntime().disposeSession(runtimeState.sessionId),
				),
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
			events: [],
			memberRuntime,
		};

		await this.persist(session);
		this.sessions.set(id, session);
		log.info("team session created", {
			teamId: team.id,
			teamSessionId: id,
			memberCount: team.members.length,
		});
		return session;
	}

	async read(id: string): Promise<TeamSessionDocument> {
		const cached = this.sessions.get(id);
		if (cached) return this.reconcileTeamRoster(cached, await this.readDocument());

		try {
			const persisted = await this.repository.read(id);
			const document = await this.readDocument();
			const team = document.teams.find((candidate) => candidate.id === persisted.teamId);
			if (!team) throw new Error(`Agent team not found: ${persisted.teamId}`);
			const desiredMemberIds = new Set(team.members.map((member) => member.id));
			const prepared: TeamSessionDocument = {
				...persisted,
				memberRuntime: Object.fromEntries(
					Object.entries(persisted.memberRuntime).filter(([memberId]) => desiredMemberIds.has(memberId)),
				),
			};
			const restored = await restoreTeamMemberRuntimes({
				session: prepared,
				runtime: this.getRuntime(),
				createRuntimeTools: () => [this.createDelegateRegistration(id)],
				resolveConfig: async ({ memberId, sessionPath, runtimeTools }) => {
					const profile = this.resolveMemberProfile(prepared, document, memberId);
					return {
						config: await this.resolveMemberSessionConfig(
							prepared,
							document,
							memberId,
							sessionPath,
							runtimeTools,
						),
						agentProfileId: profile.id,
						agentProfileRevision: profile.revision,
					};
				},
				persist: (session) => this.persist(session),
				logger: log,
			});
			this.sessions.set(id, restored);
			return this.reconcileTeamRoster(restored, document);
		} catch (error) {
			log.error("failed to load team session", { teamSessionId: id, error: errorMessage(error) });
			throw new Error(`Team session could not be loaded: ${id}`, { cause: error });
		}
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
		if (this.activeSends.has(session.id)) {
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
				const runtimeState = await this.createMemberRuntime(session.id, member, document, session.cwd);
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
				const subscription = this.runtimeSubscriptions.get(runtimeState.sessionId);
				subscription?.unsubscribe();
				this.runtimeSubscriptions.delete(runtimeState.sessionId);
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
			this.attachRuntimeSubscriptions(next);
			this.publish({
				type: "session-updated",
				teamSessionId: next.id,
				session: next,
				revision: next.revision,
			});
			return next;
		} catch (error) {
			await Promise.allSettled(createdRuntimeIds.map((runtimeId) => this.getRuntime().disposeSession(runtimeId)));
			throw error;
		}
	}

	async send(sessionId: string, input: SendTeamMessageInput): Promise<TeamSessionDocument> {
		const previous = this.sendQueues.get(sessionId) ?? Promise.resolve();
		const next = previous
			.catch(() => undefined)
			.then(() => {
				const controller = new AbortController();
				this.activeSends.set(sessionId, controller);
				return this.sendInternal(sessionId, input, controller.signal).finally(() => {
					if (this.activeSends.get(sessionId) === controller) this.activeSends.delete(sessionId);
				});
			});
		const tail = next.then(
			() => undefined,
			() => undefined,
		);
		this.sendQueues.set(sessionId, tail);
		try {
			return await next;
		} catch (error) {
			log.error("team message failed", {
				teamSessionId: sessionId,
				requestId: input.requestId,
				error: errorMessage(error),
			});
			throw error;
		} finally {
			if (this.sendQueues.get(sessionId) === tail) this.sendQueues.delete(sessionId);
		}
	}

	async abort(sessionId: string): Promise<void> {
		this.activeSends.get(sessionId)?.abort();
	}

	private async sendInternal(
		sessionId: string,
		input: SendTeamMessageInput,
		signal: AbortSignal,
	): Promise<TeamSessionDocument> {
		const current = await this.read(sessionId);
		const document = await this.readDocument();
		const team = this.syntheticTeam(current);
		const orchestration = this.extensions.orchestrationPolicies.get(team.orchestrationPolicyId);
		if (!orchestration) throw new Error(`Unknown team orchestration policy: ${team.orchestrationPolicyId}`);
		const targets = orchestration.resolveTargets({ team, requestedMemberIds: input.targetMemberIds });
		const existingUser = current.events.find(
			(event): event is Extract<TeamFeedEvent, { type: "user-message" }> =>
				event.type === "user-message" && event.requestId === input.requestId,
		);
		if (
			existingUser &&
			(existingUser.text !== input.text ||
				!sameMemberIds(existingUser.targetMemberIds, targets) ||
				!sameAttachments(existingUser.attachments ?? [], input.attachments ?? []))
		) {
			throw new Error(`Request id already used with different content: ${input.requestId}`);
		}
		const completed = new Set(
			current.events
				.filter(
					(event): event is Extract<TeamFeedEvent, { type: "member-result" }> =>
						event.type === "member-result" &&
						event.requestId === input.requestId &&
						targets.includes(event.memberId),
				)
				.map((event) => event.memberId),
		);
		if (existingUser && targets.every((memberId) => completed.has(memberId))) return current;

		const userEvent =
			existingUser ??
			createUserMessageEvent({
				teamSessionId: current.id,
				requestId: input.requestId,
				text: input.text,
				targetMemberIds: targets,
				...(input.attachments?.length ? { attachments: input.attachments } : {}),
				timestamp: Date.now(),
			});
		let next: TeamSessionDocument = existingUser
			? current
			: {
					...current,
					revision: current.revision + 1,
					updatedAt: Date.now(),
					events: [...current.events, userEvent],
				};
		if (!existingUser) {
			await this.persist(next);
			this.publish({
				type: "session-updated",
				teamSessionId: next.id,
				session: next,
				revision: next.revision,
			});
		}

		for (const memberId of targets) {
			if (signal.aborted) throw new Error("Team message was cancelled");
			if (completed.has(memberId)) continue;
			next = await this.runMemberTurn(
				next,
				document,
				memberId,
				input.text,
				input.requestId,
				`${input.requestId}:${memberId}`,
				signal,
				input.attachments,
			);
		}

		this.sessions.set(sessionId, next);
		return next;
	}

	private async runMemberTurn(
		session: TeamSessionDocument,
		document: AgentTeamDocument,
		memberId: string,
		promptText: string,
		requestId: string,
		sourceTurnId: string,
		signal?: AbortSignal,
		attachments?: readonly PromptAttachmentRef[],
	): Promise<TeamSessionDocument> {
		const configuredSession = await this.ensureMemberConfiguration(session, document, memberId);
		const runtimeState = configuredSession.memberRuntime[memberId];
		if (!runtimeState) throw new Error(`Team member runtime not found: ${memberId}`);
		const contextPolicyId = configuredSession.contextPolicyId ?? "public-results-v1";
		const contextPolicy = this.extensions.contextPolicies.get(contextPolicyId);
		if (!contextPolicy) throw new Error(`Unknown team context policy: ${contextPolicyId}`);
		const context = contextPolicy.project({
			session: configuredSession,
			targetMemberId: memberId,
			deliveredEventIds: new Set(runtimeState.deliveredEventIds),
			currentRequestId: requestId,
		});
		const contextText = context.length
			? `\n\n<agent_team_shared_context>\n${context
					.map((record) => `[${record.type}] ${record.text}`)
					.join("\n\n")}\n</agent_team_shared_context>`
			: "";

		log.info("team member turn started", {
			teamSessionId: configuredSession.id,
			memberId,
			requestId,
			sharedContextCount: context.length,
		});
		if (signal?.aborted) throw new Error("Team member turn was cancelled");
		const abortTarget = () => {
			void this.getRuntime().abort(runtimeState.sessionId);
		};
		const startedAt = Date.now();
		const activeTurn = {
			teamSessionId: configuredSession.id,
			memberId,
			requestId,
			turnId: sourceTurnId,
			startedAt,
			seq: 0,
			text: "",
		};
		this.activeMemberTurns.set(runtimeState.sessionId, activeTurn);
		signal?.addEventListener("abort", abortTarget, { once: true });
		try {
			this.attachRuntimeSubscriptions(configuredSession);
			this.publish({
				type: "member-start",
				teamSessionId: configuredSession.id,
				memberId,
				requestId,
				turnId: sourceTurnId,
				seq: 0,
				timestamp: startedAt,
			});
			await this.getRuntime().prompt(runtimeState.sessionId, {
				text: `${promptText}${contextText}`,
				...(attachments?.length ? { attachments: [...attachments] } : {}),
			});
			if (signal?.aborted) throw new Error("Team member turn was cancelled");
		} catch (error) {
			activeTurn.seq += 1;
			this.publish({
				type: "member-end",
				teamSessionId: configuredSession.id,
				memberId,
				requestId,
				turnId: sourceTurnId,
				seq: activeTurn.seq,
				phase: signal?.aborted ? "aborted" : "error",
				error: signal?.aborted ? undefined : errorMessage(error),
				timestamp: Date.now(),
			});
			throw error;
		} finally {
			this.activeMemberTurns.delete(runtimeState.sessionId);
			signal?.removeEventListener("abort", abortTarget);
			this.detachIdleRuntimeSubscriptions(configuredSession.id);
		}

		const messages = this.getRuntime().getMessages(runtimeState.sessionId);
		const assistant = [...messages].reverse().find((message) => message.role === "assistant");
		const resultText =
			assistant?.content
				.filter((item) => item.type === "text")
				.map((item) => item.text)
				.join("\n") ?? "";
		const result = createMemberResultEvent({
			teamSessionId: configuredSession.id,
			requestId,
			memberId,
			sourceTurnId,
			text: resultText,
			timestamp: Date.now(),
		});
		const next = finalizeTeamMemberTurn({
			session: this.sessions.get(configuredSession.id) ?? configuredSession,
			memberId,
			result,
			deliveredEventIds: context.map((record) => record.eventId),
			timestamp: Date.now(),
		});
		await this.persist(next);
		this.publish({
			type: "session-updated",
			teamSessionId: next.id,
			session: next,
			revision: next.revision,
		});
		this.publish({
			type: "member-end",
			teamSessionId: next.id,
			memberId,
			requestId,
			turnId: sourceTurnId,
			seq: activeTurn.seq + 1,
			phase: "final",
			timestamp: Date.now(),
		});
		log.info("team member turn completed", {
			teamSessionId: next.id,
			memberId,
			requestId,
			sharedContextCount: context.length,
		});
		return next;
	}

	private createDelegateRegistration(teamSessionId: string) {
		const tool = createTeamDelegateTool({
			delegate: ({ sourceRuntimeSessionId, sourceTurnId, targetHandle, objective, signal }) =>
				this.delegate(teamSessionId, sourceRuntimeSessionId, sourceTurnId, targetHandle, objective, signal),
		});
		return {
			tool,
			scopeUse: ["project", "conversation"] as const,
			category: "agent-control" as const,
			modelOrder: 2440,
		};
	}

	private async delegate(
		teamSessionId: string,
		sourceRuntimeSessionId: string,
		sourceTurnId: string,
		targetHandle: string,
		objective: string,
		signal: AbortSignal,
	): Promise<{ memberId: string; memberHandle: string; summary: string }> {
		if (signal.aborted) throw new Error("Team delegation was cancelled");
		const current = await this.read(teamSessionId);
		const team = this.syntheticTeam(current);
		const sourceMember = Object.entries(current.memberRuntime).find(
			([, runtime]) => runtime.sessionId === sourceRuntimeSessionId,
		);
		if (!sourceMember) throw new Error("Source team member session not found");
		const target = resolveMemberByHandle(team, targetHandle);
		if (!target) throw new Error(`Unknown team member handle: ${targetHandle}`);
		if (target.id === sourceMember[0]) throw new Error("A team member cannot delegate to itself");

		const requestId = `delegate:${sourceTurnId}:${target.id}`;
		const existingResult = current.events.find(
			(event) => event.type === "member-result" && event.requestId === requestId && event.memberId === target.id,
		);
		const existingDelegation = current.events.find(
			(event): event is Extract<TeamFeedEvent, { type: "member-delegation" }> =>
				event.type === "member-delegation" && event.requestId === requestId,
		);
		if (
			existingDelegation &&
			(existingDelegation.targetMemberId !== target.id || existingDelegation.objective !== objective)
		) {
			throw new Error(`Delegation request id already used with different content: ${requestId}`);
		}
		if (existingResult && existingResult.type === "member-result") {
			return { memberId: target.id, memberHandle: target.handle, summary: existingResult.text };
		}

		const delegation = createMemberDelegationEvent({
			teamSessionId: current.id,
			requestId,
			sourceMemberId: sourceMember[0],
			targetMemberId: target.id,
			objective,
			timestamp: Date.now(),
		});
		const next: TeamSessionDocument = {
			...current,
			revision: current.revision + 1,
			updatedAt: Date.now(),
			events: [...current.events.filter((event) => event.id !== delegation.id), delegation],
		};
		await this.persist(next);
		this.sessions.set(teamSessionId, next);
		log.info("team member delegation started", {
			teamSessionId,
			sourceMemberId: sourceMember[0],
			targetMemberId: target.id,
			requestId,
		});
		const completed = await this.runMemberTurn(
			next,
			await this.readDocument(),
			target.id,
			objective,
			requestId,
			`${requestId}:${target.id}`,
			signal,
		);
		const result = [...completed.events]
			.reverse()
			.find(
				(event) => event.type === "member-result" && event.requestId === requestId && event.memberId === target.id,
			);
		return {
			memberId: target.id,
			memberHandle: target.handle,
			summary: result?.type === "member-result" ? result.text : "",
		};
	}

	private async ensureMemberConfiguration(
		session: TeamSessionDocument,
		document: AgentTeamDocument,
		memberId: string,
	): Promise<TeamSessionDocument> {
		const profile = this.resolveMemberProfile(session, document, memberId);

		return reconfigureTeamMemberRuntime({
			session,
			memberId,
			agentProfileId: profile.id,
			agentProfileRevision: profile.revision,
			runtime: this.getRuntime(),
			resolveConfig: (sessionPath) =>
				this.resolveMemberSessionConfig(session, document, memberId, sessionPath, [
					this.createDelegateRegistration(session.id),
				]),
			persist: (next) => this.persist(next),
			logger: log,
		});
	}

	private resolveMemberProfile(session: TeamSessionDocument, document: AgentTeamDocument, memberId: string) {
		const team = document.teams.find((candidate) => candidate.id === session.teamId);
		if (!team) throw new Error(`Agent team not found: ${session.teamId}`);
		const member = team.members.find((candidate) => candidate.id === memberId);
		if (!member) throw new Error(`Agent team member not found: ${memberId}`);
		return resolveMemberProfile(document, member);
	}

	private async resolveMemberSessionConfig(
		session: TeamSessionDocument,
		document: AgentTeamDocument,
		memberId: string,
		sessionPath: string,
		runtimeTools: readonly CodingAgentRuntimeToolRegistration[],
	) {
		const profile = this.resolveMemberProfile(session, document, memberId);
		const blueprint = findAgentBlueprint(profile.blueprintId);
		if (!blueprint) throw new Error(`Unknown agent blueprint: ${profile.blueprintId}`);
		return (
			await resolveDesktopSessionConfig(
				{
					cwd: session.cwd,
					sessionPath,
					appendSystemPrompt: blueprint.systemPrompt,
					agentConfiguration: {
						template: null,
						overrides: toAgentConfigurationOverrides(profile.abilities),
					},
					sessionRuntimeTools: runtimeTools,
				},
				"other",
				"interactive",
			)
		).config;
	}

	private syntheticTeam(session: TeamSessionDocument) {
		const activeMemberIds = new Set(session.activeMemberIds ?? Object.keys(session.memberRuntime));
		return {
			id: session.teamId,
			revision: 1,
			name: session.name,
			description: "",
			leaderMemberId: session.leaderMemberId,
			members: Object.entries(session.memberHandles)
				.filter(([id]) => activeMemberIds.has(id))
				.map(([id, handle]) => ({
					id,
					handle,
					binding: { kind: "reference" as const, agentProfileId: id },
				})),
			orchestrationPolicyId: session.orchestrationPolicyId ?? "leader-delegates-v1",
			contextPolicyId: session.contextPolicyId ?? "public-results-v1",
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
		};
	}

	private async persist(session: TeamSessionDocument): Promise<void> {
		await this.repository.write(session);
		this.sessions.set(session.id, session);
	}
}

export const agentTeamSessionService = new AgentTeamSessionService({
	extensions: agentTeamExtensionHost,
	readDocument: () => agentTeamStore.read(),
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

function sameAttachments(left: readonly PromptAttachmentRef[], right: readonly PromptAttachmentRef[]): boolean {
	if (left.length !== right.length) return false;
	const key = (attachment: PromptAttachmentRef) => `${attachment.kind}\u0000${attachment.path}`;
	const sortedLeft = left.map(key).sort();
	const sortedRight = right.map(key).sort();
	return sortedLeft.every((attachment, index) => attachment === sortedRight[index]);
}

function toAgentConfigurationOverrides(abilities: AgentAbilitySelection): {
	readonly skills?: string[];
	readonly mcpServers?: string[];
	readonly plugins?: string[];
} {
	if (abilities.selectionMode === "all") return {};
	return {
		skills: [...abilities.skills],
		mcpServers: [...abilities.mcpServers],
		plugins: [...abilities.plugins],
	};
}
