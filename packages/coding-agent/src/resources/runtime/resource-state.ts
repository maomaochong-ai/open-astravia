import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { CONFIG_DIR_NAME, getSceneDir, getVettaHomePath } from "../../config.js";
import type { ResourceDiagnostic } from "../contracts/diagnostics.js";
import type { ResolvedResourcePath, ResourcePathMetadata } from "../contracts/resource-source.js";
import { loadPromptTemplates, type PromptTemplate } from "../prompts/index.js";
import { loadSkills, type Skill } from "../skills/index.js";

export function resolveResourcePath(cwd: string, path: string): string {
	const trimmed = path.trim();
	const expanded =
		trimmed === "~"
			? homedir()
			: trimmed.startsWith("~/")
				? join(homedir(), trimmed.slice(2))
				: trimmed.startsWith("~")
					? join(homedir(), trimmed.slice(1))
					: trimmed;
	return resolve(cwd, expanded);
}

export function mergeResourcePaths(cwd: string, primary: string[], additional: string[]): string[] {
	const merged: string[] = [];
	const seen = new Set<string>();
	for (const path of [...primary, ...additional]) {
		const resolved = resolveResourcePath(cwd, path);
		if (!seen.has(resolved)) {
			seen.add(resolved);
			merged.push(resolved);
		}
	}
	return merged;
}

export function computeSkillsFingerprint(
	paths: string[],
	options: { cwd: string; agentDir: string; includeDefaults: boolean; includeAgentSkills: boolean },
): string {
	const parts: string[] = [];
	const visited = new Set<string>();
	const walk = (target: string): void => {
		let resolved: string;
		try {
			resolved = resolve(target);
		} catch {
			parts.push(`X:${target}`);
			return;
		}
		if (visited.has(resolved)) return;
		visited.add(resolved);
		let stats: ReturnType<typeof statSync>;
		try {
			stats = statSync(resolved);
		} catch {
			parts.push(`X:${resolved}`);
			return;
		}
		if (stats.isDirectory()) {
			parts.push(`D:${resolved}:${stats.mtimeMs}`);
			let entries: string[];
			try {
				entries = readdirSync(resolved).sort();
			} catch {
				return;
			}
			for (const name of entries) {
				if (!name.startsWith(".") && name !== "node_modules") walk(join(resolved, name));
			}
		} else if (stats.isFile()) parts.push(`F:${resolved}:${stats.mtimeMs}:${stats.size}`);
	};
	for (const path of paths) walk(path);
	if (options.includeDefaults) {
		walk(join(options.agentDir, "skills"));
		walk(join(options.cwd, CONFIG_DIR_NAME, "skills"));
	}
	if (options.includeAgentSkills) {
		walk(join(homedir(), ".agents", "skills"));
		walk(join(options.cwd, ".agents", "skills"));
	}
	const manifestPath = join(getVettaHomePath(), "skills-manifest.json");
	try {
		const stats = statSync(manifestPath);
		parts.push(`M:${manifestPath}:${stats.mtimeMs}:${stats.size}`);
	} catch {
		parts.push("M:none");
	}
	return parts.join("\n");
}

export function loadSkillResources(options: {
	cwd: string;
	agentDir: string;
	paths: string[];
	includeAgentSkills: boolean;
	disabled: boolean;
	override?: (base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
		skills: Skill[];
		diagnostics: ResourceDiagnostic[];
	};
}): { skills: Skill[]; diagnostics: ResourceDiagnostic[] } {
	let result =
		options.disabled && options.paths.length === 0
			? { skills: [], diagnostics: [] }
			: loadSkills({
					cwd: options.cwd,
					agentDir: options.agentDir,
					skillPaths: options.paths,
					includeDefaults: false,
					includeAgentSkills: options.includeAgentSkills,
				});
	const sceneDir = resolve(getSceneDir());
	for (const skill of result.skills) {
		const filePath = resolve(skill.filePath);
		if (filePath === sceneDir || filePath.startsWith(`${sceneDir}${sep}`)) {
			skill.type = "scene";
			skill.source = "scene";
		}
	}
	const disabledNames = readDisabledMarketSkillNames();
	if (disabledNames.size > 0) {
		const marketSkillsDir = resolve(join(getVettaHomePath(), "skills"));
		result.skills = result.skills.filter((skill) => {
			const filePath = resolve(skill.filePath);
			const isMarketSkill =
				filePath === marketSkillsDir ||
				filePath.startsWith(`${marketSkillsDir}${sep}`) ||
				filePath === sceneDir ||
				filePath.startsWith(`${sceneDir}${sep}`);
			return !isMarketSkill || !disabledNames.has(skill.name);
		});
	}
	result = options.override ? options.override(result) : result;
	const bySource: Record<string, number> = {};
	for (const skill of result.skills)
		bySource[skill.source ?? "unknown"] = (bySource[skill.source ?? "unknown"] ?? 0) + 1;
	console.info("[skills] loaded", {
		cwd: options.cwd,
		includeAgentSkills: options.includeAgentSkills,
		total: result.skills.length,
		bySource,
		names: result.skills.map((skill) => skill.name),
	});
	return result;
}

