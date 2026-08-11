import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, getKnowledgeDir, getSceneDir, getUserSkillsDir } from "../../config.js";

export function isCodingAgentProtectedSkillOrScenePath(absolutePath: string, cwd: string): boolean {
	const protectedDirectories = [
		join(getAgentDir(), "skills"),
		getUserSkillsDir(),
		getSceneDir(),
		join(cwd, CONFIG_DIR_NAME, "skills"),
		join(homedir(), ".agents", "skills"),
		join(cwd, ".agents", "skills"),
	];
	return protectedDirectories.some((directory) => isPathInside(absolutePath, directory));
}

export function isCodingAgentKnowledgeWikiPath(absolutePath: string): boolean {
	return isPathInside(absolutePath, join(getKnowledgeDir(), "wiki"));
}

function isPathInside(absolutePath: string, directory: string): boolean {
	const resolvedPath = resolve(absolutePath);
	const resolvedDirectory = resolve(directory);
	const prefix = resolvedDirectory.endsWith(sep) ? resolvedDirectory : `${resolvedDirectory}${sep}`;
	return resolvedPath === resolvedDirectory || resolvedPath.startsWith(prefix);
}
