// 把 src/profiles/personas/*.md 内联生成 src/profiles/personas-data.ts。
//
// 为何 codegen 而非运行时读盘：coding-agent 会被 desktop-app 的 vite 打进 main bundle，
// 打包后基于 __dirname 的 readdirSync 会落到错误目录、读不到 md（同 photon-node 的
// __dirname 失效问题）。构建期内联成字面量后运行时零文件系统依赖，任何打包场景都稳。
//
// 触发：coding-agent 的 `bun run build` 会先跑本脚本（见 package.json `build`）。
// 手改 md 后想立即生效，单独跑 `bun run generate:personas`。

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const personasDir = join(__dirname, "..", "src", "profiles", "personas");
const outFile = join(__dirname, "..", "src", "profiles", "personas-data.ts");
const checkOnly = process.argv.includes("--check");

function parseMd(raw) {
	const n = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (!n.startsWith("---")) return { fm: {}, body: n.trim() };
	const end = n.indexOf("\n---", 3);
	if (end === -1) return { fm: {}, body: n.trim() };
	return { fm: parse(n.slice(4, end)) ?? {}, body: n.slice(end + 4).trim() };
}

const files = readdirSync(personasDir)
	.filter((f) => f.endsWith(".md"))
	.sort();

const personas = [];
const seenIds = new Set();
for (const file of files) {
	const { fm, body } = parseMd(readFileSync(join(personasDir, file), "utf-8"));
	const id = typeof fm.id === "string" ? fm.id.trim() : "";
	const label = typeof fm.label === "string" ? fm.label.trim() : "";
	if (!id || !label) {
		throw new Error(`[generate-personas] ${file} 缺少 id 或 label`);
	}
	if (!body.trim()) throw new Error(`[generate-personas] ${file} 的提示词正文为空`);
	if (seenIds.has(id)) throw new Error(`[generate-personas] persona id 重复: ${id}`);
	seenIds.add(id);
	personas.push({
		id,
		label,
		description: typeof fm.description === "string" ? fm.description.trim() : "",
		prompt: body.trim(),
	});
}

const content = `// AUTO-GENERATED from src/profiles/personas/*.md by scripts/generate-personas.mjs. Do not edit by hand.

export interface RawPersona {
	id: string;
	label: string;
	description: string;
	prompt: string;
}

export const FILE_PERSONAS: RawPersona[] = ${JSON.stringify(personas, null, "\t")};
`;

if (checkOnly) {
	if (readFileSync(outFile, "utf-8") !== content) {
		throw new Error("[generate-personas] personas-data.ts 已过期，请运行 bun run generate:personas");
	}
	console.log(`[generate-personas] ${personas.length} personas 与 personas-data.ts 一致`);
} else {
	writeFileSync(outFile, content, "utf-8");
	console.log(`[generate-personas] wrote ${personas.length} personas to personas-data.ts`);
}
