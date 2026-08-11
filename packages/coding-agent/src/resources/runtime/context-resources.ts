import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import chalk from "chalk";
import { CONFIG_DIR_NAME } from "../../config.js";

export function resolvePromptInput(input: string | undefined, description: string): string | undefined {
	if (!input) return undefined;
	if (!existsSync(input)) return input;
	try {
		return readFileSync(input, "utf-8");
	} catch (error) {
		console.error(chalk.yellow(`Warning: Could not read ${description} file ${input}: ${error}`));
		return input;
	}
}

function loadContextFileFromDir(dir: string): { path: string; content: string } | null {
	for (const filename of ["AGENTS.md", "CLAUDE.md"]) {
		const filePath = join(dir, filename);
		if (!existsSync(filePath)) continue;
		try {
			return { path: filePath, content: readFileSync(filePath, "utf-8") };
		} catch (error) {
			console.error(chalk.yellow(`Warning: Could not read ${filePath}: ${error}`));
		}
	}
	return null;
}

export function loadProjectContextFiles(cwd: string, agentDir: string): Array<{ path: string; content: string }> {
	const files: Array<{ path: string; content: string }> = [];
	const seen = new Set<string>();
	const globalContext = loadContextFileFromDir(agentDir);
	if (globalContext) {
		files.push(globalContext);
		seen.add(globalContext.path);
	}
	const ancestors: Array<{ path: string; content: string }> = [];
	let currentDir = cwd;
	const root = resolve("/");
	while (true) {
		const context = loadContextFileFromDir(currentDir);
		if (context && !seen.has(context.path)) {
			ancestors.unshift(context);
			seen.add(context.path);
		}
		if (currentDir === root) break;
		const parentDir = resolve(currentDir, "..");
		if (parentDir === currentDir) break;
		currentDir = parentDir;
	}
	files.push(...ancestors);
	return files;
}

export function discoverPromptFile(cwd: string, agentDir: string, filename: string): string | undefined {
	const projectPath = join(cwd, CONFIG_DIR_NAME, filename);
	if (existsSync(projectPath)) return projectPath;
	const globalPath = join(agentDir, filename);
	return existsSync(globalPath) ? globalPath : undefined;
}
