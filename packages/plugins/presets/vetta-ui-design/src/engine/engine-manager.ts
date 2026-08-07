/**
 * Shared design-engine lifecycle (ADR-0053/0054):
 *
 * 1. Migrate the legacy ~/.vetta/design-engine directory into this plugin's
 *    data namespace, then materialize the engine template there via `node -e`.
 * 2. One-time `npm install` through ctx.command.spawn (may take minutes; the
 *    managed runtime env already points npm at the configured mirror).
 * 3. One vite dev server per open design (host-allocated port, {{PORT}}
 *    substitution), stopped when the canvas leaves the design.
 */
import type { PluginCommandSpawnHandle, PluginContext } from "@vetta-org/plugin-sdk";
import { ENGINE_FILES, engineFilesHash } from "./engine-files";
import { ENGINE_VERSION } from "./engine-version";

export type EngineProgress =
	| { phase: "checking" }
	| { phase: "materializing" }
	| { phase: "installing"; outputTail: string }
	| { phase: "starting" };

export interface EngineServer {
	port: number;
	handle: PluginCommandSpawnHandle;
	designDir: string;
}

const BOOTSTRAP_SCRIPT = [
	"const fs=require('fs'),p=require('path');",
	"const root=process.env.VETD_ENGINE_ROOT;",
	"if(!root)throw new Error('VETD_ENGINE_ROOT missing');",
	"const files=JSON.parse(Buffer.from(process.env.VETD_ENGINE_FILES,'base64').toString('utf8'));",
	"for(const[rel,content]of Object.entries(files)){",
	"const t=p.join(root,rel);fs.mkdirSync(p.dirname(t),{recursive:true});fs.writeFileSync(t,content,'utf8');",
	"}",
	"fs.writeFileSync(p.join(root,'.files-hash'),process.env.VETD_ENGINE_HASH??'','utf8');",
	"console.log('ok');",
].join("");

const MIGRATE_SCRIPT = [
	"const fs=require('fs'),p=require('path');",
	"const legacy=process.env.VETD_ENGINE_LEGACY,newBase=process.env.VETD_ENGINE_BASE;",
	"if(!legacy||!newBase)throw new Error('engine migration env missing');",
	"if(!fs.existsSync(legacy)){process.stdout.write('absent');process.exit(0)}",
	"fs.mkdirSync(p.dirname(newBase),{recursive:true});",
	"if(!fs.existsSync(newBase)){fs.renameSync(legacy,newBase);process.stdout.write('moved');process.exit(0)}",
	"for(const ent of fs.readdirSync(legacy,{withFileTypes:true})){",
	"if(!ent.isDirectory()||!/^\\d+\\.\\d+\\.\\d+$/.test(ent.name))continue;",
	"const from=p.join(legacy,ent.name),to=p.join(newBase,ent.name);",
	"if(!fs.existsSync(to))fs.renameSync(from,to);",
	"}",
	"if(fs.readdirSync(legacy).length===0)fs.rmdirSync(legacy);",
	"process.stdout.write('merged');",
].join("");

const ENGINE_READY_SCRIPT = [
	"const fs=require('fs'),p=require('path');",
	"const root=process.env.VETD_ENGINE_ROOT;",
	"if(!root)throw new Error('VETD_ENGINE_ROOT missing');",
	"let hash=null;",
	"try{hash=fs.readFileSync(p.join(root,'.files-hash'),'utf8')}catch(err){if(err.code!=='ENOENT')throw err}",
	"const vite=fs.existsSync(p.join(root,'node_modules','vite','package.json'));",
	"process.stdout.write(JSON.stringify({hash,vite}));",
].join("");

/**
 * 删掉插件数据目录下除当前版本外的引擎版本目录。
 *
 * 分版本目录是为了让引擎升级不去动可能正在跑的旧树（见 engine-version.ts），代价
 * 是旧版本会一直堆着——一份 node_modules 就是 90M+，实测两个版本 175M。回收放在
 * 新版本已经确认能跑之后，所以「装到一半失败」不会把人卡在没有引擎的状态。
 *
 * 只删目录名长得像版本号的，别的一律不碰：这个目录是用户的，万一有人往里放了东西
 * 不该被顺手清掉。
 */
const PRUNE_SCRIPT = [
	"const fs=require('fs'),p=require('path');",
	"const base=process.env.VETD_ENGINE_BASE,keep=process.env.VETD_ENGINE_KEEP;",
	"if(!base||!keep)throw new Error('prune env missing');",
	"for(const name of fs.readdirSync(base)){",
	"if(name===keep||!/^\\d+\\.\\d+\\.\\d+$/.test(name))continue;",
	"fs.rmSync(p.join(base,name),{recursive:true,force:true});",
	"}",
	"console.log('ok');",
].join("");

let cachedHome: string | null = null;
let migrationPromise: Promise<void> | null = null;
let ensurePromise: Promise<string> | null = null;
const servers = new Map<string, EngineServer>();

function engineBaseDir(home: string): string {
	return `${home}/.vetta/plugin-data/vetta-ui-design/design-engine`;
}

