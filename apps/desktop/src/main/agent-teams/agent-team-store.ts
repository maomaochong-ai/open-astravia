import {
	AGENT_TEAM_SCHEMA_VERSION,
	type AgentProfile,
	type AgentTeamDocument,
	type AgentTeamExtensionRegistry,
	assertTeamInvariants,
	type CreateAgentProfileInput,
	type CreateTeamInput,
	DEFAULT_AGENT_TEAM_EXTENSIONS,
	type DeleteAgentProfileInput,
	type DeleteTeamInput,
	normalizeMentionHandle,
	parseAgentTeamDocument,
	previewAgentProfileDelete,
	previewAgentProfileUpdate,
	requireTeamPolicies,
	type TeamDefinition,
	type TeamMemberAssignment,
	type UpdateAgentProfileInput,
	type UpdateTeamInput,
} from "@vetta/agent-team";
import { getAppLogger } from "../logger.js";
import { agentBlueprintRegistry, resolveAgentBlueprint } from "./agent-blueprint-registry.js";
import { type AgentTeamConfigRepository, createAgentTeamConfigRepository } from "./agent-team-config-repository.js";
import { agentTeamExtensionHost } from "./agent-team-extension-host.js";

const log = getAppLogger("agent-teams");

/**
 * 提供方维护的智能体/团队被要求删除时的错误。
 *
 * 用一个稳定的标识而不是人读文案：渲染进程要据此给出可读提示，而这条路径正常情况下走不到
 * ——UI 根本不该给出删除入口。
 */
export const PROVIDED_RESOURCE_DELETE_ERROR = "AGENT_RESOURCE_PROVIDED_BY_EXTENSION";

export interface AgentTeamStoreOptions {
	readonly extensions?: AgentTeamExtensionRegistry;
	readonly repository?: AgentTeamConfigRepository;
	readonly createId?: () => string;
	readonly now?: () => number;
}

export class AgentTeamStore {
	private document: AgentTeamDocument | undefined;
	private loadPromise: Promise<AgentTeamDocument> | undefined;
	private mutationTail: Promise<void> = Promise.resolve();
	private readonly extensions: AgentTeamExtensionRegistry;
	private readonly repository: AgentTeamConfigRepository;
	private readonly createId: () => string;
	private readonly now: () => number;

	constructor(options: AgentTeamStoreOptions = {}) {
		this.extensions = options.extensions ?? DEFAULT_AGENT_TEAM_EXTENSIONS;
		this.repository = options.repository ?? createAgentTeamConfigRepository(this.extensions);
		this.createId = options.createId ?? (() => crypto.randomUUID());
		this.now = options.now ?? Date.now;
	}

	async read(): Promise<AgentTeamDocument> {
		if (this.document) return this.document;
		this.loadPromise ??= this.repository
			.read()
			.then((document) => {
				this.document = document;
				return document;
			})
			.catch((error: unknown) => {
				log.error("failed to read agent team configuration", { error: errorMessage(error) });
				throw new Error("Agent Team configuration could not be loaded", { cause: error });
			})
			.finally(() => {
				this.loadPromise = undefined;
			});
		return this.loadPromise;
	}

	async listBlueprints() {
		return agentBlueprintRegistry.list();
	}

	async createAgent(input: CreateAgentProfileInput): Promise<AgentProfile> {
		const profile = await this.mutate("create-agent", (document) => {
			const now = this.now();
			const blueprint = resolveAgentBlueprint(input.blueprintId);
			if (!blueprint) throw new Error(`Unknown agent blueprint: ${input.blueprintId}`);
			const created: AgentProfile = {
				id: this.createId(),
				revision: 1,
				name: input.name.trim(),
				description: input.description?.trim() ?? "",
				...(input.avatar ? { avatar: input.avatar } : {}),
				mentionHandle: normalizeMentionHandle(input.mentionHandle),
				blueprintId: input.blueprintId,
				abilities: createAgentAbilities(input.abilities, blueprint.defaultAbilities),
				scope: { kind: "library" },
				createdAt: now,
				updatedAt: now,
			};
			this.ensureUniqueHandle(document, created.mentionHandle, undefined);
			return {
				document: { ...document, revision: document.revision + 1, agents: [...document.agents, created] },
				result: created,
			};
		});
		log.info("agent profile created", { agentProfileId: profile.id, blueprintId: profile.blueprintId });
		return profile;
	}

