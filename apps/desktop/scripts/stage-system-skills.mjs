import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const desktopAppDir = join(import.meta.dirname, "..");
export const skillPresetsDir = join(desktopAppDir, "..", "..", "packages", "skill-presets");
const manifestFileName = "skills-manifest.json";

/**
 * skill-presets 下不是 skill 的目录。
 *
 * 「未注册即报错」这条检查是为了防止新增 skill 时漏改 manifest，但仓库自身的工程
 * 文件（测试、依赖）也住在这个目录下，不该被它误伤。列白名单而不是放宽检查：
 * 漏注册仍然必须炸。
 */
const NON_SKILL_DIRS = new Set(["test", "node_modules"]);

function readManifest() {
	const manifestPath = join(skillPresetsDir, manifestFileName);
	if (!existsSync(manifestPath)) {
		throw new Error(`[system-skills] 缺少内置 Skill 清单：${manifestPath}`);
	}
	const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
	if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
		throw new Error(`[system-skills] 内置 Skill 清单格式无效：${manifestPath}`);
	}
	return manifest;
}

export function stageSystemSkills(targetDir, logPrefix = "system-skills") {
	rmSync(targetDir, { recursive: true, force: true });
	mkdirSync(targetDir, { recursive: true });

	if (!existsSync(skillPresetsDir)) {
		throw new Error(`[${logPrefix}] 缺少内置 Skill 目录：${skillPresetsDir}`);
	}

	const manifest = readManifest();
	const registeredNames = new Set(Object.keys(manifest));
	for (const name of readdirSync(skillPresetsDir)) {
		if (NON_SKILL_DIRS.has(name)) continue;
		const source = join(skillPresetsDir, name);
		if (statSync(source).isDirectory() && !registeredNames.has(name)) {
			throw new Error(`[${logPrefix}] 内置 Skill 未在 ${manifestFileName} 注册：${name}`);
		}
	}

	// lite 构建（默认，即未显式 VETTA_CLOUD_ENABLED=true）连文件都不进包：requiresCloud 技能的
	// prompt/脚本属于云服务形态，开源安装包里不该出现。与主进程运行时过滤
	// （builtin-skills.ts 的同名标记）共用 manifest 这一个事实源。
	const cloudEnabled = process.env.VETTA_CLOUD_ENABLED === "true";

	let count = 0;
	const stagedManifest = {};
	for (const [name, rawEntry] of Object.entries(manifest)) {
		if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
			throw new Error(`[${logPrefix}] 内置 Skill 清单条目格式无效：${name}`);
		}
		const entry = rawEntry;
		if (entry.name !== name) {
			throw new Error(`[${logPrefix}] 内置 Skill 清单 name 与键不一致：${name}`);
		}
		if (!cloudEnabled && entry.requiresCloud === true) {
			console.log(`[${logPrefix}] skipped ${name} (requiresCloud, lite build)`);
			continue;
		}
		stagedManifest[name] = entry;
		if (entry.enabled === false) continue;

		const source = join(skillPresetsDir, name);
		if (!existsSync(join(source, "SKILL.md"))) {
			throw new Error(`[${logPrefix}] 已注册的内置 Skill 缺少 SKILL.md：${source}`);
		}
		cpSync(source, join(targetDir, name), { recursive: true });
		count += 1;
		console.log(`[${logPrefix}] staged ${name}`);
	}

	if (count === 0) {
		throw new Error(`[${logPrefix}] ${manifestFileName} 中没有启用的内置 Skill`);
	}
	// 写入过滤后的清单而不是原样复制：lite 包的清单里也不该出现被裁掉的条目。
	writeFileSync(join(targetDir, manifestFileName), `${JSON.stringify(stagedManifest, null, 2)}\n`);
	return count;
}