function legacyEngineBaseDir(home: string): string {
	return `${home}/.vetta/design-engine`;
}

async function resolveHome(ctx: PluginContext): Promise<string> {
	if (cachedHome) return cachedHome;
	const result = await ctx.command.run("node", ["-p", "require('os').homedir()"]);
	const home = result.stdout.trim();
	if (result.exitCode !== 0 || !home) {
		throw new Error(`resolve homedir failed: ${result.stderr || result.stdout}`);
	}
	cachedHome = home;
	return home;
}

export async function engineRootDir(ctx: PluginContext): Promise<string> {
	const home = await resolveHome(ctx);
	if (!migrationPromise) {
		migrationPromise = migrateLegacyEngine(ctx, home).catch((error: unknown) => {
			migrationPromise = null;
			throw error;
		});
	}
	await migrationPromise;
	return `${engineBaseDir(home)}/${ENGINE_VERSION}`;
}

export async function migrateLegacyEngine(ctx: PluginContext, home: string): Promise<void> {
	const result = await ctx.command.run("node", ["-e", MIGRATE_SCRIPT], {
		env: {
			VETD_ENGINE_LEGACY: legacyEngineBaseDir(home),
			VETD_ENGINE_BASE: engineBaseDir(home),
		},
		timeoutMs: 30_000,
	});
	if (result.exitCode !== 0) {
		throw new Error(`engine migration failed: ${result.stderr || result.stdout}`);
	}
}

