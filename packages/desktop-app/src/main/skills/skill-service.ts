import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { DefaultResourceLoader } from "@vetta/coding-agent";
import type { AppMonitorResourceOperation } from "../../preload/api-types/app-monitor.js";
import { removeAbilityLedgerEntry } from "../abilities/ability-ledger.js";
import { recordAppMonitorEvent } from "../app-monitor/app-monitor-service.js";
import {
	builtinSkillText,
	getBuiltinSkillPaths,
	isBuiltinSkillFile,
	readBuiltinSkillsManifest,
} from "../builtin-skills.js";
import { readDesktopConfig } from "../config/desktop-config-store.js";
import { getAppLogger } from "../logger.js";
import { buildAgentPluginRuntimeConfig } from "../plugins/plugin-store.js";

const skillsLog = getAppLogger("skills");
const skillsBaseDir = join(getVettaHomePath(), "skills");
const sceneBaseDir = join(getVettaHomePath(), "scene");
const manifestPath = join(getVettaHomePath(), "skills-manifest.json");

export type InstalledSkillType = "skill" | "scene";

export interface InstalledMarketSkill {
	name: string;
	version: string;
	installedAt: string;
	source: "market";
	enabled: boolean;
	type?: InstalledSkillType;
	alias?: string;
	marketDescription?: string;
}

export interface InstalledCustomSkill {
	name: string;
	version: string;
	installedAt: string;
	source: "custom";
	enabled: boolean;
	type: "skill";
	alias?: string;
	description: string;
}

export type InstalledSkill = InstalledMarketSkill | InstalledCustomSkill;

export interface ListedSkill {
	name: string;
	alias?: string;
	description: string;
	source: string;
	type: InstalledSkillType;
}

export function getSkillBaseDir(type: InstalledSkillType): string {
	return type === "scene" ? sceneBaseDir : skillsBaseDir;
}

export function recordSkillResourceEvent(input: {
	name: string;
	type: InstalledSkillType;
	source?: "market" | "custom";
	operation: AppMonitorResourceOperation;
}): void {
	try {
		recordAppMonitorEvent({
			type: "resource.lifecycle",
			resourceKind: input.type,
			operation: input.operation,
			resourceId: input.name,
			...(input.source ? { source: input.source } : {}),
		});
	} catch {
		// Monitoring must not affect skill operations.
	}
}

export function readSkillsManifest(): Record<string, InstalledSkill> {
	if (!existsSync(manifestPath)) return {};
	try {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, InstalledSkill>;
		for (const entry of Object.values(manifest)) {
			if (entry.enabled === undefined) entry.enabled = true;
		}
		return manifest;
	} catch {
		return {};
	}
}

