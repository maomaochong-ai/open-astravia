import ignore from "ignore";
import type { ResourceDiagnostic } from "../contracts/diagnostics.js";
import type { ResourceAccessPort } from "../contracts/resource-access.js";
import { parseFrontmatter } from "../shared/frontmatter.js";
import type {
	LoadSkillsFromDirOptions,
	LoadSkillsOptions,
	LoadSkillsResult,
	Skill,
	SkillFrontmatter,
	SkillType,
} from "./contracts.js";

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const IGNORE_FILE_NAMES = [".gitignore", ".ignore", ".fdignore"];
const PROJECT_CONFIG_DIRECTORY = ".vetta";
type IgnoreMatcher = ReturnType<typeof ignore>;

function toPosixPath(path: string, separator: string): string {
	return path.split(separator).join("/");
}

function prefixIgnorePattern(line: string, prefix: string): string | null {
	const trimmed = line.trim();
	if (!trimmed || (trimmed.startsWith("#") && !trimmed.startsWith("\\#"))) return null;
	let pattern = line;
	let negated = false;
	if (pattern.startsWith("!")) {
		negated = true;
		pattern = pattern.slice(1);
	} else if (pattern.startsWith("\\!")) {
		pattern = pattern.slice(1);
	}
	if (pattern.startsWith("/")) pattern = pattern.slice(1);
	const prefixed = prefix ? `${prefix}${pattern}` : pattern;
	return negated ? `!${prefixed}` : prefixed;
}

async function addIgnoreRules(
	access: ResourceAccessPort,
	matcher: IgnoreMatcher,
	dir: string,
	rootDir: string,
	signal?: AbortSignal,
): Promise<void> {
	const relativeDir = access.paths.relative(rootDir, dir);
	const prefix = relativeDir ? `${toPosixPath(relativeDir, access.paths.separator)}/` : "";
	for (const filename of IGNORE_FILE_NAMES) {
		const ignorePath = access.paths.join(dir, filename);
		try {
			if ((await access.files.stat(ignorePath, { signal }))?.kind !== "file") continue;
			const content = await access.files.readText(ignorePath, { signal });
			const patterns = content
				.split(/\r?\n/)
				.map((line) => prefixIgnorePattern(line, prefix))
				.filter((line): line is string => Boolean(line));
			if (patterns.length > 0) matcher.add(patterns);
		} catch {
			signal?.throwIfAborted();
		}
	}
}

