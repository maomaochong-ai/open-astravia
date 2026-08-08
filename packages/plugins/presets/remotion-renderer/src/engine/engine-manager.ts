import type { PluginCommandSpawnHandle, PluginContext } from "@vetta-org/plugin-sdk";
import { ENGINE_FILES, engineFilesHash } from "./engine-files";

export interface RemotionEngineServer {
	port: number;
	handle: PluginCommandSpawnHandle;
}

const ENGINE_VERSION = "0.1.0";
const BOOTSTRAP_SCRIPT = [
	"const fs=require('fs'),p=require('path');",
	"const root=process.env.REMOTION_ENGINE_ROOT;",
	"if(!root)throw new Error('REMOTION_ENGINE_ROOT missing');",
	"const files=JSON.parse(Buffer.from(process.env.REMOTION_ENGINE_FILES,'base64').toString('utf8'));",
	"for(const[rel,content]of Object.entries(files)){",
	"const target=p.join(root,rel);fs.mkdirSync(p.dirname(target),{recursive:true});fs.writeFileSync(target,content,'utf8');",
	"}",
	"fs.writeFileSync(p.join(root,'.files-hash'),process.env.REMOTION_ENGINE_HASH??'','utf8');",
].join("");
const READY_SCRIPT = [
	"const fs=require('fs'),p=require('path');",
	"const root=process.env.REMOTION_ENGINE_ROOT;",
	"if(!root)throw new Error('REMOTION_ENGINE_ROOT missing');",
	"let hash='';try{hash=fs.readFileSync(p.join(root,'.files-hash'),'utf8')}catch{}",
	"process.stdout.write(JSON.stringify({hash,server:fs.existsSync(p.join(root,'server.mjs'))}));",
].join("");

let cachedHome: string | null = null;
let ensurePromise: Promise<string> | null = null;
let activeServer: RemotionEngineServer | null = null;
let startPromise: Promise<RemotionEngineServer> | null = null;

function encodeBase64(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	}
	return btoa(binary);
}

async function resolveHome(ctx: PluginContext): Promise<string> {
	if (cachedHome) return cachedHome;
	const result = await ctx.command.run("node", ["-p", "require('os').homedir()"]);
	const home = result.stdout.trim();
	if (result.exitCode !== 0 || !home) throw new Error(`Unable to resolve the home directory: ${result.stderr}`);
	cachedHome = home;
	return home;
}

async function engineRoot(ctx: PluginContext): Promise<string> {
	return `${await resolveHome(ctx)}/.vetta/plugin-data/remotion-renderer/engine/${ENGINE_VERSION}`;
}

async function isReady(ctx: PluginContext, root: string): Promise<boolean> {
	const result = await ctx.command.run("node", ["-e", READY_SCRIPT], {
		env: { REMOTION_ENGINE_ROOT: root },
		timeoutMs: 30_000,
	});
	if (result.exitCode !== 0) return false;
	const value = JSON.parse(result.stdout) as { hash?: unknown; server?: unknown };
	return value.hash === engineFilesHash() && value.server === true;
}

async function materialize(ctx: PluginContext, root: string): Promise<void> {
	const result = await ctx.command.run("node", ["-e", BOOTSTRAP_SCRIPT], {
		env: {
			REMOTION_ENGINE_ROOT: root,
			REMOTION_ENGINE_FILES: encodeBase64(JSON.stringify(ENGINE_FILES)),
			REMOTION_ENGINE_HASH: engineFilesHash(),
		},
		timeoutMs: 30_000,
	});
	if (result.exitCode !== 0) throw new Error(`Unable to prepare the Remotion engine: ${result.stderr}`);
}

async function ensureEngine(ctx: PluginContext): Promise<string> {
	if (ensurePromise) return ensurePromise;
	ensurePromise = (async () => {
		const root = await engineRoot(ctx);
		if (!(await isReady(ctx, root))) await materialize(ctx, root);
		if (!(await isReady(ctx, root))) throw new Error("Remotion engine preparation was incomplete");
		return root;
	})().catch((error: unknown) => {
		ensurePromise = null;
		throw error;
	});
	return ensurePromise;
}

async function waitForReady(ctx: PluginContext, port: number): Promise<void> {
	const deadline = Date.now() + 30_000;
	let lastError = "No response";
	while (Date.now() < deadline) {
		try {
			const response = await ctx.network.request<{ ok?: boolean }>({
				url: `http://127.0.0.1:${port}/health`,
				responseType: "json",
				timeoutMs: 2_000,
			});
			if (response.ok && response.body.ok === true) return;
			lastError = `HTTP ${response.status}`;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
	}
	throw new Error(`Remotion engine did not start: ${lastError}`);
}

async function startServer(ctx: PluginContext): Promise<RemotionEngineServer> {
	if (activeServer) {
		const status = await activeServer.handle.status();
		if (status.running) return activeServer;
		activeServer = null;
	}
	const root = await ensureEngine(ctx);
	const handle = await ctx.command.spawn("node", ["server.mjs", "--port", "{{PORT}}"], {
		cwd: root,
		allocatePort: true,
	});
	if (handle.port === undefined) {
		await handle.stop();
		throw new Error("The host did not allocate a port for the Remotion engine");
	}
	const server = { port: handle.port, handle };
	activeServer = server;
	handle.onExit(() => {
		if (activeServer === server) activeServer = null;
	});
	try {
		await waitForReady(ctx, server.port);
		return server;
	} catch (error) {
		if (activeServer === server) activeServer = null;
		await server.handle.stop();
		throw error;
	}
}

export function startRemotionServer(ctx: PluginContext): Promise<RemotionEngineServer> {
	if (startPromise) return startPromise;
	startPromise = startServer(ctx).finally(() => {
		startPromise = null;
	});
	return startPromise;
}

export async function stopRemotionServer(): Promise<void> {
	const server = activeServer;
	if (!server) return;
	activeServer = null;
	await server.handle.stop();
}
