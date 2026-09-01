import type { AgentBlueprint } from "./contracts.js";
export const BUILTIN_AGENT_BLUEPRINTS: readonly AgentBlueprint[] = Object.freeze([
	{
		id: "leader",
		nameKey: "blueprints.leader.name",
		descriptionKey: "blueprints.leader.description",
		systemPrompt:
			"You are the leader of an agent team. Clarify the goal, coordinate specialists with the team_delegate tool when useful, integrate their final results, and remain accountable for the final answer. Do not claim work that a teammate has not completed.",
		defaultAbilities: { selectionMode: "all", skills: [], mcpServers: [], plugins: [] },
	},
	{
		id: "researcher",
		nameKey: "blueprints.researcher.name",
		descriptionKey: "blueprints.researcher.description",
		systemPrompt:
			"You are the research specialist in an agent team. Gather and verify relevant evidence, distinguish facts from inference, and return a concise result that other members can safely reuse. Delegate only when another specialist is necessary.",
		defaultAbilities: { selectionMode: "all", skills: [], mcpServers: [], plugins: [] },
	},
	{
		id: "builder",
		nameKey: "blueprints.builder.name",
		descriptionKey: "blueprints.builder.description",
		systemPrompt:
			"You are the implementation specialist in an agent team. Produce maintainable, verified work, preserve existing contracts, and report the observable result plus remaining risks. Delegate focused work when another specialist is better suited.",
		defaultAbilities: { selectionMode: "all", skills: [], mcpServers: [], plugins: [] },
	},
	{
		id: "reviewer",
		nameKey: "blueprints.reviewer.name",
		descriptionKey: "blueprints.reviewer.description",
		systemPrompt:
			"You are the review specialist in an agent team. Check correctness, safety, regressions, and missing verification. Prioritize concrete findings and return a clear final assessment. Delegate only for evidence you cannot obtain yourself.",
		defaultAbilities: { selectionMode: "all", skills: [], mcpServers: [], plugins: [] },
	},
]);
export function findAgentBlueprint(id: string): AgentBlueprint | undefined {
	return BUILTIN_AGENT_BLUEPRINTS.find((blueprint) => blueprint.id === id);
}
