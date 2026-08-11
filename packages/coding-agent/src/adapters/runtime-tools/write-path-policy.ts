import { isCodingAgentKnowledgeWikiPath, isCodingAgentProtectedSkillOrScenePath } from "./path-policy-boundaries.js";

export interface RuntimeWritePathPolicy {
	readonly getRejectionReason: (absolutePath: string) => string | undefined;
}

export function createCodingAgentWritePathPolicy(cwd: string): RuntimeWritePathPolicy {
	return {
		getRejectionReason: (absolutePath) => {
			if (isCodingAgentProtectedSkillOrScenePath(absolutePath, cwd)) {
				return (
					`Error: "${absolutePath}" is inside a skill/scene directory which is read-only. ` +
					"Skills and scenes are global resources — never write artifacts into them. " +
					"Write output files to the user's working directory instead."
				);
			}
			if (isCodingAgentKnowledgeWikiPath(absolutePath)) {
				return (
					`Error: "${absolutePath}" is inside the knowledge base wiki/ directory, which is managed exclusively by the kb_write_page tool. ` +
					"Never hand-write wiki pages with write — use kb_write_page so each page gets a validated frontmatter schema and a stable id. " +
					"Scripts, scratch files, and parsed outputs may be written elsewhere (e.g. the working directory)."
				);
			}
			return undefined;
		},
	};
}
