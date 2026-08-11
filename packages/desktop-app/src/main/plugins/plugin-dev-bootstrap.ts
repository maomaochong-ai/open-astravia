import { readFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { startPluginDevWatch } from "./plugin-dev-watch.js";

export interface PluginDevProject {
	id: string;
	projectDir: string;
}

export interface PluginDevBootstrapFailure {
	project: PluginDevProject;
	error: Error;
}

export interface PluginDevBootstrapResult {
	ready: PluginDevProject[];
	failures: PluginDevBootstrapFailure[];
}

const START_CONCURRENCY = 4;

export interface ResolvePluginDevProjectsOptions {
	desktopAppDir: string;
	pluginIds: readonly string[];
	pluginRoots: readonly string[];
}

async function readProjectId(projectDir: string): Promise<string> {
	let value: unknown;
	try {
		value = JSON.parse(await readFile(join(projectDir, "plugin.json"), "utf8"));
	} catch (error) {
		throw new Error(`Invalid plugin development project at ${projectDir}`, { cause: error });
	}
	if (value === null || typeof value !== "object" || !("id" in value) || typeof value.id !== "string") {
		throw new Error(`Plugin development manifest has no id: ${projectDir}`);
	}
	return value.id;
}

export async function resolveConfiguredPluginDevProjects(
	options: ResolvePluginDevProjectsOptions,
): Promise<PluginDevProject[]> {
	const pluginsDir = resolve(options.desktopAppDir, "..", "plugins");
	const projects: PluginDevProject[] = [];
	for (const rawId of options.pluginIds) {
		const id = rawId.trim();
		if (!id) continue;
		const candidates = [join(pluginsDir, "presets", id), join(pluginsDir, "externals", id)];
		let matched: PluginDevProject | undefined;
		for (const projectDir of candidates) {
			try {
				if ((await readProjectId(projectDir)) === id) {
					matched = { id, projectDir };
					break;
				}
			} catch {
				// Try the other repository plugin location before reporting the requested id as missing.
			}
		}
		if (!matched) throw new Error(`Plugin development project not found: ${id}`);
		projects.push(matched);
	}
	for (const rawRoot of options.pluginRoots) {
		const normalizedRoot = rawRoot.trim();
		if (!normalizedRoot) continue;
		const projectDir = resolve(normalizedRoot);
		projects.push({ id: await readProjectId(projectDir), projectDir });
	}

	const seen = new Set<string>();
	for (const project of projects) {
		if (seen.has(project.id)) throw new Error(`Duplicate plugin development id: ${project.id}`);
		seen.add(project.id);
	}
	return projects;
}

function splitValues(value: string | undefined, separator: string): string[] {
	return value
		? value
				.split(separator)
				.map((item) => item.trim())
				.filter(Boolean)
		: [];
}

export async function startConfiguredPluginDevWatches(
	desktopAppDir: string,
	environment: NodeJS.ProcessEnv = process.env,
): Promise<PluginDevBootstrapResult> {
	const projects = await resolveConfiguredPluginDevProjects({
		desktopAppDir,
		pluginIds: splitValues(environment.VETTA_PLUGIN_DEV, ","),
		pluginRoots: splitValues(environment.VETTA_PLUGIN_DEV_ROOTS, delimiter),
	});
	const ready: PluginDevProject[] = [];
	const failures: PluginDevBootstrapFailure[] = [];
	for (let offset = 0; offset < projects.length; offset += START_CONCURRENCY) {
		const batch = projects.slice(offset, offset + START_CONCURRENCY);
		const results = await Promise.allSettled(
			batch.map((project) =>
				Promise.resolve().then(() =>
					startPluginDevWatch(project.id, project.projectDir, {
						allowUninstalled: true,
					}),
				),
			),
		);
		for (const [index, result] of results.entries()) {
			const project = batch[index];
			if (!project) continue;
			if (result.status === "fulfilled") ready.push(project);
			else {
				failures.push({
					project,
					error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
				});
			}
		}
	}
	return { ready, failures };
}