export function writeSkillsManifest(manifest: Record<string, InstalledSkill>): void {
	const dir = dirname(manifestPath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
}

export function ensureDirWritable(dir: string): void {
	if (!existsSync(dir)) return;
	try {
		const mode = statSync(dir).mode & 0o777;
		if ((mode & 0o200) === 0) chmodSync(dir, mode | 0o200);
	} catch {
		// Let the following write operation report the concrete error.
	}
}

export class SkillService {
	async list(cwd?: string): Promise<ListedSkill[]> {
		const desktopConfig = await readDesktopConfig();
		const includeAgentSkills = desktopConfig.experimental?.agentSkills !== false;
		const pluginSkillPaths =
			buildAgentPluginRuntimeConfig()?.skillPathContributions?.flatMap((contribution) => contribution.paths) ?? [];
		const builtinSkillPaths = getBuiltinSkillPaths();
		const loader = new DefaultResourceLoader({
			includeAgentSkills,
			cwd,
			additionalSkillPaths: [...pluginSkillPaths, ...builtinSkillPaths],
		});
		await loader.reload();
		const { skills } = loader.getSkills();
		const manifest = readSkillsManifest();
		const builtinManifest = readBuiltinSkillsManifest();
		const pluginRoots = pluginSkillPaths.map((path) => path.replace(/[/\\]+$/, ""));
		const isUnderPluginRoot = (filePath: string): boolean => {
			const normalized = filePath.replace(/\\/g, "/");
			return pluginRoots.some((root) => {
				const normalizedRoot = root.replace(/\\/g, "/");
				return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`);
			});
		};
		const listed = skills
			.filter((skill) => {
				if (isBuiltinSkillFile(skill.filePath)) return builtinManifest[skill.name]?.enabled ?? false;
				const entry = manifest[skill.name];
				if (skill.source === "market" || skill.source === "scene") return entry?.enabled ?? false;
				return !entry || entry.enabled;
			})
			.map((skill): ListedSkill => {
				const isBuiltin = isBuiltinSkillFile(skill.filePath);
				const builtinEntry = isBuiltin ? builtinManifest[skill.name] : undefined;
				const entry = isBuiltin ? undefined : manifest[skill.name];
				return {
					name: skill.name,
					// 内置 Skill 的展示文案跟随宿主语言（catalog 缺译才回落清单里的中文）。
					alias: isBuiltin
						? builtinSkillText(skill.name, "name", builtinEntry?.alias || skill.alias)
						: skill.alias || entry?.alias,
					description: isBuiltin
						? (builtinSkillText(skill.name, "description", builtinEntry?.description) ?? skill.description)
						: (entry?.source === "market" ? entry.marketDescription : entry?.description) || skill.description,
					source: isBuiltin ? "builtin" : isUnderPluginRoot(skill.filePath) ? "plugin" : skill.source,
					type: skill.type,
				};
			});

		const bySource: Record<string, number> = {};
		for (const item of listed) bySource[item.source] = (bySource[item.source] ?? 0) + 1;
		skillsLog.info("skills listed", {
			cwd: cwd ?? null,
			includeAgentSkills,
			total: listed.length,
			bySource,
			names: listed.map((skill) => skill.name),
		});
		return listed;
	}

	getManifest(): Record<string, InstalledSkill> {
		return readSkillsManifest();
	}

	setEnabled(name: string, enabled: boolean): { name: string; enabled: boolean } {
		const manifest = readSkillsManifest();
		const entry = manifest[name];
		if (!entry) throw new Error(`Skill "${name}" is not installed`);
		if (entry.enabled !== enabled) {
			entry.enabled = enabled;
			writeSkillsManifest(manifest);
			recordSkillResourceEvent({
				name,
				type: entry.type === "scene" ? "scene" : "skill",
				source: entry.source,
				operation: enabled ? "enabled" : "disabled",
			});
		}
		return { name, enabled: entry.enabled };
	}

	toggle(name: string): { name: string; enabled: boolean } {
		const entry = readSkillsManifest()[name];
		if (!entry) throw new Error(`Skill "${name}" is not installed`);
		return this.setEnabled(name, !entry.enabled);
	}

	async uninstall(name: string, type?: InstalledSkillType): Promise<void> {
		const manifest = readSkillsManifest();
		const itemType: InstalledSkillType =
			type === "scene" ? "scene" : type === "skill" ? "skill" : manifest[name]?.type === "scene" ? "scene" : "skill";
		const baseDir = getSkillBaseDir(itemType);
		ensureDirWritable(baseDir);
		const skillDir = join(baseDir, name);
		const previous = manifest[name];
		if (existsSync(skillDir)) {
			ensureDirWritable(skillDir);
			await rm(skillDir, { recursive: true, force: true });
		}
		// 清单是扁平 map：同名的 skill 与 scene 共用一个键，卸载其一不能删掉另一种类型的记录
		if (!previous || (previous.type === "scene" ? "scene" : "skill") === itemType) {
			delete manifest[name];
			writeSkillsManifest(manifest);
		}
		removeAbilityLedgerEntry(itemType, name);
		recordSkillResourceEvent({
			name,
			type: itemType,
			source: previous?.source,
			operation: "uninstalled",
		});
	}
}

const desktopSkillService = new SkillService();

export function getDesktopSkillService(): SkillService {
	return desktopSkillService;
}
