import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createNodePathBoundaryClassifier } from "@vetta/runtime-node/coding";
import { CONFIG_DIR_NAME } from "../../../identity.js";
import type { CodingAgentPathPolicyBoundaries } from "../../../tool-policy/path/path-policy-boundaries.js";
import { getAgentDir, getKnowledgeDir, getSceneDir, getUserSkillsDir } from "../../node-config.js";

export interface CodingAgentNodePathPolicy {
	readonly boundaries: CodingAgentPathPolicyBoundaries;
	readonly protectedCommandDirectories: readonly string[];
}

/** @deprecated Compatibility path layout for Coding Agent's remaining embedded Node hosts. */
export function createCodingAgentNodePathPolicy(cwd: string): CodingAgentNodePathPolicy {
	const protectedCommandDirectories = [
		resolve(join(getAgentDir(), "skills")),
		resolve(getUserSkillsDir()),
		resolve(getSceneDir()),
		resolve(cwd, CONFIG_DIR_NAME, "skills"),
	];
	return {
		protectedCommandDirectories,
		boundaries: adaptNodePathBoundaries(
			createNodePathBoundaryClassifier({
				readOnlyDirectories: [
					...protectedCommandDirectories,
					resolve(homedir(), ".agents", "skills"),
					resolve(cwd, ".agents", "skills"),
				],
				managedDirectory: join(getKnowledgeDir(), "wiki"),
			}),
		),
	};
}

function adaptNodePathBoundaries(
	classifier: ReturnType<typeof createNodePathBoundaryClassifier>,
): CodingAgentPathPolicyBoundaries {
	return {
		isProtectedSkillOrScenePath: classifier.isReadOnlyPath,
		isKnowledgeWikiPath: classifier.isManagedPath,
	};
}
