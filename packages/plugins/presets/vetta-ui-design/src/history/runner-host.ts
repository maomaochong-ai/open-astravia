/**
 * 把历史 runner 物化到磁盘并执行（ADR-0069）。
 *
 * 为什么要物化：runner 只存在于插件 bundle 里，而它必须由 node 执行，node 只认磁盘
 * 路径；插件的 `fs.write` 又是项目作用域的，写不到 `~/.vetta`。引擎模板是同一个问题
 * 同一个解（见 engine-manager），区别只有一个——引擎模板几十 KB，一个 env 变量塞得下，
 * runner 压缩后仍有上百 KB，而 Windows 单个环境变量上限 32767 字符。所以分块写。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { machineLocalPath, machineOf } from "./machine";

/*
 * runner 源码 ~380KB，改为首次执行历史命令时动态 import（?raw 独立成 chunk）。
 * 异步 chunk 经 vetta-plugin:// 加载的机制是可用的：宿主协议按 standard scheme
 * 服务插件目录下任意文件（desktop plugin-protocol.ts），且 Module Federation
 * runtime 本就通过动态 import() 拉取 exposed chunk——每次插件加载都在验证这条
 * 路。静态引入的代价是 App 启动即求值 400KB 字符串（低配机上直接拖慢插件宿主
 * 就绪，进而挡住冷启动首轮发送）。
 */
let runnerSourcePromise: Promise<string> | null = null;

function loadRunnerSource(): Promise<string> {
	runnerSourcePromise ??= import("../../history-runner/dist/runner.mjs?raw").then((m) => m.default);
	return runnerSourcePromise;
}

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

// 按机器缓存：远程项目的 runner 物化在远端，本机那份用不上，反之亦然。
const homeByMachine = new Map<string, string>();

async function resolveHome(ctx: PluginContext, cwd: string): Promise<string> {
	const machine = machineOf(cwd);
	const cached = homeByMachine.get(machine);
	if (cached) return cached;
	const result = await ctx.command.run("node", ["-p", "require('os').homedir()"], { cwd });
	const home = result.stdout.trim();
	if (result.exitCode !== 0 || !home) {
		// 远端没装 node 时也走这里。说清是哪台机器，否则看起来像本机坏了。
		const where = machine === "local" ? "this computer" : machine;
		throw new Error(`history needs node on ${where}: ${result.stderr || result.stdout}`);
	}
	homeByMachine.set(machine, home);
	return home;
}

const runnerByMachine = new Map<string, Promise<string>>();

/** runner.mjs 在 `cwd` 所属机器上的绝对路径，必要时先物化。并发调用共用同一次物化。 */
export function ensureRunner(ctx: PluginContext, cwd: string): Promise<string> {
	const machine = machineOf(cwd);
	let pending = runnerByMachine.get(machine);
	if (!pending) {
		pending = materialize(ctx, cwd).catch((error: unknown) => {
			runnerByMachine.delete(machine);
			throw error;
		});
		runnerByMachine.set(machine, pending);
	}
	return pending;
}

async function materialize(ctx: PluginContext, cwd: string): Promise<string> {
	const [home, runnerSource] = await Promise.all([resolveHome(ctx, cwd), loadRunnerSource()]);
	const hash = sourceHash(runnerSource);
	const dir = `${home}/.vetta/plugin-data/vetta-ui-design/history-runner/${hash}`;
	const file = `${dir}/runner.mjs`;
	const probe = await ctx.command.run("node", ["-e", PROBE_SCRIPT], { cwd, env: { VETD_RUNNER_FILE: file } });
	if (probe.stdout.trim() === "yes") return file;

	const payload = await gzipBase64(runnerSource);
	const tmp = `${dir}.download`;
	for (let offset = 0, index = 0; offset < payload.length; offset += CHUNK_CHARS, index++) {
		const result = await ctx.command.run("node", ["-e", APPEND_SCRIPT], {
			cwd,
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
		cwd,
		env: { VETD_RUNNER_TMP: tmp, VETD_RUNNER_DIR: dir },
		timeoutMs: 30_000,
	});
	if (finalize.exitCode !== 0) throw new Error(`runner finalize failed: ${finalize.stderr || finalize.stdout}`);
	return file;
}

/**
 * 发一条指令给 runner。返回它的 JSON；`ok:false` 抬成异常。
 *
 * `request.dir` 是设计稿的位置，这里拿它当 cwd：历史仓库住在设计包内部，必须建在设计稿
 * 所在的那台机器上，而宿主正是按 cwd 决定命令在哪执行的。交给 runner 的那份 `dir` 要去掉
 * 归属前缀——runner 是跑在那台机器上的 node 进程，`ssh://…` 对它不是一条路径。
 */
export async function runHistoryCommand<T>(ctx: PluginContext, request: Record<string, unknown>): Promise<T> {
	const dir = typeof request.dir === "string" ? request.dir : "";
	if (!dir) throw new Error("history command requires a design directory");
	const runner = await ensureRunner(ctx, dir);
	const payload = JSON.stringify({ ...request, dir: machineLocalPath(dir) });
	const result = await ctx.command.run("node", [runner, payload], { cwd: dir, timeoutMs: 60_000 });
	const line = result.stdout.trim().split("\n").pop() ?? "";
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		throw new Error(`history runner returned no JSON: ${result.stderr || result.stdout}`);
	}
	const response = parsed as { ok?: boolean; error?: string };
	if (!response.ok) throw new Error(response.error ?? "history runner failed");
	return response as T;
}
