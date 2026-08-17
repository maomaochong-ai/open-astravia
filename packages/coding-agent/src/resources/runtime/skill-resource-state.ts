import type { ResourceDiagnostic } from "../contracts/diagnostics.js";
import type { ResourceAccessPort } from "../contracts/resource-access.js";
import { loadSkills, type Skill } from "../skills/index.js";

const PROJECT_CONFIG_DIRECTORY = ".vetta";

export async function computeSkillsFingerprint(
	access: ResourceAccessPort,
	paths: readonly string[],
	options: {
		cwd: string;
		agentDir: string;
		includeDefaults: boolean;
		includeAgentSkills: boolean;
		manifestPath: string;
		signal?: AbortSignal;
	},
): Promise<string> {
	const parts: string[] = [];
	const visited = new Set<string>();
	const walk = async (target: string): Promise<void> => {
		const resolved = access.paths.resolve(target);
		let identity = resolved;
		try {
			identity = await access.files.realPath(resolved, { signal: options.signal });
		} catch {
			options.signal?.throwIfAborted();
		}
		if (visited.has(identity)) return;
		visited.add(identity);
		const info = await access.files.stat(resolved, { signal: options.signal });
		if (!info) {
			parts.push(`X:${resolved}`);
			return;
		}
		if (info.kind === "directory") {
			parts.push(`D:${resolved}:${info.modifiedAtMs}`);
			try {
				const entries = [...(await access.files.readDirectory(resolved, { signal: options.signal }))].sort((a, b) =>
					a.name.localeCompare(b.name),
				);
				for (const entry of entries) {
					if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
						await walk(access.paths.join(resolved, entry.name));
					}
				}
			} catch {
				options.signal?.throwIfAborted();
			}
		} else if (info.kind === "file") {
			parts.push(`F:${resolved}:${info.modifiedAtMs}:${info.size}`);
		}
	};
	for (const path of paths) await walk(path);
	if (options.includeDefaults) {
		await walk(access.paths.join(options.agentDir, "skills"));
		await walk(access.paths.join(options.cwd, PROJECT_CONFIG_DIRECTORY, "skills"));
	}
	if (options.includeAgentSkills) {
		await walk(access.paths.join(access.paths.homeDirectory(), ".agents", "skills"));
		await walk(access.paths.join(options.cwd, ".agents", "skills"));
	}
	const manifest = await access.files.stat(options.manifestPath, { signal: options.signal });
	parts.push(
		manifest?.kind === "file" ? `M:${options.manifestPath}:${manifest.modifiedAtMs}:${manifest.size}` : "M:none",
	);
	return parts.join("\n");
}

export async function loadSkillResources(options: {
	resourceAccess: ResourceAccessPort;
	cwd: string;
	agentDir: string;
	sceneDir: string;
	managedSkillsDir: string;
	manifestPath: string;
	paths: readonly string[];
	includeAgentSkills: boolean;
	disabled: boolean;
	signal?: AbortSignal;
	override?: (base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
		skills: Skill[];
		diagnostics: ResourceDiagnostic[];
	};
}): Promise<{ skills: Skill[]; diagnostics: ResourceDiagnostic[] }> {
	const loaded =
		options.disabled && options.paths.length === 0
			? { skills: [], diagnostics: [] }
			: await loadSkills({
					resourceAccess: options.resourceAccess,
					cwd: options.cwd,
					agentDir: options.agentDir,
					sceneDir: options.sceneDir,
					skillPaths: options.paths,
					includeDefaults: false,
					includeAgentSkills: options.includeAgentSkills,
					signal: options.signal,
				});
	const paths = options.resourceAccess.paths;
	const sceneDir = paths.resolve(options.sceneDir);
	let skills = loaded.skills.map((skill) => {
		const filePath = paths.resolve(skill.filePath);
		return filePath === sceneDir || filePath.startsWith(`${sceneDir}${paths.separator}`)
			? { ...skill, type: "scene" as const, source: "scene" }
			: skill;
	});
	const disabledNames = await readDisabledMarketSkillNames(
		options.resourceAccess,
		options.manifestPath,
		options.signal,
	);
	if (disabledNames.size > 0) {
		const managedSkillsDir = paths.resolve(options.managedSkillsDir);
		skills = skills.filter((skill) => {
			const filePath = paths.resolve(skill.filePath);
			const managed =
				filePath === managedSkillsDir ||
				filePath.startsWith(`${managedSkillsDir}${paths.separator}`) ||
				filePath === sceneDir ||
				filePath.startsWith(`${sceneDir}${paths.separator}`);
			return !managed || !disabledNames.has(skill.name);
		});
	}
	const result = options.override
		? options.override({ skills, diagnostics: loaded.diagnostics })
		: { skills, diagnostics: loaded.diagnostics };
	const bySource: Record<string, number> = {};
	for (const skill of result.skills) bySource[skill.source] = (bySource[skill.source] ?? 0) + 1;
	console.info("[skills] loaded", {
		cwd: options.cwd,
		includeAgentSkills: options.includeAgentSkills,
		total: result.skills.length,
		bySource,
		names: result.skills.map((skill) => skill.name),
	});
	return result;
}

async function readDisabledMarketSkillNames(
	access: ResourceAccessPort,
	manifestPath: string,
	signal?: AbortSignal,
): Promise<Set<string>> {
	try {
		if ((await access.files.stat(manifestPath, { signal }))?.kind !== "file") return new Set();
		const manifest = JSON.parse(await access.files.readText(manifestPath, { signal })) as Record<
			string,
			{ enabled?: boolean }
		>;
		return new Set(
			Object.entries(manifest)
				.filter(([, entry]) => entry.enabled === false)
				.map(([name]) => name),
		);
	} catch {
		signal?.throwIfAborted();
		return new Set();
	}
}
