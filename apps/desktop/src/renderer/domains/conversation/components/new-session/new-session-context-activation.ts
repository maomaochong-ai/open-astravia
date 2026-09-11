import type { RegisteredNewSessionContext } from "@shared/store/plugin-atoms";
import type { AgentProfile, TeamDefinition } from "@vetta/agent-team";
import { parsePluginBlueprintId } from "@vetta/agent-team";

/**
 * 激活强度：决定多个贡献同时上屏时的 tab 顺序。
 *
 * 用户选中的目标所属插件排在提及能力之前——选了设计师，设计资源就该是第一个 tab，
 * 而不是因为另一个插件装得早就抢到首位。
 */
export type NewSessionContextActivationStrength = "target" | "mention";

export interface ActiveNewSessionContext {
	readonly contribution: RegisteredNewSessionContext;
	readonly strength: NewSessionContextActivationStrength;
	/** 命中的本插件能力，交给 render 的上下文用。 */
	readonly mentionedSkills: readonly string[];
	readonly mentionedMcpServers: readonly string[];
	/** 选中的目标若由本插件贡献，这里是它在 manifest 里的 id。 */
	readonly targetContributedId?: string;
}

export interface ResolveNewSessionContextsInput {
	readonly contributions: readonly RegisteredNewSessionContext[];
	/** 当前选中的智能体档案；选的是团队或什么都没选时为 undefined。 */
	readonly targetAgent?: AgentProfile;
	readonly targetTeam?: TeamDefinition;
	/** 解析团队成员用：档案 id → 档案。 */
	readonly agentsById?: ReadonlyMap<string, AgentProfile>;
	/** 输入框里提到的 skill 名。 */
	readonly mentionedSkills?: readonly string[];
	readonly mentionedMcpServers?: readonly string[];
}

/**
 * 裁决哪些插件贡献该出现在新会话上下文区，以及以什么顺序出现。
 *
 * 裁决权在宿主而不是插件：插件若能自行决定上屏，就得把用户逐键输入的内容推给每一个注册
 * 了本槽位的插件。声明式条件让插件只在自己相关时才被唤醒，也让 tab 顺序可预期。
 */
export function resolveNewSessionContexts(input: ResolveNewSessionContextsInput): readonly ActiveNewSessionContext[] {
	const active: ActiveNewSessionContext[] = [];

	for (const contribution of input.contributions) {
		const targetContributedId = matchTarget(contribution, input);
		const mentionedSkills = intersect(contribution.activateWhen.skills, input.mentionedSkills);
		const mentionedMcpServers = intersect(contribution.activateWhen.mcpServers, input.mentionedMcpServers);
		const mentioned = mentionedSkills.length > 0 || mentionedMcpServers.length > 0;
		if (targetContributedId === undefined && !mentioned) continue;
		active.push({
			contribution,
			strength: targetContributedId !== undefined ? "target" : "mention",
			mentionedSkills,
			mentionedMcpServers,
			...(targetContributedId ? { targetContributedId } : {}),
		});
	}

	return active.sort(compareActivations);
}

/** 命中返回该目标在插件 manifest 里的 id（团队成员命中时是那个成员的 agent id）。 */
function matchTarget(
	contribution: RegisteredNewSessionContext,
	input: ResolveNewSessionContextsInput,
): string | undefined {
	const { agents, teams } = contribution.activateWhen;

	if (input.targetAgent) {
		const parsed = parsePluginBlueprintId(input.targetAgent.blueprintId);
		if (!parsed || parsed.pluginId !== contribution.pluginId) return undefined;
		// agents 省略表示「本插件的任意智能体」。
		if (agents && !agents.includes(parsed.agentId)) return undefined;
		return parsed.agentId;
	}

	if (input.targetTeam) {
		// 团队按成员推导：只要队里有本插件贡献的角色就算相关，插件不必重复声明团队 id。
		for (const member of input.targetTeam.members) {
			const profile = input.agentsById?.get(member.binding.agentProfileId);
			const parsed = profile ? parsePluginBlueprintId(profile.blueprintId) : undefined;
			if (!parsed || parsed.pluginId !== contribution.pluginId) continue;
			if (agents && !agents.includes(parsed.agentId)) continue;
			if (teams && !teams.includes(input.targetTeam.id)) continue;
			return parsed.agentId;
		}
	}

	return undefined;
}

function intersect(declared: readonly string[] | undefined, mentioned: readonly string[] | undefined): string[] {
	if (!declared || declared.length === 0 || !mentioned || mentioned.length === 0) return [];
	const wanted = new Set(declared);
	return [...new Set(mentioned.filter((name) => wanted.has(name)))];
}

function compareActivations(left: ActiveNewSessionContext, right: ActiveNewSessionContext): number {
	if (left.strength !== right.strength) return left.strength === "target" ? -1 : 1;
	// 同强度按插件 id 稳定排序，再按贡献注册顺序——同一插件的多个 tab 保持相邻。
	const byPlugin = left.contribution.pluginId.localeCompare(right.contribution.pluginId);
	return byPlugin !== 0 ? byPlugin : left.contribution.order - right.contribution.order;
}