function validateName(name: string, parentDirName: string): string[] {
	const errors: string[] = [];
	if (name !== parentDirName) errors.push(`name "${name}" does not match parent directory "${parentDirName}"`);
	if (name.length > MAX_NAME_LENGTH) errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`);
	if (!/^[a-z0-9-]+$/.test(name)) {
		errors.push("name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)");
	}
	if (name.startsWith("-") || name.endsWith("-")) errors.push("name must not start or end with a hyphen");
	if (name.includes("--")) errors.push("name must not contain consecutive hyphens");
	return errors;
}

function validateDescription(description: string | undefined): string[] {
	if (!description || description.trim() === "") return ["description is required"];
	return description.length > MAX_DESCRIPTION_LENGTH
		? [`description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`]
		: [];
}

async function readSceneTasks(
	access: ResourceAccessPort,
	baseDir: string,
	signal?: AbortSignal,
): Promise<readonly string[]> {
	const tasksPath = access.paths.join(baseDir, "tasks.json");
	try {
		if ((await access.files.stat(tasksPath, { signal }))?.kind !== "file") return [];
		const value: unknown = JSON.parse(await access.files.readText(tasksPath, { signal }));
		return Array.isArray(value) && value.every((task) => typeof task === "string") ? [...value] : [];
	} catch {
		signal?.throwIfAborted();
		return [];
	}
}

async function loadSkillFromFile(
	access: ResourceAccessPort,
	filePath: string,
	source: string,
	signal?: AbortSignal,
): Promise<{ skill: Skill | null; diagnostics: ResourceDiagnostic[] }> {
	const diagnostics: ResourceDiagnostic[] = [];
	try {
		const content = await access.files.readText(filePath, { signal });
		const { frontmatter } = parseFrontmatter<SkillFrontmatter>(content);
		const baseDir = access.paths.dirname(filePath);
		const parentDirName = access.paths.basename(baseDir);
		for (const message of validateDescription(frontmatter.description)) {
			diagnostics.push({ type: "warning", message, path: filePath });
		}
		const name = frontmatter.name || parentDirName;
		for (const message of validateName(name, parentDirName)) {
			diagnostics.push({ type: "warning", message, path: filePath });
		}
		if (!frontmatter.description || frontmatter.description.trim() === "") return { skill: null, diagnostics };
		const type: SkillType = frontmatter.metadata?.type === "scene" ? "scene" : "skill";
		return {
			skill: {
				name,
				alias: frontmatter.alias,
				description: frontmatter.description,
				filePath,
				baseDir,
				source,
				type,
				disableModelInvocation: frontmatter["disable-model-invocation"] === true,
				content,
				sceneTasks: await readSceneTasks(access, baseDir, signal),
			},
			diagnostics,
		};
	} catch (error) {
		signal?.throwIfAborted();
		const message = error instanceof Error ? error.message : "failed to parse skill file";
		diagnostics.push({ type: "warning", message, path: filePath });
		return { skill: null, diagnostics };
	}
}

async function loadSkillsFromDirInternal(
	access: ResourceAccessPort,
	dir: string,
	source: string,
	includeRootFiles: boolean,
	signal?: AbortSignal,
	ignoreMatcher?: IgnoreMatcher,
	rootDir?: string,
	visitedDirectories = new Set<string>(),
): Promise<LoadSkillsResult> {
	const skills: Skill[] = [];
	const diagnostics: ResourceDiagnostic[] = [];
	try {
		if ((await access.files.stat(dir, { signal }))?.kind !== "directory") return { skills, diagnostics };
		let identity = access.paths.resolve(dir);
		try {
			identity = await access.files.realPath(dir, { signal });
		} catch {
			signal?.throwIfAborted();
		}
		if (visitedDirectories.has(identity)) return { skills, diagnostics };
		visitedDirectories.add(identity);
	} catch {
		signal?.throwIfAborted();
		return { skills, diagnostics };
	}
	const root = rootDir ?? dir;
	const matcher = ignoreMatcher ?? ignore();
	await addIgnoreRules(access, matcher, dir, root, signal);
	let entries: Awaited<ReturnType<ResourceAccessPort["files"]["readDirectory"]>>;
	try {
		entries = await access.files.readDirectory(dir, { signal });
	} catch {
		signal?.throwIfAborted();
		return { skills, diagnostics };
	}
	for (const entry of entries) {
		if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
		const fullPath = access.paths.join(dir, entry.name);
		let kind = entry.kind;
		if (entry.symbolicLink) {
			try {
				kind = (await access.files.stat(fullPath, { signal }))?.kind ?? "other";
			} catch {
				signal?.throwIfAborted();
				continue;
			}
		}
		const relativePath = toPosixPath(access.paths.relative(root, fullPath), access.paths.separator);
		if (matcher.ignores(kind === "directory" ? `${relativePath}/` : relativePath)) continue;
		if (kind === "directory") {
			const nested = await loadSkillsFromDirInternal(
				access,
				fullPath,
				source,
				false,
				signal,
				matcher,
				root,
				visitedDirectories,
			);
			skills.push(...nested.skills);
			diagnostics.push(...nested.diagnostics);
			continue;
		}
		if (kind !== "file") continue;
		const isRootMarkdown = includeRootFiles && entry.name.endsWith(".md");
		const isSkillMarkdown = !includeRootFiles && entry.name === "SKILL.md";
		if (!isRootMarkdown && !isSkillMarkdown) continue;
		const result = await loadSkillFromFile(access, fullPath, source, signal);
		if (result.skill) skills.push(result.skill);
		diagnostics.push(...result.diagnostics);
	}
	return { skills, diagnostics };
}

export function loadSkillsFromDir(options: LoadSkillsFromDirOptions): Promise<LoadSkillsResult> {
	return loadSkillsFromDirInternal(options.resourceAccess, options.dir, options.source, true, options.signal);
}

async function loadScenesFromDir(
	access: ResourceAccessPort,
	dir: string,
	signal?: AbortSignal,
): Promise<LoadSkillsResult> {
	const result = await loadSkillsFromDirInternal(access, dir, "scene", true, signal);
	return {
		skills: result.skills.map((skill) => ({ ...skill, source: "scene", type: "scene" as const })),
		diagnostics: result.diagnostics,
	};
}

function normalizePath(access: ResourceAccessPort, input: string): string {
	const trimmed = input.trim();
	if (trimmed === "~") return access.paths.homeDirectory();
	if (trimmed.startsWith("~/")) return access.paths.join(access.paths.homeDirectory(), trimmed.slice(2));
	if (trimmed.startsWith("~")) return access.paths.join(access.paths.homeDirectory(), trimmed.slice(1));
	return trimmed;
}

function resolveSkillPath(access: ResourceAccessPort, input: string, cwd: string): string {
	const normalized = normalizePath(access, input);
	return access.paths.isAbsolute(normalized) ? normalized : access.paths.resolve(cwd, normalized);
}

export async function loadSkills(options: LoadSkillsOptions): Promise<LoadSkillsResult> {
	const access = options.resourceAccess;
	const cwd = access.paths.resolve(options.cwd);
	const agentDir =
		options.agentDir ?? access.paths.join(access.paths.homeDirectory(), PROJECT_CONFIG_DIRECTORY, "agent");
	const sceneDir =
		options.sceneDir ?? access.paths.join(access.paths.homeDirectory(), PROJECT_CONFIG_DIRECTORY, "scene");
	const includeDefaults = options.includeDefaults ?? true;
	const includeAgentSkills = options.includeAgentSkills ?? true;
	const skillMap = new Map<string, Skill>();
	const realPaths = new Set<string>();
	const diagnostics: ResourceDiagnostic[] = [];
	const collisions: ResourceDiagnostic[] = [];
	const addSkills = async (result: LoadSkillsResult): Promise<void> => {
		diagnostics.push(...result.diagnostics);
		for (const skill of result.skills) {
			let realPath = skill.filePath;
			try {
				realPath = await access.files.realPath(skill.filePath, { signal: options.signal });
			} catch {
				options.signal?.throwIfAborted();
			}
			if (realPaths.has(realPath)) continue;
			const existing = skillMap.get(skill.name);
			if (existing) {
				collisions.push({
					type: "collision",
					message: `name "${skill.name}" collision`,
					path: skill.filePath,
					collision: {
						resourceType: "skill",
						name: skill.name,
						winnerPath: existing.filePath,
						loserPath: skill.filePath,
					},
				});
				continue;
			}
			skillMap.set(skill.name, skill);
			realPaths.add(realPath);
		}
	};

	const userSkillsDir = access.paths.join(agentDir, "skills");
	const projectSkillsDir = access.paths.resolve(cwd, PROJECT_CONFIG_DIRECTORY, "skills");
	if (includeDefaults) {
		await addSkills(await loadSkillsFromDirInternal(access, userSkillsDir, "user", true, options.signal));
		await addSkills(await loadSkillsFromDirInternal(access, projectSkillsDir, "project", true, options.signal));
		await addSkills(await loadScenesFromDir(access, sceneDir, options.signal));
	}

	const isUnderPath = (target: string, root: string): boolean => {
		const normalizedRoot = access.paths.resolve(root);
		if (target === normalizedRoot) return true;
		const prefix = normalizedRoot.endsWith(access.paths.separator)
			? normalizedRoot
			: `${normalizedRoot}${access.paths.separator}`;
		return target.startsWith(prefix);
	};
	const getSource = (path: string): "user" | "project" | "path" => {
		if (!includeDefaults) {
			if (isUnderPath(path, userSkillsDir)) return "user";
			if (isUnderPath(path, projectSkillsDir)) return "project";
		}
		return "path";
	};

	for (const rawPath of options.skillPaths ?? []) {
		const path = resolveSkillPath(access, rawPath, cwd);
		try {
			const info = await access.files.stat(path, { signal: options.signal });
			if (!info) {
				diagnostics.push({ type: "warning", message: "skill path does not exist", path });
				continue;
			}
			const source = getSource(path);
			if (info.kind === "directory") {
				await addSkills(await loadSkillsFromDirInternal(access, path, source, true, options.signal));
			} else if (info.kind === "file" && path.endsWith(".md")) {
				const result = await loadSkillFromFile(access, path, source, options.signal);
				await addSkills({ skills: result.skill ? [result.skill] : [], diagnostics: result.diagnostics });
			} else {
				diagnostics.push({ type: "warning", message: "skill path is not a markdown file", path });
			}
		} catch (error) {
			options.signal?.throwIfAborted();
			const message = error instanceof Error ? error.message : "failed to read skill path";
			diagnostics.push({ type: "warning", message, path });
		}
	}

	if (includeAgentSkills) {
		await addSkills(
			await loadSkillsFromDirInternal(
				access,
				access.paths.join(access.paths.homeDirectory(), ".agents", "skills"),
				"agents-user",
				false,
				options.signal,
			),
		);
		await addSkills(
			await loadSkillsFromDirInternal(
				access,
				access.paths.resolve(cwd, ".agents", "skills"),
				"agents-project",
				false,
				options.signal,
			),
		);
	}
	return { skills: [...skillMap.values()], diagnostics: [...diagnostics, ...collisions] };
}
