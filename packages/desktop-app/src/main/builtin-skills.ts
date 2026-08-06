import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { app } from "electron";
import { mainT } from "./i18n/index.js";

const BUILTIN_SKILLS_RESOURCE_DIR = "system-skills";
const BUILTIN_SKILLS_MANIFEST = "skills-manifest.json";

export interface BuiltinSkillRegistration {
	name: string;
	version: string;
	source: "builtin";
	enabled: boolean;
	type: "skill" | "scene";
	alias?: string;
	description?: string;
}

function isSkillsDir(dir: string): boolean {
	return existsSync(join(dir, BUILTIN_SKILLS_MANIFEST));
}

/**
 * Resolve the built-in skills root.
 * Packaged: resources/system-skills
 * Dev: packages/skill-presets next to desktop-app (process.cwd() is reliable; app.getAppPath() often points at dist/main).
 */
export function getBuiltinSkillsDir(): string | undefined {
	if (app.isPackaged) {
		const packagedDir = join(process.resourcesPath, BUILTIN_SKILLS_RESOURCE_DIR);
		return isSkillsDir(packagedDir) ? packagedDir : undefined;
	}

	const candidates = [
		// electron-vite / package scripts: cwd is packages/desktop-app
		join(process.cwd(), "..", "skill-presets"),
		// appPath = packages/desktop-app
		resolve(app.getAppPath(), "..", "skill-presets"),
		// appPath = packages/desktop-app/dist/main (or similar nested out dir)
		resolve(app.getAppPath(), "..", "..", "skill-presets"),
		resolve(app.getAppPath(), "..", "..", "..", "skill-presets"),
	];

	for (const candidate of candidates) {
		if (isSkillsDir(candidate)) return candidate;
	}
	return undefined;
}

export function readBuiltinSkillsManifest(): Record<string, BuiltinSkillRegistration> {
	const skillsDir = getBuiltinSkillsDir();
	if (!skillsDir) return {};
	try {
		const parsed = JSON.parse(readFileSync(join(skillsDir, BUILTIN_SKILLS_MANIFEST), "utf-8")) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		return parsed as Record<string, BuiltinSkillRegistration>;
	} catch {
		return {};
	}
}

/** Absolute paths to registered+enabled skill package dirs (each contains SKILL.md). */
export function getBuiltinSkillPaths(): string[] {
	const skillsDir = getBuiltinSkillsDir();
	if (!skillsDir) return [];
	return Object.entries(readBuiltinSkillsManifest())
		.filter(([name, entry]) => entry.enabled !== false && entry.name === name)
		.map(([name]) => join(skillsDir, name))
		.filter((skillDir) => existsSync(join(skillDir, "SKILL.md")));
}

/**
 * 内置 Skill 的展示名 / 描述走宿主 catalog（`skills:builtin.<name>.*`，见 ADR-0031），
 * 清单里的中文只作缺译回退。i18next 缺 key 时原样吐回 key，故以此判定。
 */
export function builtinSkillText(name: string, field: "name" | "description", fallback?: string): string | undefined {
	const key = `skills:builtin.${name}.${field}`;
	const translated = mainT(key);
	return translated === key ? fallback : translated;
}

export function isBuiltinSkillFile(filePath: string): boolean {
	const skillsDir = getBuiltinSkillsDir();
	if (!skillsDir) return false;

	const relativePath = relative(skillsDir, resolve(filePath));
	return (
		relativePath !== "" && relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)
	);
}
