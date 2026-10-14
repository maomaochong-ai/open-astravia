import chalk from "chalk";
import { CONFIG_DIR_NAME } from "../../identity.js";
import type { ResourceAccessPort } from "../contracts/resource-access.js";

export async function resolvePromptInput(
	access: ResourceAccessPort,
	input: string | undefined,
	description: string,
	signal?: AbortSignal,
): Promise<string | undefined> {
	if (!input) return undefined;
	if (!(await access.files.stat(input, { signal }))) return input;
	try {
		return await access.files.readText(input, { signal });
	} catch (error) {
		signal?.throwIfAborted();
		console.error(chalk.yellow(`Warning: Could not read ${description} file ${input}: ${error}`));
		return input;
	}
}

async function loadContextFilesFromDir(
	access: ResourceAccessPort,
	dir: string,
	signal?: AbortSignal,
): Promise<Array<{ path: string; content: string }>> {
	const files: Array<{ path: string; content: string }> = [];
	for (const filename of ["CLAUDE.md", "AGENTS.md"]) {
		const filePath = access.paths.join(dir, filename);
		if (!(await access.files.stat(filePath, { signal }))) continue;
		try {
			files.push({ path: filePath, content: await access.files.readText(filePath, { signal }) });
		} catch (error) {
			signal?.throwIfAborted();
			console.error(chalk.yellow(`Warning: Could not read ${filePath}: ${error}`));
		}
	}
	return files;
}

export async function loadProjectContextFiles(
	access: ResourceAccessPort,
	cwd: string,
	agentDir: string,
	signal?: AbortSignal,
): Promise<Array<{ path: string; content: string }>> {
	const files: Array<{ path: string; content: string }> = [];
	const seen = new Set<string>();
	const globalContext = await loadContextFilesFromDir(access, agentDir, signal);
	for (const context of globalContext) {
		files.push(context);
		seen.add(context.path);
	}
	const ancestors: Array<Array<{ path: string; content: string }>> = [];
	let currentDir = access.paths.resolve(cwd);
	while (true) {
		const contexts = await loadContextFilesFromDir(access, currentDir, signal);
		ancestors.unshift(contexts.filter((context) => !seen.has(context.path)));
		for (const context of contexts) seen.add(context.path);
		const parentDir = access.paths.dirname(currentDir);
		if (parentDir === currentDir) break;
		currentDir = parentDir;
	}
	files.push(...ancestors.flat());
	return files;
}

export async function discoverPromptFile(
	access: ResourceAccessPort,
	cwd: string,
	agentDir: string,
	filename: string,
	signal?: AbortSignal,
): Promise<string | undefined> {
	const projectPath = access.paths.join(cwd, CONFIG_DIR_NAME, filename);
	if (await access.files.stat(projectPath, { signal })) return projectPath;
	const globalPath = access.paths.join(agentDir, filename);
	return (await access.files.stat(globalPath, { signal })) ? globalPath : undefined;
}
