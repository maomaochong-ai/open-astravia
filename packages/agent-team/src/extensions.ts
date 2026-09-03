import type { ConversationMessageRecord } from "@vetta/runtime-core/conversation";
import type { TeamDefinition, TeamSharedContextRecord } from "./contracts.js";
import { projectPublicTeamCheckpointContext, projectPublicTeamContext } from "./public-context.js";
import type { TeamTaskAction } from "./task-control.js";

export interface TeamOrchestrationPolicy {
	readonly id: string;
	/** Omission retains the default leader/assignee permission boundary. */
	authorizeTask?(input: {
		readonly action: TeamTaskAction;
		readonly team: TeamDefinition;
		readonly sourceMemberId: string;
		readonly targetMemberId: string;
	}): boolean;
	resolveTargets(input: {
		readonly team: TeamDefinition;
		readonly requestedMemberIds: readonly string[];
	}): readonly string[];
}

export interface TeamContextProjectionPolicy {
	readonly id: string;
	/** Optional Team-wide projection. Omission falls back to the safe intersection of member projections. */
	projectSharedCheckpoint?(input: {
		readonly session: { readonly id: string };
		readonly messages: readonly ConversationMessageRecord[];
		readonly currentRequestId?: string;
	}): readonly TeamSharedContextRecord[];
	project(input: {
		readonly session: { readonly id: string };
		/** Ordinary coordination messages are the only current public-history source. */
		readonly messages: readonly ConversationMessageRecord[];
		readonly targetMemberId: string;
		readonly deliveredEventIds: ReadonlySet<string>;
		readonly currentRequestId?: string;
	}): readonly TeamSharedContextRecord[];
}

export interface AgentTeamExtensionRegistry {
	readonly orchestrationPolicies: ReadonlyMap<string, TeamOrchestrationPolicy>;
	readonly contextPolicies: ReadonlyMap<string, TeamContextProjectionPolicy>;
}

export interface AgentTeamExtensionContribution {
	readonly orchestrationPolicies?: ReadonlyMap<string, TeamOrchestrationPolicy>;
	readonly contextPolicies?: ReadonlyMap<string, TeamContextProjectionPolicy>;
}

const PUBLIC_RESULTS_ORCHESTRATION: TeamOrchestrationPolicy = {
	id: "leader-delegates-v1",
	resolveTargets({ team, requestedMemberIds }) {
		const requested = requestedMemberIds.length === 0 ? [team.leaderMemberId] : requestedMemberIds;
		const members = new Set(team.members.map((member) => member.id));
		const unique = [...new Set(requested)];
		for (const memberId of unique) {
			if (!members.has(memberId)) throw new Error(`Unknown team member: ${memberId}`);
		}
		return unique;
	},
};

const PUBLIC_RESULTS_CONTEXT: TeamContextProjectionPolicy = {
	id: "public-results-v1",
	projectSharedCheckpoint: projectPublicTeamCheckpointContext,
	project: projectPublicTeamContext,
};

export const DEFAULT_AGENT_TEAM_EXTENSIONS: AgentTeamExtensionRegistry = Object.freeze({
	orchestrationPolicies: new Map([[PUBLIC_RESULTS_ORCHESTRATION.id, PUBLIC_RESULTS_ORCHESTRATION]]),
	contextPolicies: new Map([[PUBLIC_RESULTS_CONTEXT.id, PUBLIC_RESULTS_CONTEXT]]),
});

export class AgentTeamExtensionRegistryHost implements AgentTeamExtensionRegistry {
	readonly orchestrationPolicies: Map<string, TeamOrchestrationPolicy>;
	readonly contextPolicies: Map<string, TeamContextProjectionPolicy>;

	constructor(base: AgentTeamExtensionRegistry = DEFAULT_AGENT_TEAM_EXTENSIONS) {
		this.orchestrationPolicies = new Map(base.orchestrationPolicies);
		this.contextPolicies = new Map(base.contextPolicies);
	}

	register(contribution: AgentTeamExtensionContribution, options: { readonly replace?: boolean } = {}): () => void {
		const orchestration = [...(contribution.orchestrationPolicies ?? [])];
		const context = [...(contribution.contextPolicies ?? [])];
		for (const [id, policy] of [...orchestration, ...context]) {
			if (id !== policy.id) throw new Error(`Agent Team policy key does not match its id: ${id}`);
		}
		if (!options.replace) {
			for (const [id] of orchestration) {
				if (this.orchestrationPolicies.has(id))
					throw new Error(`Agent Team orchestration policy already exists: ${id}`);
			}
			for (const [id] of context) {
				if (this.contextPolicies.has(id)) throw new Error(`Agent Team context policy already exists: ${id}`);
			}
		}

		const previousOrchestration = orchestration.map(([id]) => [id, this.orchestrationPolicies.get(id)] as const);
		const previousContext = context.map(([id]) => [id, this.contextPolicies.get(id)] as const);
		for (const [id, policy] of orchestration) this.orchestrationPolicies.set(id, policy);
		for (const [id, policy] of context) this.contextPolicies.set(id, policy);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			for (const [id, policy] of orchestration) {
				if (this.orchestrationPolicies.get(id) !== policy) continue;
				const previous = previousOrchestration.find(([candidate]) => candidate === id)?.[1];
				if (previous) this.orchestrationPolicies.set(id, previous);
				else this.orchestrationPolicies.delete(id);
			}
			for (const [id, policy] of context) {
				if (this.contextPolicies.get(id) !== policy) continue;
				const previous = previousContext.find(([candidate]) => candidate === id)?.[1];
				if (previous) this.contextPolicies.set(id, previous);
				else this.contextPolicies.delete(id);
			}
		};
	}
}

export function createAgentTeamExtensionRegistry(
	extensions: readonly AgentTeamExtensionContribution[] = [],
): AgentTeamExtensionRegistry {
	const host = new AgentTeamExtensionRegistryHost();
	for (const extension of extensions) host.register(extension, { replace: true });
	return Object.freeze({
		orchestrationPolicies: new Map(host.orchestrationPolicies),
		contextPolicies: new Map(host.contextPolicies),
	});
}

export function requireTeamPolicies(
	orchestrationPolicyId: string,
	contextPolicyId: string,
	registry: AgentTeamExtensionRegistry = DEFAULT_AGENT_TEAM_EXTENSIONS,
): void {
	if (!registry.orchestrationPolicies.has(orchestrationPolicyId)) {
		throw new Error(`Unknown team orchestration policy: ${orchestrationPolicyId}`);
	}
	if (!registry.contextPolicies.has(contextPolicyId)) {
		throw new Error(`Unknown team context policy: ${contextPolicyId}`);
	}
}

export function resolveTeamHandle(team: TeamDefinition, handle: string): string | undefined {
	const normalized = normalizeMentionHandle(handle);
	return team.members.find((member) => normalizeMentionHandle(member.handle) === normalized)?.id;
}

function normalizeMentionHandle(value: string): string {
	return value.normalize("NFKC").trim().replace(/^@+/, "").toLocaleLowerCase("en-US");
}
