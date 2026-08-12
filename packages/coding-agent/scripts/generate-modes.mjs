// 把 src/profiles/modes/*.md 内联生成 src/profiles/modes-data.ts。
//
// 为何 codegen 而非运行时读盘：同 generate-personas.mjs —— coding-agent 会被 desktop-app 的
// vite 打进 main bundle，打包后基于 __dirname 的 readdirSync 会落到错误目录、读不到 md。
// 构建期内联成字面量后运行时零文件系统依赖。
//
// 触发：coding-agent 的 `bun run build` 会先跑本脚本（见 package.json `build`）。
// 手改 md 后想立即生效，单独跑 `bun run generate:modes`。

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const modesDir = join(__dirname, "..", "src", "profiles", "modes");
const outFile = join(__dirname, "..", "src", "profiles", "modes-data.ts");
const checkOnly = process.argv.includes("--check");

function parseMd(raw) {
	const n = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (!n.startsWith("---")) return { fm: {}, body: n.trim() };
	const end = n.indexOf("\n---", 3);
	if (end === -1) return { fm: {}, body: n.trim() };
	return { fm: parse(n.slice(4, end)) ?? {}, body: n.slice(end + 4).trim() };
}

const files = readdirSync(modesDir)
	.filter((f) => f.endsWith(".md"))
	.sort();

const modes = [];
const seenIds = new Set();
for (const file of files) {
	const { fm, body } = parseMd(readFileSync(join(modesDir, file), "utf-8"));
	const id = typeof fm.id === "string" ? fm.id.trim() : "";
	const label = typeof fm.label === "string" ? fm.label.trim() : "";
	const icon = typeof fm.icon === "string" ? fm.icon.trim() : "";
	if (!id || !label) {
		throw new Error(`[generate-modes] ${file} 缺少 id 或 label`);
	}
	// icon 是 UI 遍历注册表渲染 toggle 的必填项（ADR-0071）：缺了会让新模式在新会话页无图标可用。
	if (!icon) throw new Error(`[generate-modes] ${file} 缺少 icon（iconify class，如 icon-[solar--case-linear]）`);
	if (!body.trim()) throw new Error(`[generate-modes] ${file} 的提示词正文为空`);
	if (seenIds.has(id)) throw new Error(`[generate-modes] mode id 重复: ${id}`);
	seenIds.add(id);
	modes.push({
		id,
		label,
		description: typeof fm.description === "string" ? fm.description.trim() : "",
		icon,
		prompt: body.trim(),
	});
}

const idUnion = modes.map((mode) => JSON.stringify(mode.id)).join(" | ");
const content = `// AUTO-GENERATED from src/profiles/modes/*.md by scripts/generate-modes.mjs. Do not edit by hand.

/** 合法工作模式 id 联合类型，由 modes/*.md 派生（ADR-0071）。 */
export type AgentModeId = ${idUnion};

export interface RawMode {
	id: AgentModeId;
	label: string;
	description: string;
	/** iconify class（如 icon-[solar--case-linear]），供 UI 遍历注册表渲染。 */
	icon: string;
	prompt: string;
}

export const FILE_MODES: RawMode[] = ${JSON.stringify(modes, null, "\t")};
`;

if (checkOnly) {
	if (readFileSync(outFile, "utf-8") !== content) {
		throw new Error("[generate-modes] modes-data.ts 已过期，请运行 bun run generate:modes");
	}
	console.log(`[generate-modes] ${modes.length} modes 与 modes-data.ts 一致`);
} else {
	writeFileSync(outFile, content, "utf-8");
	console.log(`[generate-modes] wrote ${modes.length} modes to modes-data.ts`);
}
