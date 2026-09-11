import type { AgentTeamDocument } from "@vetta/agent-team";
import type { AgentConfigurationSelection } from "@vetta/coding-agent/profile";
import { toAgentConfigurationOverrides } from "../agent-teams/agent-ability-overrides.js";
import { pinnedAbilityContext, resolveAgentBlueprint } from "../agent-teams/agent-blueprint-registry.js";

/** 会话绑定的 Agent 折算出的会话输入；能力裁剪始终在主进程完成，渲染层只传身份。 */
export interface ResolvedSessionAgentProfile {
	readonly agentProfileId: string;
	readonly agentConfiguration: AgentConfigurationSelection;
	readonly systemPromptVolatileAddon: string;
}

/**
 * 按 Agent Profile 身份解析出本次会话的人格与能力白名单。
 *
 * 与 Team 成员同源：system prompt 走 addon 而非替换（基座 Coding Agent 提示词保留），
 * 能力覆盖复用 {@link toAgentConfigurationOverrides}。每次打开会话都重新解析，
 * 因此改了 Agent 的技能 / MCP 勾选，重开会话即生效。
 *
 * profile 不存在时返回 undefined，由调用方决定「新建即报错」还是「恢复则降级」。
 */
export async function resolveSessionAgentProfile(input: {
	readonly agentProfileId: string;
	readonly readDocument: () => Promise<AgentTeamDocument>;
}): Promise<ResolvedSessionAgentProfile | undefined> {
	const document = await input.readDocument();
	const profile = document.agents.find((candidate) => candidate.id === input.agentProfileId);
	if (!profile) return undefined;
	const blueprint = resolveAgentBlueprint(profile.blueprintId);
	const systemPrompt = profile.systemPrompt ?? blueprint?.systemPrompt;
	if (!systemPrompt) return undefined;
	return {
		agentProfileId: profile.id,
		agentConfiguration: {
			template: null,
			overrides: toAgentConfigurationOverrides(profile.abilities, pinnedAbilityContext(blueprint)),
		},
		systemPromptVolatileAddon: systemPrompt,
	};
}
