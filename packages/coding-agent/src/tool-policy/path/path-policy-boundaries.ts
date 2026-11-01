/** Host-owned path classification consumed by Coding Agent policies. */
export interface CodingAgentPathPolicyBoundaries {
	readonly isProtectedSkillPath: (absolutePath: string) => boolean;
	readonly isKnowledgeWikiPath: (absolutePath: string) => boolean;
}
