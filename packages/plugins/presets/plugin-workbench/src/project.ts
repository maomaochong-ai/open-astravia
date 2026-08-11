import { PLUGIN_PERMISSIONS, type PluginPermission } from "@vetta-org/plugin-sdk";
import { getWorkbenchFs, getWorkbenchPlugins, withWorkbenchFs } from "./runtime";

const pluginPermissionSet = new Set<string>(PLUGIN_PERMISSIONS);

function isPluginPermission(value: unknown): value is PluginPermission {
	return typeof value === "string" && pluginPermissionSet.has(value);
}

export interface ProjectInfo {
	dir: string;
	id: string;
	name: string;
	version: string;
	guidingWords: string[];
	permissions: PluginPermission[];
	zipPath: string | null;
}

export function joinPath(base: string, ...parts: string[]): string {
	const sep = base.includes("\\") ? "\\" : "/";
	let out = base.replace(/[/\\]+$/, "");
	for (const p of parts) {
		out = `${out}${sep}${p.replace(/^[/\\]+/, "")}`;
	}
	return out;
}

export async function readJson(path: string): Promise<Record<string, unknown> | null> {
	try {
		const file = await withWorkbenchFs((fs) => fs.readFile(path));
		return JSON.parse(file.content) as Record<string, unknown>;
	} catch {
		return null;
	}
}

export async function discoverProjects(cwd: string): Promise<ProjectInfo[]> {
	const fs = getWorkbenchFs();
	const candidates: string[] = [cwd];
	try {
		const entries = await fs.readDir(cwd);
		for (const e of entries) {
			if (e.isDirectory && e.name !== "node_modules" && e.name !== "dist" && e.name !== ".git") {
				candidates.push(e.path || joinPath(cwd, e.name));
			}
		}
	} catch {
		// cwd unreadable
	}

	const projects: ProjectInfo[] = [];
	for (const dir of candidates) {
		const manifest = await readJson(joinPath(dir, "plugin.json"));
		if (!manifest || typeof manifest.id !== "string") continue;
		const id = manifest.id;
		const version = typeof manifest.version === "string" ? manifest.version : "0.0.0";
		const name = typeof manifest.name === "string" ? manifest.name : id;
		const guidingWords = Array.isArray(manifest.guidingWords)
			? manifest.guidingWords.filter((w): w is string => typeof w === "string")
			: [];
		const permissions = Array.isArray(manifest.permissions)
			? manifest.permissions.filter(isPluginPermission)
			: [];
		const zipPath = joinPath(dir, "release", `${id}-${version}.zip`);
		let zipExists = false;
		try {
			zipExists = (await fs.stat(zipPath)) != null;
		} catch {
			zipExists = false;
		}
		projects.push({
			dir,
			id,
			name,
			version,
			guidingWords,
			permissions,
			zipPath: zipExists ? zipPath : null,
		});
	}
	return projects;
}

export async function resolveWorkbenchRoot(): Promise<string> {
	const list = await getWorkbenchPlugins().list();
	const wb = list.find((p) => p.id === "plugin-workbench");
	if (!wb?.rootPath) throw new Error("plugin-workbench rootPath missing");
	return wb.rootPath;
}

export async function findProjectById(cwd: string, pluginId: string): Promise<ProjectInfo | null> {
	const projects = await discoverProjects(cwd);
	return projects.find((p) => p.id === pluginId) ?? null;
}
