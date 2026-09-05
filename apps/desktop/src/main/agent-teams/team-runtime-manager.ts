import {
	type AgentAbilitySelection,
	type AgentTeamDocument,
	buildTeamMemberOperatingContext,
	buildTeamRosterSnapshot,
	buildTeamSharedOperatingContext,
	filterTeamMemberActiveToolNames,
	findAgentBlueprint,
	resolveMemberProfile,
	stableTeamEventId,
	type TeamSessionDocument,
} from "@vetta/agent-team";
import type {
	CodingAgentPinnedModelContextBinder,
	CodingAgentRuntimeToolRegistration,
} from "@vetta/coding-agent/runtime";
import type { RuntimeHost, SessionExecutionMode } from "@vetta/runtime-core";
import { resolveDesktopSessionConfig } from "../conversations/resolve-session-config.js";
import { getAppLogger } from "../logger.js";
import type { TeamCollaborationStore } from "./team-collaboration-store.js";
import { restoreTeamMemberPinnedContext } from "./team-member-context.js";
import { reconfigureTeamMemberRuntime } from "./team-member-runtime-reconfiguration.js";
import { restoreTeamMemberRuntimes } from "./team-runtime-restorer.js";
import type { TeamSessionStateRepository } from "./team-session-state-repository.js";

const log = getAppLogger("agent-team-runtime-manager");

export interface TeamMemberPromptContext {
	readonly systemPromptCachePrefixAddon: string;
	readonly systemPromptVolatileAddon: string;
	readonly bindPinnedModelContext: CodingAgentPinnedModelContextBinder;
	readonly promptCacheKey: string;
}

export interface TeamRuntimeManagerOptions {
	readonly runtime: () => RuntimeHost;
	readonly createTeamToolRegistrations: (teamSessionId: string) => readonly CodingAgentRuntimeToolRegistration[];
	readonly sessionState: TeamSessionStateRepository;
	readonly collaborationStore: TeamCollaborationStore;
}

/** Owns Team Runtime creation, restoration, configuration, policy, and disposal boundaries. */
export class TeamRuntimeManager {
	private readonly options: TeamRuntimeManagerOptions;

	constructor(options: TeamRuntimeManagerOptions) {
		this.options = options;
	}

	applyDefaultTeamToolPolicy(runtimeSessionId: string): void {
		const runtime = this.options.runtime();
		if (
			typeof runtime.readSessionActiveToolNames !== "function" ||
			typeof runtime.setSessionActiveToolNames !== "function"
		) {
			return;
		}
		const current = runtime.readSessionActiveToolNames(runtimeSessionId);
		const filtered = filterTeamMemberActiveToolNames(current);
		if (filtered.length !== current.length) runtime.setSessionActiveToolNames(runtimeSessionId, filtered);
	}

	async createMemberRuntime(
		teamSessionId: string,
		member: AgentTeamDocument["teams"][number]["members"][number],
		team: AgentTeamDocument["teams"][number],
		document: AgentTeamDocument,
		cwd: string,
		executionMode: SessionExecutionMode,
	): Promise<TeamSessionDocument["memberRuntime"][string]> {
		const profile = resolveMemberProfile(document, member);
		const blueprint = findAgentBlueprint(profile.blueprintId);
		const systemPrompt = profile.systemPrompt ?? blueprint?.systemPrompt;
		if (!systemPrompt) throw new Error(`Agent profile has no system prompt: ${profile.id}`);
		const promptContext = this.createMemberPromptContext(
			teamSessionId,
			member.id,
			buildTeamRosterSnapshot(document, team),
			systemPrompt,
		);
		const resolved = await resolveDesktopSessionConfig(
			{
				cwd,
				executionMode,
				...promptContext,
				agentConfiguration: {
					template: null,
					overrides: toAgentConfigurationOverrides(profile.abilities),
				},
				sessionRuntimeTools: this.options.createTeamToolRegistrations(teamSessionId),
			},
			"other",
			"interactive",
		);
		const created = await this.options.runtime().createSession(resolved.config);
		this.applyDefaultTeamToolPolicy(created.sessionId);
		const sessionPath = this.options.runtime().getSessionPath(created.sessionId);
		if (!sessionPath) throw new Error("Runtime did not expose team member session path");
		return {
			sessionId: created.sessionId,
			sessionPath,
			agentProfileId: profile.id,
			agentProfileRevision: profile.revision,
			deliveredEventIds: [],
		};
	}

	async createCoordinationRuntime(
		cwd: string,
		sessionPath?: string,
		sessionId?: string,
		executionMode: SessionExecutionMode = "full-access",
	): Promise<NonNullable<TeamSessionDocument["coordinationRuntime"]>> {
		const resolved = await resolveDesktopSessionConfig(
			{
				cwd,
				executionMode,
				...(sessionPath ? { sessionPath } : {}),
				...(sessionId ? { sessionId } : {}),
			},
			"other",
			"interactive",
		);
		const created = await this.options.runtime().createSession(resolved.config);
		if (sessionId && created.sessionId !== sessionId) {
			await this.options.runtime().disposeSession(created.sessionId);
			throw new Error("Restored team coordination session identity changed");
		}
		const resolvedPath = this.options.runtime().getSessionPath(created.sessionId);
		if (!resolvedPath) throw new Error("Runtime did not expose team coordination session path");
		if (sessionPath && resolvedPath !== sessionPath) {
			await this.options.runtime().disposeSession(created.sessionId);
			throw new Error("Restored team coordination session path changed");
		}
		return { sessionId: created.sessionId, sessionPath: resolvedPath };
	}