	async updateAgent(agentProfileId: string, input: UpdateAgentProfileInput): Promise<AgentProfile> {
		const result = await this.mutate("update-agent", (document) => {
			const index = document.agents.findIndex((agent) => agent.id === agentProfileId);
			if (index < 0) throw new Error(`Agent profile not found: ${agentProfileId}`);
			const current = document.agents[index];
			if (current.revision !== input.expectedRevision)
				throw new Error("Agent profile changed; reload before saving");
			this.ensureUniqueHandle(document, normalizeMentionHandle(input.mentionHandle), agentProfileId);
			const next: AgentProfile = {
				...current,
				name: input.name.trim(),
				description: input.description.trim(),
				// 留空即清除覆盖，回到 blueprint 默认；写成空串会让下游的 `?? blueprint` 兜底失效。
				...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt.trim() || undefined } : {}),
				...(input.avatar ? { avatar: input.avatar } : { avatar: undefined }),
				mentionHandle: normalizeMentionHandle(input.mentionHandle),
				abilities: {
					selectionMode: input.abilities.selectionMode ?? "custom",
					skills: [...input.abilities.skills],
					mcpServers: [...input.abilities.mcpServers],
					plugins: [...input.abilities.plugins],
					...(input.abilities.extensions ? { extensions: cloneExtensions(input.abilities.extensions) } : {}),
				},
				revision: current.revision + 1,
				updatedAt: this.now(),
			};
			const agents = [...document.agents];
			agents[index] = next;
			return {
				document: { ...document, revision: document.revision + 1, agents },
				result: {
					profile: next,
					affectedTeams: previewAgentProfileUpdate(document, agentProfileId).teamIds.length,
				},
			};
		});
		log.info("agent profile updated", {
			agentProfileId,
			revision: result.profile.revision,
			affectedTeams: result.affectedTeams,
		});
		return result.profile;
	}

	async deleteAgent(agentProfileId: string, input: DeleteAgentProfileInput): Promise<void> {
		const deleted = await this.mutate("delete-agent", (document) => {
			const profile = document.agents.find((agent) => agent.id === agentProfileId);
			if (!profile) throw new Error(`Agent profile not found: ${agentProfileId}`);
			// 提供方维护的档案不接受删除：它在下次启动会被原样补回来，删除只会制造「删了又回来」
			// 的错觉，还会顺带拆掉引用它的团队。UI 也不给入口，这里是最后一道闸。
			if (profile.source) throw new Error(PROVIDED_RESOURCE_DELETE_ERROR);
			if (profile.revision !== input.expectedRevision) {
				throw new Error("Agent profile changed; reload before deleting");
			}
			const impact = previewAgentProfileDelete(document, agentProfileId);
			const expectedTeamIds = input.expectedTeamIds ?? [];
			const currentTeamIds = impact.teams.map((team) => team.teamId);
			const revisionsMatch = impact.teams.every(
				(team) => input.expectedTeamRevisions?.[team.teamId] === team.teamRevision,
			);
			if (!sameIds(expectedTeamIds, currentTeamIds) || !revisionsMatch) {
				throw new Error("Agent profile references changed; review affected teams before deleting");
			}
			const deletedTeamIds = new Set(impact.teams.filter((team) => team.deletesTeam).map((team) => team.teamId));
			const impactByTeamId = new Map(impact.teams.map((team) => [team.teamId, team]));
			const now = this.now();
			const teams = document.teams.flatMap((team) => {
				const teamImpact = impactByTeamId.get(team.id);
				if (!teamImpact) return [team];
				if (teamImpact.deletesTeam) return [];
				const removedIds = new Set(teamImpact.removedMemberIds);
				const members = team.members.filter((member) => !removedIds.has(member.id));
				return [
					{
						...team,
						revision: team.revision + 1,
						leaderMemberId: teamImpact.nextLeaderMemberId ?? team.leaderMemberId,
						members,
						updatedAt: now,
					},
				];
			});
			return {
				document: {
					...document,
					revision: document.revision + 1,
					agents: document.agents.filter(
						(agent) =>
							agent.id !== agentProfileId &&
							!(agent.scope.kind === "team" && deletedTeamIds.has(agent.scope.teamId)),
					),
					teams,
				},
				result: profile,
			};
		});
		log.info("agent profile deleted", { agentProfileId: deleted.id, revision: deleted.revision });
	}

	async previewAgentUpdate(agentProfileId: string) {
		return previewAgentProfileUpdate(await this.read(), agentProfileId);
	}

	async previewAgentDelete(agentProfileId: string) {
		return previewAgentProfileDelete(await this.read(), agentProfileId);
	}

	async createTeam(input: CreateTeamInput): Promise<TeamDefinition> {
		const team = await this.mutate("create-team", (document) => {
			if (input.members.length === 0) throw new Error("A team must contain at least one member");
			const teamId = this.createId();
			const now = this.now();
			const agents = [...document.agents];
			const members = input.members.map((member) => {
				const source = agents.find((agent) => agent.id === member.agentProfileId);
				if (!source) throw new Error(`Agent profile not found: ${member.agentProfileId}`);
				const assignment = normalizeTeamMemberAssignment(member.assignment);
				if (member.bindingKind === "copy") {
					const copy = this.createTeamCopy(source, teamId, now);
					agents.push(copy);
					return {
						id: this.createId(),
						handle: normalizeMentionHandle(member.handle),
						binding: { kind: "copy" as const, agentProfileId: copy.id },
						...(assignment ? { assignment } : {}),
						leader: member.leader,
					};
				}
				return {
					id: this.createId(),
					handle: normalizeMentionHandle(member.handle),
					binding: { kind: "reference" as const, agentProfileId: source.id },
					...(assignment ? { assignment } : {}),
					leader: member.leader,
				};
			});
			const leaders = members.filter((member) => member.leader);
			if (leaders.length !== 1) throw new Error("A team must have exactly one leader");
			const created: TeamDefinition = {
				id: teamId,
				revision: 1,
				name: input.name.trim(),
				description: input.description?.trim() ?? "",
				leaderMemberId: leaders[0].id,
				members: members.map(({ leader: _leader, ...member }) => member),
				orchestrationPolicyId: input.orchestrationPolicyId ?? "leader-delegates-v1",
				contextPolicyId: input.contextPolicyId ?? "public-results-v1",
				createdAt: now,
				updatedAt: now,
			};
			requireTeamPolicies(created.orchestrationPolicyId, created.contextPolicyId, this.extensions);
			assertTeamInvariants(created, agents);
			return {
				document: {
					...document,
					revision: document.revision + 1,
					agents,
					teams: [...document.teams, created],
				},
				result: created,
			};
		});
		log.info("agent team created", { teamId: team.id, memberCount: team.members.length });
		return team;
	}

	async updateTeam(teamId: string, input: UpdateTeamInput): Promise<TeamDefinition> {
		const updated = await this.mutate("update-team", (document) => {
			const teamIndex = document.teams.findIndex((team) => team.id === teamId);
			if (teamIndex < 0) throw new Error(`Agent team not found: ${teamId}`);
			const current = document.teams[teamIndex];
			if (current.revision !== input.expectedRevision) {
				throw new Error("Agent team changed; reload before saving");
			}
			const now = this.now();
			const existingIds = new Set<string>();
			const newSourceIds = new Set<string>();
			let agents = [...document.agents];
			const members = input.members.map((memberInput) => {
				if (memberInput.kind === "existing") {
					if (existingIds.has(memberInput.memberId)) {
						throw new Error(`Duplicate team member id: ${memberInput.memberId}`);
					}
					existingIds.add(memberInput.memberId);
					const member = current.members.find((candidate) => candidate.id === memberInput.memberId);
					if (!member) throw new Error(`Agent team member not found: ${memberInput.memberId}`);
					// 不带 assignment 的输入保持原样，带了就整体替换；全空即清除覆盖。
					const assignment =
						memberInput.assignment === undefined
							? member.assignment
							: normalizeTeamMemberAssignment(memberInput.assignment);
					return { ...member, assignment, leader: memberInput.leader };
				}
				if (newSourceIds.has(memberInput.agentProfileId)) {
					throw new Error(`Duplicate agent profile in team: ${memberInput.agentProfileId}`);
				}
				newSourceIds.add(memberInput.agentProfileId);
				const source = agents.find((agent) => agent.id === memberInput.agentProfileId);
				if (!source || source.scope.kind !== "library") {
					throw new Error(`Library agent profile not found: ${memberInput.agentProfileId}`);
				}
				const assignment = normalizeTeamMemberAssignment(memberInput.assignment);
				if (memberInput.bindingKind === "copy") {
					const copy = this.createTeamCopy(source, teamId, now);
					agents.push(copy);
					return {
						id: this.createId(),
						handle: source.mentionHandle,
						binding: { kind: "copy" as const, agentProfileId: copy.id },
						...(assignment ? { assignment } : {}),
						leader: memberInput.leader,
					};
				}
				return {
					id: this.createId(),
					handle: source.mentionHandle,
					binding: { kind: "reference" as const, agentProfileId: source.id },
					...(assignment ? { assignment } : {}),
					leader: memberInput.leader,
				};
			});
			const retainedMemberIds = new Set(
				input.members.flatMap((member) => (member.kind === "existing" ? [member.memberId] : [])),
			);
			const removedCopyProfileIds = new Set(
				current.members.flatMap((member) =>
					!retainedMemberIds.has(member.id) && member.binding.kind === "copy"
						? [member.binding.agentProfileId]
						: [],
				),
			);
			agents = agents.filter((agent) => !removedCopyProfileIds.has(agent.id));
			const leaders = members.filter((member) => member.leader);
			if (leaders.length !== 1) throw new Error("A team must have exactly one leader");
			const next: TeamDefinition = {
				...current,
				revision: current.revision + 1,
				name: input.name.trim(),
				description: input.description.trim(),
				leaderMemberId: leaders[0].id,
				members: members.map(({ leader: _leader, ...member }) => member),
				updatedAt: now,
			};
			assertTeamInvariants(next, agents);
			const teams = [...document.teams];
			teams[teamIndex] = next;
			return {
				document: { ...document, revision: document.revision + 1, agents, teams },
				result: next,
			};
		});
		log.info("agent team updated", { teamId: updated.id, memberCount: updated.members.length });
		return updated;
	}

	async deleteTeam(teamId: string, input: DeleteTeamInput): Promise<void> {
		const deleted = await this.mutate("delete-team", (document) => {
			const team = document.teams.find((candidate) => candidate.id === teamId);
			if (!team) throw new Error(`Agent team not found: ${teamId}`);
			// 与档案同一条规矩：提供方维护的团队不接受删除。
			if (team.source) throw new Error(PROVIDED_RESOURCE_DELETE_ERROR);
			if (team.revision !== input.expectedRevision) {
				throw new Error("Agent team changed; reload before deleting");
			}
			return {
				document: {
					...document,
					revision: document.revision + 1,
					agents: document.agents.filter(
						(agent) => !(agent.scope.kind === "team" && agent.scope.teamId === teamId),
					),
					teams: document.teams.filter((candidate) => candidate.id !== teamId),
				},
				result: team,
			};
		});
		log.info("agent team deleted", { teamId: deleted.id, revision: deleted.revision });
	}

	private createTeamCopy(source: AgentProfile, teamId: string, now: number): AgentProfile {
		return {
			...source,
			id: this.createId(),
			revision: 1,
			scope: { kind: "team", teamId },
			copiedFrom: source.id,
			createdAt: now,
			updatedAt: now,
		};
	}

	private ensureUniqueHandle(document: AgentTeamDocument, handle: string, exceptId: string | undefined): void {
		if (!handle) throw new Error("Mention handle must not be empty");
		if (document.agents.some((agent) => agent.id !== exceptId && agent.mentionHandle === handle))
			throw new Error(`Mention handle already exists: ${handle}`);
	}

	private mutate<TResult>(
		operationName: string,
		apply: (document: AgentTeamDocument) => { readonly document: AgentTeamDocument; readonly result: TResult },
	): Promise<TResult> {
		const operation = this.mutationTail
			.catch(() => undefined)
			.then(async () => {
				const current = await this.read();
				const mutation = apply(current);
				const normalized = parseAgentTeamDocument(
					{ ...mutation.document, schemaVersion: AGENT_TEAM_SCHEMA_VERSION },
					this.extensions,
				);
				try {
					await this.repository.write(normalized);
				} catch (error) {
					log.error("failed to persist agent team configuration", {
						operation: operationName,
						revision: normalized.revision,
						error: errorMessage(error),
					});
					throw error;
				}
				this.document = normalized;
				return mutation.result;
			});
		this.mutationTail = operation.then(
			() => undefined,
			() => undefined,
		);
		return operation;
	}
}

