/**
 * 语法机检的两半分开验：
 *
 * - 扫描脚本本身跑在 node 里、依赖引擎的 esbuild，所以用一个临时目录 + 真实
 *   esbuild 跑一遍，样本取自真实翻车现场（design4/vehicle-management 的
 *   `</tbody>` 少了一层闭合、reem/anlei-resume 的表达式没收尾）。装不到 esbuild
 *   的环境跳过——这条链路本身就是「拿不到就当没有语法错」。
 * - 归因（哪些文件挡住了这一帧）是纯函数，直接断言。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { blockingSyntaxIssues, SYNTAX_RULE } from "../src/vetd/check-syntax";

const OK_FRAME = [
	'export const frame = { width: 1440, height: 900, title: "概览" };',
	"",
	"export default function Frame() {",
	'\treturn <div className="h-full" />;',
	"}",
].join("\n");

/** 少一层 `)}`：真实样本里 `Unterminated regular expression` 就是这么来的。 */
const BROKEN_FRAME = [
	'export const frame = { width: 1440, height: 900, title: "车辆" };',
	"",
	"export default function Frame() {",
	"\treturn (",
	"\t\t<table>",
	"\t\t\t<tbody>",
	"\t\t\t\t{rows.map((r) => (",
	"\t\t\t\t\t<tr key={r.id} />",
	"\t\t\t\t))",
	"\t\t\t</tbody>",
	"\t\t</table>",
	"\t);",
	"}",
].join("\n");

/**
 * 生产链路用的是引擎自己装的那份 esbuild（vite 的直接依赖）。测试环境里没有引擎，
 * 就从 vitest 的依赖链上借一份——bun 的隔离 store 不把 esbuild 提到顶层，直接
 * resolve 是找不到的。
 */
function resolveEsbuild(): string | null {
	const here = createRequire(import.meta.url);
	try {
		return here.resolve("esbuild");
	} catch {
		// 继续往下试
	}
	try {
		return createRequire(here.resolve("vitest")).resolve("esbuild");
	} catch {
		return null;
	}
}

const esbuildPath = resolveEsbuild();
const workDir = mkdtempSync(join(tmpdir(), "vetd-syntax-"));

afterAll(() => {
	rmSync(workDir, { recursive: true, force: true });
});

it.skipIf(esbuildPath === null)("reports only the files that do not parse, with the failing line", () => {
	mkdirSync(join(workDir, "frames"), { recursive: true });
	mkdirSync(join(workDir, "components"), { recursive: true });
	writeFileSync(join(workDir, "frames", "overview.tsx"), OK_FRAME);
	writeFileSync(join(workDir, "frames", "vehicles.tsx"), BROKEN_FRAME);
	writeFileSync(join(workDir, "components", "NavBar.tsx"), "export function NavBar() {\n\treturn <nav />;\n}\n");

	// 与 check-syntax.ts 的 SCAN_SCRIPT 同构：这里验的是那段逻辑在真实 esbuild 上
	// 的行为（能否判定、报不报得出行号），而不是字符串拼接本身。
	const script = [
		"const fs=require('fs'),p=require('path');",
		"const esbuild=require(process.env.VETD_ESBUILD);",
		"const dir=process.env.VETD_DIR;",
		"const out=[];",
		"for(const sub of ['frames','components']){",
		"let entries=[];",
		"try{entries=fs.readdirSync(p.join(dir,sub),{withFileTypes:true})}catch{continue}",
		"for(const ent of entries){",
		"if(ent.isDirectory()||!ent.name.endsWith('.tsx'))continue;",
		"const rel=sub+'/'+ent.name;",
		"let code;try{code=fs.readFileSync(p.join(dir,sub,ent.name),'utf8')}catch{continue}",
		"try{esbuild.transformSync(code,{loader:'tsx',sourcefile:rel})}",
		"catch(err){",
		"const first=(err&&err.errors&&err.errors[0])||null;",
		"out.push({file:rel,line:first&&first.location?first.location.line:null});",
		"}}}",
		"process.stdout.write(JSON.stringify(out));",
	].join("");
	const stdout = execFileSync(process.execPath, ["-e", script], {
		env: { ...process.env, VETD_ESBUILD: esbuildPath as string, VETD_DIR: workDir },
		encoding: "utf8",
	});

	expect(JSON.parse(stdout)).toEqual([{ file: "frames/vehicles.tsx", line: 10 }]);
});

it("treats a broken shared file as blocking for every frame, not just its own", () => {
	const issues = [
		{ file: "components/NavBar.tsx", line: 3, rule: SYNTAX_RULE, message: "…" },
		{ file: "frames/_layout.tsx", line: 8, rule: SYNTAX_RULE, message: "…" },
		{ file: "frames/other.tsx", line: 2, rule: SYNTAX_RULE, message: "…" },
		// 风格违规不是硬阻塞：截图照常出，issues 里带回去就行。
		{ file: "frames/overview.tsx", line: 4, rule: "hardcoded-color", message: "…" },
	];
	expect(blockingSyntaxIssues(issues, "overview").map((issue) => issue.file)).toEqual([
		"components/NavBar.tsx",
		"frames/_layout.tsx",
	]);
	expect(blockingSyntaxIssues(issues, "other").map((issue) => issue.file)).toEqual([
		"components/NavBar.tsx",
		"frames/_layout.tsx",
		"frames/other.tsx",
	]);
});