	async ensureCoordinationRuntime(session: TeamSessionDocument): Promise<TeamSessionDocument> {
		const current = session.coordinationRuntime;
		if (current) {
			const activePath = this.options.runtime().getSessionPath(current.sessionId);
			if (activePath) {
				if (activePath !== current.sessionPath) {
					throw new Error(`Runtime session id is already bound to another path: ${current.sessionId}`);
				}
				return session;
			}
		}
		const coordinationRuntime = await this.createCoordinationRuntime(
			session.cwd,
			current?.sessionPath,
			current?.sessionId ?? session.id,
			session.executionMode ?? "full-access",
		);
		const next: TeamSessionDocument = {
			...session,
			revision: session.revision + 1,
			updatedAt: Date.now(),
			coordinationRuntime,
		};
		await this.options.sessionState.persist(next);
		return next;
	}

	async restoreMembers(session: TeamSessionDocument, document: AgentTeamDocument): Promise<TeamSessionDocument> {
		const restored = await restoreTeamMemberRuntimes({
			session,
			runtime: this.options.runtime(),
			createRuntimeTools: () => this.options.createTeamToolRegistrations(session.id),
			resolveConfig: async ({ memberId, sessionPath, runtimeTools }) => {
				const profile = this.resolveMemberProfile(session, document, memberId);
				return {
					config: await this.resolveMemberSessionConfig(
						session,
						document,
						memberId,
						sessionPath,
						runtimeTools,
						session.executionMode ?? "full-access",
					),
					agentProfileId: profile.id,
					agentProfileRevision: profile.revision,
				};
			},
			persist: (next) => this.options.sessionState.persist(next),
			logger: log,
		});
		for (const runtimeState of Object.values(restored.memberRuntime)) {
			this.applyDefaultTeamToolPolicy(runtimeState.sessionId);
		}
		return restored;
	}

	async ensureMemberConfiguration(
		session: TeamSessionDocument,
		document: AgentTeamDocument,
		memberId: string,
	): Promise<TeamSessionDocument> {
		const profile = this.resolveMemberProfile(session, document, memberId);
		const configured = await reconfigureTeamMemberRuntime({
			session,
			memberId,
			agentProfileId: profile.id,
			agentProfileRevision: profile.revision,
			runtime: this.options.runtime(),
			resolveConfig: (sessionPath) =>
				this.resolveMemberSessionConfig(
					session,
					document,
					memberId,
					sessionPath,
					this.options.createTeamToolRegistrations(session.id),
					session.executionMode ?? "full-access",
				),
			persist: (next) => this.options.sessionState.persist(next),
			logger: log,
		});
		const runtimeState = configured.memberRuntime[memberId];
		if (runtimeState) this.applyDefaultTeamToolPolicy(runtimeState.sessionId);
		return configured;
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
		executionMode: SessionExecutionMode,
	) {
		const profile = this.resolveMemberProfile(session, document, memberId);
		const team = document.teams.find((candidate) => candidate.id === session.teamId);
		if (!team) throw new Error(`Agent team not found: ${session.teamId}`);
		const blueprint = findAgentBlueprint(profile.blueprintId);
		const systemPrompt = profile.systemPrompt ?? blueprint?.systemPrompt;
		if (!systemPrompt) throw new Error(`Agent profile has no system prompt: ${profile.id}`);
		return (
			await resolveDesktopSessionConfig(
				{
					cwd: session.cwd,
					executionMode,
					sessionPath,
					...this.createMemberPromptContext(
						session.id,
						memberId,
						buildTeamRosterSnapshot(document, team),
						systemPrompt,
					),
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

	private createMemberPromptContext(
		teamSessionId: string,
		memberId: string,
		roster: ReturnType<typeof buildTeamRosterSnapshot>,
		roleInstructions: string,
	): TeamMemberPromptContext {
		return {
			systemPromptCachePrefixAddon: buildTeamSharedOperatingContext(roster),
			systemPromptVolatileAddon: buildTeamMemberOperatingContext(roster, memberId, roleInstructions),
			promptCacheKey: stableTeamEventId(["team-prompt-cache", teamSessionId]),
			bindPinnedModelContext: (context) => {
				context.signal.throwIfAborted();
				const session = this.options.sessionState.get(teamSessionId);
				const member = session?.memberRuntime[memberId];
				if (!session || !member?.sharedCheckpointId) return undefined;
				if (!session.coordinationRuntime) throw new Error("Team coordination conversation is unavailable");
				return restoreTeamMemberPinnedContext({
					memberId,
					participantConversationId: member.sessionId,
					checkpointId: member.sharedCheckpointId,
					coordinationConversationId: session.coordinationRuntime.sessionId,
					state: this.options.collaborationStore.read(session),
					memberDocument: this.options.runtime().readSessionDocument(member.sessionId),
				});
			},
		};
	}
}

export function toAgentConfigurationOverrides(abilities: AgentAbilitySelection): {
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
