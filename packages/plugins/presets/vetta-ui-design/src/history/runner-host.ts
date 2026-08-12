/**
 * 把历史 runner 物化到磁盘并执行（ADR-0069）。
 *
 * 为什么要物化：runner 只存在于插件 bundle 里，而它必须由 node 执行，node 只认磁盘
 * 路径；插件的 `fs.write` 又是项目作用域的，写不到 `~/.vetta`。引擎模板是同一个问题
 * 同一个解（见 engine-manager），区别只有一个——引擎模板几十 KB，一个 env 变量塞得下，
 * runner 压缩后仍有上百 KB，而 Windows 单个环境变量上限 32767 字符。所以分块写。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import runnerSource from "../../history-runner/dist/runner.mjs?raw";

/*
 * runner 源码 ~380KB，静态引入把它压进插件主 chunk（421KB → 801KB）。动态引入能让
 * 它独立成块、按需加载，但这个插件目前没有任何自己的动态 import 先例——异步 chunk
 * 能否经 vetta-plugin:// 取到没有被验证过，而它一旦取不到，表现是历史对所有人静默
 * 失效。等有人在真实 Electron 里验证过之后再拆。
 */

/** 一块 base64 的大小。留足余量给脚本本身与其它环境变量。 */
const CHUNK_CHARS = 16_000;

const APPEND_SCRIPT = [
	"const fs=require('fs'),p=require('path');",
	"const target=process.env.VETD_RUNNER_TMP;",
	"if(!target)throw new Error('VETD_RUNNER_TMP missing');",
	"fs.mkdirSync(p.dirname(target),{recursive:true});",
	"if(process.env.VETD_RUNNER_FIRST==='1'&&fs.existsSync(target))fs.rmSync(target);",
	"fs.appendFileSync(target,Buffer.from(process.env.VETD_RUNNER_CHUNK??'','base64'));",
	"process.stdout.write('ok');",
].join("");

/**
 * 解压落位。先写进临时目录再整目录改名：中途失败留下的是一个残缺的 tmp 目录，
 * 而不是一个「哈希对得上、内容却截断了」的 runner——后者会在之后每次调用都失败。
 */
const FINALIZE_SCRIPT = [
	"const fs=require('fs'),p=require('path'),zlib=require('zlib');",
	"const tmp=process.env.VETD_RUNNER_TMP,dir=process.env.VETD_RUNNER_DIR;",
	"if(!tmp||!dir)throw new Error('VETD_RUNNER env missing');",
	"const staging=`${dir}.staging`;",
	"fs.rmSync(staging,{recursive:true,force:true});",
	"fs.mkdirSync(staging,{recursive:true});",
	"fs.writeFileSync(p.join(staging,'runner.mjs'),zlib.gunzipSync(fs.readFileSync(tmp)));",
	"fs.rmSync(tmp,{force:true});",
	"if(fs.existsSync(dir))fs.rmSync(staging,{recursive:true,force:true});",
	"else fs.renameSync(staging,dir);",
	"process.stdout.write('ok');",
].join("");

const PROBE_SCRIPT = [
	"const fs=require('fs');",
	"process.stdout.write(fs.existsSync(process.env.VETD_RUNNER_FILE??'')?'yes':'no');",
].join("");

/** 内容哈希——插件更新换了 runner，路径跟着变，旧版本自然失效。 */
function sourceHash(text: string): string {
	let hash = 5381;
	for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
	return (hash >>> 0).toString(36);
}

async function gzipBase64(text: string): Promise<string> {
	const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
	const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
	let binary = "";
	const step = 0x8000;
	for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step));
	return btoa(binary);
}

let cachedHome: string | null = null;

async function resolveHome(ctx: PluginContext): Promise<string> {
	if (cachedHome) return cachedHome;
	const result = await ctx.command.run("node", ["-p", "require('os').homedir()"]);
	const home = result.stdout.trim();
	if (result.exitCode !== 0 || !home) throw new Error(`resolve homedir failed: ${result.stderr || result.stdout}`);
	cachedHome = home;
	return home;
}

let runnerPromise: Promise<string> | null = null;

/** runner.mjs 的绝对路径，必要时先物化。并发调用共用同一次物化。 */
export function ensureRunner(ctx: PluginContext): Promise<string> {
	if (!runnerPromise) {
		runnerPromise = materialize(ctx).catch((error: unknown) => {
			runnerPromise = null;
			throw error;
		});
	}
	return runnerPromise;
}

async function materialize(ctx: PluginContext): Promise<string> {
	const home = await resolveHome(ctx);
	const hash = sourceHash(runnerSource);
	const dir = `${home}/.vetta/plugin-data/vetta-ui-design/history-runner/${hash}`;
	const file = `${dir}/runner.mjs`;
	const probe = await ctx.command.run("node", ["-e", PROBE_SCRIPT], { env: { VETD_RUNNER_FILE: file } });
	if (probe.stdout.trim() === "yes") return file;

	const payload = await gzipBase64(runnerSource);
	const tmp = `${dir}.download`;
	for (let offset = 0, index = 0; offset < payload.length; offset += CHUNK_CHARS, index++) {
		const result = await ctx.command.run("node", ["-e", APPEND_SCRIPT], {
			env: {
				VETD_RUNNER_TMP: tmp,
				VETD_RUNNER_CHUNK: payload.slice(offset, offset + CHUNK_CHARS),
				VETD_RUNNER_FIRST: index === 0 ? "1" : "0",
			},
			timeoutMs: 30_000,
		});
		if (result.exitCode !== 0) throw new Error(`runner write failed: ${result.stderr || result.stdout}`);
	}
	const finalize = await ctx.command.run("node", ["-e", FINALIZE_SCRIPT], {
		env: { VETD_RUNNER_TMP: tmp, VETD_RUNNER_DIR: dir },
		timeoutMs: 30_000,
	});
	if (finalize.exitCode !== 0) throw new Error(`runner finalize failed: ${finalize.stderr || finalize.stdout}`);
	return file;
}

/** 发一条指令给 runner。返回它的 JSON；`ok:false` 抬成异常。 */
export async function runHistoryCommand<T>(ctx: PluginContext, request: Record<string, unknown>): Promise<T> {
	const runner = await ensureRunner(ctx);
	const result = await ctx.command.run("node", [runner, JSON.stringify(request)], { timeoutMs: 60_000 });
	const line = result.stdout.trim().split("\n").pop() ?? "";
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		throw new Error(`history runner returned no JSON: ${result.stderr || result.stdout}`);
	}
	const payload = parsed as { ok?: boolean; error?: string };
	if (!payload.ok) throw new Error(payload.error ?? "history runner failed");
	return payload as T;
}
