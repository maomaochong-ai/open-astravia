/** Host-owned path classification consumed by Coding Agent policies. */
export interface CodingAgentPathPolicyBoundaries {
	readonly isProtectedSkillOrScenePath: (absolutePath: string) => boolean;
	readonly isKnowledgeWikiPath: (absolutePath: string) => boolean;
}