function readDisabledMarketSkillNames(): Set<string> {
	const manifestPath = join(getVettaHomePath(), "skills-manifest.json");
	if (!existsSync(manifestPath)) return new Set();
	try {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, { enabled?: boolean }>;
		return new Set(
			Object.entries(manifest)
				.filter(([, entry]) => entry.enabled === false)
				.map(([name]) => name),
		);
	} catch {
		return new Set();
	}
}

export function loadPromptResources(options: {
	cwd: string;
	agentDir: string;
	paths: string[];
	disabled: boolean;
	override?: (base: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] }) => {
		prompts: PromptTemplate[];
		diagnostics: ResourceDiagnostic[];
	};
}): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] } {
	if (options.disabled && options.paths.length === 0) return { prompts: [], diagnostics: [] };
	const prompts = loadPromptTemplates({
		cwd: options.cwd,
		agentDir: options.agentDir,
		promptPaths: options.paths,
		includeDefaults: false,
	});
	const seen = new Map<string, PromptTemplate>();
	const diagnostics: ResourceDiagnostic[] = [];
	for (const prompt of prompts) {
		const existing = seen.get(prompt.name);
		if (existing) {
			diagnostics.push({
				type: "collision",
				message: `name "/${prompt.name}" collision`,
				path: prompt.filePath,
				collision: {
					resourceType: "prompt",
					name: prompt.name,
					winnerPath: existing.filePath,
					loserPath: prompt.filePath,
				},
			});
		} else seen.set(prompt.name, prompt);
	}
	const result = { prompts: Array.from(seen.values()), diagnostics };
	return options.override ? options.override(result) : result;
}

export class ResourceMetadataIndex {
	private entries = new Map<string, ResourcePathMetadata>();

	constructor(
		private readonly cwd: string,
		private readonly agentDir: string,
	) {}

	reset(): void {
		this.entries = new Map();
	}

	get(): Map<string, ResourcePathMetadata> {
		return this.entries;
	}

	enabled(resources: ResolvedResourcePath[]): ResolvedResourcePath[] {
		for (const resource of resources)
			if (!this.entries.has(resource.path)) this.entries.set(resource.path, resource.metadata);
		return resources.filter((resource) => resource.enabled);
	}

	apply(extensionPaths: Array<{ path: string; metadata: ResourcePathMetadata }>, resourcePaths: string[]): void {
		const normalized = extensionPaths.map((entry) => ({ path: resolve(entry.path), metadata: entry.metadata }));
		for (const entry of normalized) if (!this.entries.has(entry.path)) this.entries.set(entry.path, entry.metadata);
		for (const resourcePath of resourcePaths) {
			const path = resolve(resourcePath);
			if (this.entries.has(path) || this.entries.has(resourcePath)) continue;
			const match = normalized.find((entry) => path === entry.path || path.startsWith(`${entry.path}${sep}`));
			if (match) this.entries.set(path, match.metadata);
		}
	}

	addDefault(filePath: string): void {
		if (!filePath || filePath.startsWith("<")) return;
		const path = resolve(filePath);
		if (this.entries.has(path) || this.entries.has(filePath)) return;
		for (const [scope, base] of [
			["user", this.agentDir],
			["project", join(this.cwd, CONFIG_DIR_NAME)],
		] as const) {
			for (const kind of ["skills", "prompts", "themes", "extensions"]) {
				const root = resolve(base, kind);
				if (path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) {
					this.entries.set(path, { source: "local", scope, origin: "top-level" });
					return;
				}
			}
		}
	}
}