function base64FromText(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

async function materializeEngine(ctx: PluginContext, engineRoot: string): Promise<void> {
	const payload = base64FromText(JSON.stringify(ENGINE_FILES));
	const result = await ctx.command.run("node", ["-e", BOOTSTRAP_SCRIPT], {
		env: {
			VETD_ENGINE_ROOT: engineRoot,
			VETD_ENGINE_FILES: payload,
			VETD_ENGINE_HASH: engineFilesHash(),
		},
		timeoutMs: 30_000,
	});
	if (result.exitCode !== 0) {
		throw new Error(`engine materialize failed: ${result.stderr || result.stdout}`);
	}
}

async function installDependencies(
	ctx: PluginContext,
	engineRoot: string,
	onProgress: (progress: EngineProgress) => void,
): Promise<void> {
	const handle = await ctx.command.spawn("npm", ["install", "--no-audit", "--no-fund"], {
		cwd: engineRoot,
	});
	let done = false;
	const poll = window.setInterval(() => {
		void handle.status().then((status) => {
			if (done) return;
			const tail = status.recentOutput.split("\n").filter(Boolean).slice(-3).join("\n");
			onProgress({ phase: "installing", outputTail: tail });
		});
	}, 1_500);
	try {
		await new Promise<void>((resolveInstall, rejectInstall) => {
			handle.onExit((exit) => {
				done = true;
				if (exit.exitCode === 0) resolveInstall();
				else rejectInstall(new Error(`npm install exited with ${exit.exitCode ?? exit.signal}`));
			});
		});
	} finally {
		window.clearInterval(poll);
	}
}

async function pruneOldEngines(ctx: PluginContext): Promise<void> {
	const home = await resolveHome(ctx);
	await ctx.command.run("node", ["-e", PRUNE_SCRIPT], {
		env: {
			VETD_ENGINE_BASE: engineBaseDir(home),
			VETD_ENGINE_KEEP: ENGINE_VERSION,
		},
		timeoutMs: 30_000,
	});
}

export async function engineReady(ctx: PluginContext, engineRoot: string): Promise<boolean> {
	const result = await ctx.command.run("node", ["-e", ENGINE_READY_SCRIPT], {
		env: { VETD_ENGINE_ROOT: engineRoot },
		timeoutMs: 30_000,
	});
	if (result.exitCode !== 0) {
		throw new Error(`engine readiness check failed: ${result.stderr || result.stdout}`);
	}
	const readiness = JSON.parse(result.stdout) as unknown;
	if (
		typeof readiness !== "object" ||
		readiness === null ||
		!("hash" in readiness) ||
		!("vite" in readiness) ||
		(readiness.hash !== null && typeof readiness.hash !== "string") ||
		typeof readiness.vite !== "boolean"
	) {
		throw new Error("engine readiness check returned invalid output");
	}
	return readiness.hash === engineFilesHash() && readiness.vite;
}

/**
 * Idempotent, deduplicated across callers. Resolves to the engine root once
 * files are materialized and node_modules is present.
 */
export function ensureEngine(
	ctx: PluginContext,
	onProgress: (progress: EngineProgress) => void,
): Promise<string> {
	if (ensurePromise) return ensurePromise;
	const run = async (): Promise<string> => {
		onProgress({ phase: "checking" });
		const engineRoot = await engineRootDir(ctx);
		if (await engineReady(ctx, engineRoot)) {
			await pruneOldEngines(ctx).catch(() => {
				// 清不掉只是占着磁盘，不该拦住画布。
			});
			return engineRoot;
		}
		onProgress({ phase: "materializing" });
		await materializeEngine(ctx, engineRoot);
		const viteInstalled = await engineReady(ctx, engineRoot);
		if (!viteInstalled) {
			onProgress({ phase: "installing", outputTail: "" });
			await installDependencies(ctx, engineRoot, onProgress);
		}
		if (!(await engineReady(ctx, engineRoot))) {
			throw new Error("engine install incomplete (vite missing after npm install)");
		}
		await pruneOldEngines(ctx).catch(() => {
			// 同上：新版本已经能跑了，回收失败不值得让整条链路失败。
		});
		return engineRoot;
	};
	ensurePromise = run().catch((error: unknown) => {
		// Failed attempts must not poison later retries.
		ensurePromise = null;
		throw error;
	});
	return ensurePromise;
}

async function waitForHttpReady(port: number, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown = null;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/`, { cache: "no-store" });
			if (response.ok) return;
			lastError = new Error(`HTTP ${response.status}`);
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolveDelay) => window.setTimeout(resolveDelay, 400));
	}
	throw new Error(`design engine did not become ready: ${String(lastError)}`);
}

/** Start (or reuse) the vite dev server serving one design dir. */
export async function startDesignServer(
	ctx: PluginContext,
	designDir: string,
	onProgress: (progress: EngineProgress) => void,
): Promise<EngineServer> {
	const existing = servers.get(designDir);
	if (existing) {
		const status = await existing.handle.status();
		if (status.running) return existing;
		servers.delete(designDir);
	}
	const engineRoot = await ensureEngine(ctx, onProgress);
	onProgress({ phase: "starting" });
	const handle = await ctx.command.spawn(
		"node",
		["node_modules/vite/bin/vite.js", "--port", "{{PORT}}", "--strictPort", "--clearScreen", "false"],
		{
			cwd: engineRoot,
			env: { VETD_SRC: designDir },
			allocatePort: true,
		},
	);
	if (handle.port === undefined) {
		await handle.stop();
		throw new Error("host did not allocate a port for the design engine");
	}
	const server: EngineServer = { port: handle.port, handle, designDir };
	servers.set(designDir, server);
	handle.onExit(() => {
		if (servers.get(designDir) === server) servers.delete(designDir);
	});
	try {
		await waitForHttpReady(handle.port, 30_000);
	} catch (error) {
		const status = await handle.status().catch(() => null);
		await stopDesignServer(designDir);
		const tail = status?.recentOutput.split("\n").filter(Boolean).slice(-5).join("\n") ?? "";
		throw new Error(`${error instanceof Error ? error.message : String(error)}${tail ? `\n${tail}` : ""}`);
	}
	return server;
}

export function getDesignServer(designDir: string): EngineServer | null {
	return servers.get(designDir) ?? null;
}

export async function stopDesignServer(designDir: string): Promise<void> {
	const server = servers.get(designDir);
	if (!server) return;
	servers.delete(designDir);
	await server.handle.stop();
}

export async function stopAllDesignServers(): Promise<void> {
	await Promise.all([...servers.keys()].map((designDir) => stopDesignServer(designDir)));
}

/** One-shot production build of a design (for export snapshots). */
export async function buildDesign(ctx: PluginContext, designDir: string, outDir: string): Promise<void> {
	const engineRoot = await ensureEngine(ctx, () => {});
	const handle = await ctx.command.spawn(
		"node",
		["node_modules/vite/bin/vite.js", "build", "--outDir", outDir, "--emptyOutDir"],
		{
			cwd: engineRoot,
			env: { VETD_SRC: designDir },
		},
	);
	await new Promise<void>((resolveBuild, rejectBuild) => {
		handle.onExit((exit) => {
			if (exit.exitCode === 0) resolveBuild();
			else {
				void handle.status().then((status) => {
					const tail = status.recentOutput.split("\n").filter(Boolean).slice(-8).join("\n");
					rejectBuild(new Error(`vite build failed (${exit.exitCode ?? exit.signal})\n${tail}`));
				});
			}
		});
	});
}

/**
 * Diagnostic snapshot for vetd_status.
 *
 * The tail is deliberately short and de-ANSI'd: this ships to the model on every
 * vetd_status call, and vite's raw output is mostly colour escapes wrapped
 * around routine chatter ("Re-optimizing dependencies…"). Eight clean lines
 * still carry the one thing worth reading here — the last real failure.
 */
export async function engineDiagnostics(designDir: string | null): Promise<{
	running: boolean;
	port: number | null;
	recentOutput: string;
}> {
	const server = designDir ? servers.get(designDir) : null;
	if (!server) return { running: false, port: null, recentOutput: "" };
	const status = await server.handle.status();
	return {
		running: status.running,
		port: server.port,
		recentOutput: status.recentOutput
			// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes is exactly what this does
			.replace(/\u001b\[[0-9;]*m/g, "")
			.split("\n")
			.filter((line) => line.trim().length > 0)
			.slice(-8)
			.join("\n"),
	};
}
