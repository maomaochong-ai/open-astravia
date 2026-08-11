import { isCodingAgentKnowledgeWikiPath, isCodingAgentProtectedSkillOrScenePath } from "./path-policy-boundaries.js";

export interface RuntimeEditPathPolicy {
	readonly getRejectionReason: (absolutePath: string) => string | undefined;
}

export function createCodingAgentEditPathPolicy(cwd: string): RuntimeEditPathPolicy {
	return {
		getRejectionReason: (absolutePath) => {
			if (isCodingAgentProtectedSkillOrScenePath(absolutePath, cwd)) {
				return (
					`"${absolutePath}" is inside a skill/scene directory which is read-only. ` +
					"Skills and scenes are global resources — never modify them. " +
					"Write output files to the user's working directory instead."
				);
			}
			if (isCodingAgentKnowledgeWikiPath(absolutePath)) {
				return (
					`"${absolutePath}" is inside the knowledge base wiki/ directory, which is managed exclusively by kb_write_page. ` +
					"Never hand-edit wiki pages with edit — use kb_write_page so each page keeps a validated frontmatter schema and stable id. " +
					"Scripts and scratch files may be edited elsewhere (e.g. the working directory)."
				);
			}
			return undefined;
		},
	};
}
