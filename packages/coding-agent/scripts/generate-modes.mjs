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

// partials/ 存各模式共享的提示词段（纯正文、无 frontmatter），正文里以 `{{> name}}` 引用，
// 构建期展开。这是两份 mode md 曾出现双份漂移（同一段产品规范各写一遍、越改越不一致）后
// 收敛出的机制：共享段只有一个事实源。
const partialsDir = join(modesDir, "partials");
const partials = new Map();
try {
	for (const file of readdirSync(partialsDir).filter((f) => f.endsWith(".md"))) {
		partials.set(file.replace(/\.md$/, ""), readFileSync(join(partialsDir, file), "utf-8").trim());
	}
} catch {}

function expandPartials(file, body) {
	return body.replace(/^\{\{>\s*([a-z0-9-]+)\s*\}\}$/gm, (_match, name) => {
		const partial = partials.get(name);
		if (partial === undefined) {
			throw new Error(`[generate-modes] ${file} 引用了不存在的 partial: ${name}（modes/partials/${name}.md）`);
		}
		return partial;
	});
}

/**
 * mode 提示词里允许提及的宿主工具名（snake_case 真名）。
 *
 * 卫生校验：正文里任何"字母折叠后等于某个真名、但拼写不同"的词（如 AskUserQuestion、
 * ask-user-question）都是错误的工具引用——模型会照着错名字调用然后失败。真名变更或
 * mode 提示词要提及新工具时同步维护这份清单。
 */
const MENTIONABLE_TOOL_NAMES = ["ask_user_question", "progress", "invoke_skill", "spawn_agent", "dispatch_workflows"];
const foldName = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const FOLDED_TOOL_NAMES = new Map(MENTIONABLE_TOOL_NAMES.map((name) => [foldName(name), name]));

function assertToolMentionsSpelledCorrectly(file, body) {
	for (const match of body.matchAll(/[A-Za-z][A-Za-z0-9_-]{3,}/g)) {
		const word = match[0];
		const canonical = FOLDED_TOOL_NAMES.get(foldName(word));
		if (canonical && word !== canonical) {
			throw new Error(`[generate-modes] ${file} 引用了错误拼写的工具名 "${word}"，真名是 "${canonical}"`);
		}
	}
}

const modes = [];
const seenIds = new Set();
for (const file of files) {
	const { fm, body: rawBody } = parseMd(readFileSync(join(modesDir, file), "utf-8"));
	const body = expandPartials(file, rawBody);
	assertToolMentionsSpelledCorrectly(file, body);
	const id = typeof fm.id === "string" ? fm.id.trim() : "";
	const label = typeof fm.label === "string" ? fm.label.trim() : "";
	const icon = typeof fm.icon === "string" ? fm.icon.trim() : "";
	if (!id || !label) {
		throw new Error(`[generate-modes] ${file} 缺少 id 或 label`);
	}
	// icon 是 UI 遍历注册表渲染 toggle 的必填项（ADR-0071）：缺了会让新模式在新会话页无图标可用。
	if (!icon) throw new Error(`[generate-modes] ${file} 缺少 icon（iconify class，如 icon-[solar--case-linear]）`);
	// narration 是渲染层的模式能力位：staged = 会话流按 progress 阶段折叠（提示词须配套指示模型
	// 调 progress），inline = 工具行内联展示。必填，让新模式在一份 md 里完整自描述，
	// 渲染层据此查表而不是硬编码 mode id 判断。
	const narration = typeof fm.narration === "string" ? fm.narration.trim() : "";
	if (narration !== "staged" && narration !== "inline") {
		throw new Error(`[generate-modes] ${file} 的 narration 必须是 staged 或 inline，当前: ${narration || "(缺失)"}`);
	}
	if (!body.trim()) throw new Error(`[generate-modes] ${file} 的提示词正文为空`);
	if (seenIds.has(id)) throw new Error(`[generate-modes] mode id 重复: ${id}`);
	seenIds.add(id);
	modes.push({
		id,
		label,
		description: typeof fm.description === "string" ? fm.description.trim() : "",
		icon,
		narration,
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
	/** 渲染层能力位：staged = 会话流按 progress 阶段折叠；inline = 工具行内联展示。 */
	narration: "staged" | "inline";
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