export const agentTeamStore = new AgentTeamStore({ extensions: agentTeamExtensionHost });

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * 任务书留空即取消覆盖：空白字段一律折算成缺省，不落成空串。
 * 空串会让下游 `?? profile.description` 与 `if (instructions)` 的兜底同时失效。
 */
function normalizeTeamMemberAssignment(input: TeamMemberAssignment | undefined): TeamMemberAssignment | undefined {
	const responsibility = input?.responsibility?.trim();
	const instructions = input?.instructions?.trim();
	if (!responsibility && !instructions) return undefined;
	return { ...(responsibility ? { responsibility } : {}), ...(instructions ? { instructions } : {}) };
}

function cloneExtensions(extensions: Readonly<Record<string, readonly string[]>>): Record<string, string[]> {
	return Object.fromEntries(Object.entries(extensions).map(([id, values]) => [id, [...values]]));
}

function createAgentAbilities(
	input: CreateAgentProfileInput["abilities"],
	defaults: AgentProfile["abilities"],
): AgentProfile["abilities"] {
	const source = input ?? defaults;
	return {
		selectionMode: input?.selectionMode ?? (input ? "custom" : (defaults.selectionMode ?? "custom")),
		skills: [...(source.skills ?? defaults.skills)],
		mcpServers: [...(source.mcpServers ?? defaults.mcpServers)],
		plugins: [...(source.plugins ?? defaults.plugins)],
		...(source.extensions ? { extensions: cloneExtensions(source.extensions) } : {}),
	};
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) return false;
	const rightSet = new Set(right);
	return left.every((id) => rightSet.has(id));
}
