/**
 * 设计源码的语法机检。
 *
 * 为什么不能只靠画布：编译错误的唯一来源是 iframe 里的 `vite:error` HMR 事件
 * （engine/src/bridge.ts），而位图态的 frame 根本不挂 iframe（canvas/FrameView.tsx）——
 * 没有 HMR 连接，它坏没坏就没人知道，能一直躺到被截图那一刻，画布上显示的还是
 * 上一张好图。翻车现场的构建错误实测全是 JSX 语法错（标签不闭合、表达式没收尾），
 * 而这类错误在磁盘上就能判定，不需要等任何运行时。
 *
 * 用引擎自带的 esbuild 解析：它是 vite 的直接依赖，装引擎时就已经在了，报错文本
 * 和画布上看到的是同一套。整个目录扫一遍约 100ms，相对一次模型往返可以忽略。
 *
 * 失败一律当作「没有语法错」：引擎还没装好、node 起不来、脚本自己崩了，都不该
 * 凭空造出一条 issue 让 agent 去改本来正确的代码（同 check-sources 的取舍）。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { engineRootDir } from "../engine/engine-manager";
import type { SourceIssue } from "./check-sources";

/** 语法错误用的规则名，与 check-sources 的规则同池，一起走 `issues`。 */
export const SYNTAX_RULE = "syntax-error";

interface RawSyntaxError {
	file: string;
	line: number | null;
	message: string;
}

/**
 * 在引擎根目录下起一个 node，逐个 tsx 走 esbuild 的 tsx parser。
 * 只 transform 不落盘——要的只是「能不能解析」和第一条错误的位置。
 */
const SCAN_SCRIPT = [
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
	"const note=first&&first.notes&&first.notes[0]&&first.notes[0].text?' '+first.notes[0].text:'';",
	"const text=(first?first.text:String((err&&err.message)||err))+note;",
	"out.push({file:rel,line:first&&first.location?first.location.line:null,message:text});",
	"}}}",
	"process.stdout.write(JSON.stringify(out));",
].join("");

function parseScanOutput(stdout: string): RawSyntaxError[] {
	try {
		const parsed: unknown = JSON.parse(stdout);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(entry): entry is RawSyntaxError =>
				typeof entry === "object" &&
				entry !== null &&
				typeof (entry as RawSyntaxError).file === "string" &&
				typeof (entry as RawSyntaxError).message === "string",
		);
	} catch {
		return [];
	}
}

/**
 * 扫描一份设计的全部源码，返回解析不过去的文件。
 *
 * 报错文案里带上「画布不会渲染」这句：光给一条 esbuild 原文，模型容易当成风格
 * 建议排到后面，而这一条是硬阻塞——不修，这一帧在画布上永远停在上一张图。
 */
export async function checkSyntax(ctx: PluginContext, dirPath: string): Promise<SourceIssue[]> {
	let engineRoot: string;
	try {
		engineRoot = await engineRootDir(ctx);
	} catch {
		return [];
	}
	let stdout: string;
	try {
		const result = await ctx.command.run("node", ["-e", SCAN_SCRIPT], {
			env: {
				VETD_ESBUILD: `${engineRoot}/node_modules/esbuild`,
				VETD_DIR: dirPath,
			},
			timeoutMs: 15_000,
		});
		if (result.exitCode !== 0) return [];
		stdout = result.stdout;
	} catch {
		return [];
	}
	return parseScanOutput(stdout).map((error) => ({
		file: error.file,
		line: error.line,
		rule: SYNTAX_RULE,
		message: `Does not parse: ${error.message}. The canvas cannot build this file, so the frame is frozen on its last good rendering — fix it before anything else, and edit the broken region rather than rewriting the whole file.`,
	}));
}

/** 这一帧当前是否被语法错误挡住：它自己的源码，或它必然依赖的 components/。 */
export function blockingSyntaxIssues(issues: readonly SourceIssue[], frameId: string): SourceIssue[] {
	return issues.filter(
		(issue) =>
			issue.rule === SYNTAX_RULE &&
			(issue.file === `frames/${frameId}.tsx` ||
				issue.file === "frames/_layout.tsx" ||
				issue.file.startsWith("components/")),
	);
}
