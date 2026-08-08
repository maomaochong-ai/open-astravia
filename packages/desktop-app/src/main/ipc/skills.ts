import { execSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import AdmZip from "adm-zip";
import { ipcMain } from "electron";
import { recordAbilityInstall } from "../abilities/ability-ledger.js";
import { getBuiltinSkillPaths } from "../builtin-skills.js";
import { buildAgentPluginRuntimeConfig } from "../plugins/plugin-store.js";
import { installSkillFromMarketArchive, installSkillFromMarketSlug } from "../skills/skill-market-install.js";
import {
	getDesktopSkillService,
	getSkillBaseDir,
	readSkillsManifest,
	recordSkillResourceEvent,
	writeSkillsManifest,
} from "../skills/skill-service.js";
import { allowProjectRoot } from "./fs.js";

function assertNonEmptyString(value: unknown, fieldName: string): asserts value is string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Invalid ${fieldName}`);
	}
}

const tmpBaseDir = join(getVettaHomePath(), "tmp");

interface SkillFrontmatter {
	name?: string;
	alias?: string;
	description?: string;
	version?: string;
}

function extractFrontmatter(content: string): string | null {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	return match ? match[1] : null;
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2) {
		const first = trimmed[0];
		const last = trimmed[trimmed.length - 1];
		if ((first === '"' || first === "'") && first === last) {
			return trimmed.slice(1, -1);
		}
	}
	return trimmed;
}

function parseFrontmatter(content: string): SkillFrontmatter {
	const fm = extractFrontmatter(content);
	if (!fm) return {};
	const result: SkillFrontmatter = {};
	const lines = fm.split(/\r?\n/);
	for (const line of lines) {
		const topMatch = line.match(/^(name|alias|description):\s*(.*)$/);
		if (topMatch) {
			const key = topMatch[1] as "name" | "alias" | "description";
			const value = unquote(topMatch[2]);
			if (value.length > 0) result[key] = value;
		}
	}
	const versionMatch = fm.match(/version:\s*["']?([^\s"']+)["']?/i);
	if (versionMatch) result.version = versionMatch[1];
	return result;
}

function yamlDoubleQuote(value: string): string {
	const escaped = value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\r/g, "\\r")
		.replace(/\n/g, "\\n")
		.replace(/\t/g, "\\t");
	return `"${escaped}"`;
}

/**
 * 把 frontmatter 中 description 字段重写为 double-quoted YAML 字符串，
 * 防止 description 包含 `:` 等字符时 YAML 解析失败（agent 用的是严格 YAML 解析器）。
 * 仅替换单行 description；其他字段原样保留。
 */
function rewriteFrontmatterDescription(content: string, description: string): string {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return content;
	const original = match[0];
	const body = match[1];
	const replaced = body.replace(/^description:[ \t]*.*$/m, `description: ${yamlDoubleQuote(description)}`);
	if (replaced === body) return content;
	const eolMatch = original.match(/\r?\n/);
	const eol = eolMatch ? eolMatch[0] : "\n";
	return content.replace(original, `---${eol}${replaced}${eol}---`);
}

function findShallowestSkillMd(rootDir: string): string | null {
	const holder: { best: { path: string; depth: number } | null } = { best: null };
	const walk = (dir: string, depth: number): void => {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(dir, entry);
			let st: ReturnType<typeof statSync>;
			try {
				st = statSync(full);
			} catch {
				continue;
			}
			if (st.isFile() && entry === "SKILL.md") {
				if (!holder.best || depth < holder.best.depth) holder.best = { path: full, depth };
			} else if (st.isDirectory()) {
				walk(full, depth + 1);
			}
		}
	};
	walk(rootDir, 0);
	return holder.best?.path ?? null;
}

export function registerSkillsIpc(): () => void {
	const skills = getDesktopSkillService();
	// 允许通用 fs IPC 读取技能 / 场景目录下的文件（用于 SKILL.md 预览等）
	allowProjectRoot(getSkillBaseDir("skill"));
	allowProjectRoot(getSkillBaseDir("scene"));
	// 通用 Agent Skill（只读）预览：放行全局 ~/.agents/skills。
	allowProjectRoot(join(homedir(), ".agents", "skills"));
	for (const root of getBuiltinSkillPaths()) {
		allowProjectRoot(root);
	}

	ipcMain.handle("vetta:skills:list", async (_event, cwd: unknown) => {
		const resolvedCwd = typeof cwd === "string" && cwd.trim().length > 0 ? cwd : undefined;
		// Plugin skill packages live under system-plugins / ~/.vetta/plugins; allow
		// roots so slash/detail previews can read SKILL.md via fs IPC if needed.
		const pluginSkillPaths = buildAgentPluginRuntimeConfig()?.skillPathContributions?.flatMap((c) => c.paths) ?? [];
		for (const root of pluginSkillPaths) {
			try {
				allowProjectRoot(root);
			} catch {
				// ignore invalid roots
			}
		}
		return skills.list(resolvedCwd);
	});

	ipcMain.handle(
		"vetta:skills:install-from-market",
		async (_event, name: unknown, archiveBuffer: unknown, type: unknown, meta: unknown) => {
			assertNonEmptyString(name, "name");
			if (!(archiveBuffer instanceof ArrayBuffer) && !Buffer.isBuffer(archiveBuffer)) {
				throw new Error("Invalid archive buffer");
			}
			const itemType: "skill" | "scene" = type === "scene" ? "scene" : "skill";
			const metaObj = (meta != null && typeof meta === "object" ? meta : {}) as {
				alias?: string;
				marketDescription?: string;
				version?: string;
				sha256?: string;
			};
			const buffer = Buffer.isBuffer(archiveBuffer) ? archiveBuffer : Buffer.from(archiveBuffer as ArrayBuffer);
			await installSkillFromMarketArchive(name, itemType, buffer, metaObj);
		},
	);

	/** Action / 官方插件：按市场 slug 下载并安装能力（skill/scene）。 */
	ipcMain.handle("vetta:skills:install-from-market-slug", async (_event, type: unknown, slug: unknown) => {
		assertNonEmptyString(slug, "slug");
		const itemType: "skill" | "scene" = type === "scene" ? "scene" : "skill";
		return installSkillFromMarketSlug(itemType, slug);
	});

	ipcMain.handle("vetta:skills:uninstall", async (_event, name: unknown, type: unknown) => {
		assertNonEmptyString(name, "name");
		await skills.uninstall(name, type === "scene" ? "scene" : type === "skill" ? "skill" : undefined);
	});

	ipcMain.handle("vetta:skills:toggle", async (_event, name: unknown) => {
		assertNonEmptyString(name, "name");
		return skills.toggle(name);
	});

	ipcMain.handle("vetta:skills:get-market-manifest", async () => {
		return skills.getManifest();
	});

	ipcMain.handle("vetta:skills:get-skill-md-path", async (_event, name: unknown, type: unknown) => {
		assertNonEmptyString(name, "name");
		const itemType: "skill" | "scene" = type === "scene" ? "scene" : "skill";
		const skillMd = join(getSkillBaseDir(itemType), name, "SKILL.md");
		if (existsSync(skillMd)) {
			return skillMd;
		}
		// 通用 Agent Skill（只读）预览：回退到全局 ~/.agents/skills/<name>/SKILL.md。
		const agentSkillMd = join(homedir(), ".agents", "skills", name, "SKILL.md");
		if (existsSync(agentSkillMd)) {
			return agentSkillMd;
		}
		for (const builtinSkillDir of getBuiltinSkillPaths()) {
			const builtinSkillMd = join(builtinSkillDir, "SKILL.md");
			if (builtinSkillDir.endsWith(`${sep}${name}`) && existsSync(builtinSkillMd)) {
				return builtinSkillMd;
			}
		}
		throw new Error(`SKILL.md 不存在：${skillMd}`);
	});

	ipcMain.handle("vetta:skills:import-custom", async (_event, archiveBuffer: unknown) => {
		if (!(archiveBuffer instanceof ArrayBuffer) && !Buffer.isBuffer(archiveBuffer)) {
			throw new Error("Invalid archive buffer");
		}
		const buffer = Buffer.isBuffer(archiveBuffer) ? archiveBuffer : Buffer.from(archiveBuffer as ArrayBuffer);
		if (buffer.length < 2) throw new Error("压缩包内容为空或格式无效");

		await mkdir(tmpBaseDir, { recursive: true });
		const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const extractDir = join(tmpBaseDir, `_import_${stamp}`);
		await mkdir(extractDir, { recursive: true });

		try {
			const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
			const isGzip = buffer[0] === 0x1f && buffer[1] === 0x8b;

			if (isZip) {
				const zip = new AdmZip(buffer);
				zip.extractAllTo(extractDir, true);
			} else if (isGzip) {
				const tmpFile = join(tmpBaseDir, `_import_${stamp}.tar.gz`);
				try {
					await writeFile(tmpFile, buffer);
					execSync(`tar -xzf "${tmpFile}" -C "${extractDir}"`, { timeout: 30000 });
				} finally {
					await rm(tmpFile, { force: true }).catch(() => {});
				}
			} else {
				throw new Error("仅支持 .zip 或 .tar.gz / .tgz 格式");
			}

			const skillMdPath = findShallowestSkillMd(extractDir);
			if (!skillMdPath) throw new Error("压缩包中未找到 SKILL.md");

			const fm = parseFrontmatter(readFileSync(skillMdPath, "utf-8"));
			if (!fm.name) throw new Error("SKILL.md frontmatter 缺少 name 字段");
			if (!fm.description) throw new Error("SKILL.md frontmatter 缺少 description 字段");
			if (!/^[a-z0-9-]{1,64}$/.test(fm.name)) {
				throw new Error("name 仅允许小写字母、数字、连字符（1–64 字符）");
			}

			const skillsBaseDir = getSkillBaseDir("skill");
			const targetDir = join(skillsBaseDir, fm.name);
			const manifest = readSkillsManifest();
			if (manifest[fm.name] || existsSync(targetDir)) {
				throw new Error(`已存在同名技能：${fm.name}`);
			}

			await mkdir(skillsBaseDir, { recursive: true });
			cpSync(dirname(skillMdPath), targetDir, { recursive: true });

			// 规范化落盘后的 SKILL.md：将 description 重写为 double-quoted，避免内含 `:` 等字符
			// 触发 agent 端 YAML 解析失败导致技能加载不出来。
			try {
				const targetSkillMd = join(targetDir, "SKILL.md");
				const original = readFileSync(targetSkillMd, "utf-8");
				const normalized = rewriteFrontmatterDescription(original, fm.description);
				if (normalized !== original) {
					writeFileSync(targetSkillMd, normalized, "utf-8");
				}
			} catch {
				// 规范化失败不阻塞导入，保留原始文件
			}

			manifest[fm.name] = {
				name: fm.name,
				version: fm.version || "0.0.0",
				installedAt: new Date().toISOString(),
				source: "custom",
				enabled: true,
				type: "skill",
				alias: fm.alias,
				description: fm.description,
			};
			writeSkillsManifest(manifest);
			recordAbilityInstall("skill", fm.name, fm.version || "0.0.0");
			recordSkillResourceEvent({
				name: fm.name,
				type: "skill",
				source: "custom",
				operation: "imported",
			});

			return { name: fm.name };
		} finally {
			await rm(extractDir, { recursive: true, force: true }).catch(() => {});
		}
	});

	return () => {
		ipcMain.removeHandler("vetta:skills:list");
		ipcMain.removeHandler("vetta:skills:install-from-market");
		ipcMain.removeHandler("vetta:skills:install-from-market-slug");
		ipcMain.removeHandler("vetta:skills:uninstall");
		ipcMain.removeHandler("vetta:skills:toggle");
		ipcMain.removeHandler("vetta:skills:get-market-manifest");
		ipcMain.removeHandler("vetta:skills:get-skill-md-path");
		ipcMain.removeHandler("vetta:skills:import-custom");
	};
}
