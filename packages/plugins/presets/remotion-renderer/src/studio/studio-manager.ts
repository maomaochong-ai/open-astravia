import type { PluginCommandSpawnHandle, PluginContext } from "@vetta-org/plugin-sdk";
import { inspectRemotionProject, type RemotionProjectInspection } from "./project";

export interface RemotionStudioServer {
	cwd: string;
	port: number;
	handle: PluginCommandSpawnHandle;
}

export class RemotionStudioProjectError extends Error {
	constructor(readonly inspection: Exclude<RemotionProjectInspection, { kind: "ready" }>) {
		super(`Remotion Studio project is not ready: ${inspection.reason}`);
		this.name = "RemotionStudioProjectError";
	}
}

const servers = new Map<string, RemotionStudioServer>();
const starts = new Map<string, Promise<RemotionStudioServer>>();

export function buildStudioArgs(cliPath: string, entryPoint: string): string[] {
	return [cliPath, "studio", entryPoint, "--port", "{{PORT}}", "--no-open", "--ipv4"];
}

async function waitForStudioReady(ctx: PluginContext, port: number): Promise<void> {
	const deadline = Date.now() + 30_000;
	let lastError = "No response";
	while (Date.now() < deadline) {
		try {
			const response = await ctx.network.request<string>({
				url: `http://127.0.0.1:${port}/`,
				responseType: "text",
				timeoutMs: 2_000,
			});
			if (response.ok) return;
			lastError = `HTTP ${response.status}`;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
	}
	throw new Error(`Remotion Studio did not become ready: ${lastError}`);
}

async function startStudio(ctx: PluginContext, cwd: string): Promise<RemotionStudioServer> {
	const existing = servers.get(cwd);
	if (existing) {
		const status = await existing.handle.status();
		if (status.running) return existing;
		servers.delete(cwd);
	}

	const inspection = await inspectRemotionProject(ctx.fs, cwd);
	if (inspection.kind !== "ready") throw new RemotionStudioProjectError(inspection);
	const handle = await ctx.command.spawn("node", buildStudioArgs(inspection.cliPath, inspection.entryPoint), {
		cwd,
		allocatePort: true,
	});
	if (handle.port === undefined) {
		await handle.stop();
		throw new Error("The host did not allocate a port for Remotion Studio");
	}
	const server: RemotionStudioServer = { cwd, port: handle.port, handle };
	servers.set(cwd, server);
	handle.onExit(() => {
		if (servers.get(cwd) === server) servers.delete(cwd);
	});
	try {
		await waitForStudioReady(ctx, server.port);
		return server;
	} catch (error) {
		const status = await handle.status().catch(() => null);
		if (servers.get(cwd) === server) servers.delete(cwd);
		await handle.stop();
		const output = status?.recentOutput.split("\n").filter(Boolean).slice(-8).join("\n") ?? "";
		throw new Error(`${error instanceof Error ? error.message : String(error)}${output ? `\n${output}` : ""}`);
	}
}

export function startRemotionStudio(ctx: PluginContext, cwd: string): Promise<RemotionStudioServer> {
	const pending = starts.get(cwd);
	if (pending) return pending;
	const start = startStudio(ctx, cwd).finally(() => {
		if (starts.get(cwd) === start) starts.delete(cwd);
	});
	starts.set(cwd, start);
	return start;
}

export async function stopRemotionStudio(cwd: string): Promise<void> {
	const server = servers.get(cwd);
	if (!server) return;
	servers.delete(cwd);
	await server.handle.stop();
}

export async function restartRemotionStudio(ctx: PluginContext, cwd: string): Promise<RemotionStudioServer> {
	await stopRemotionStudio(cwd);
	return startRemotionStudio(ctx, cwd);
}

export async function stopAllRemotionStudios(): Promise<void> {
	await Promise.all([...servers.keys()].map((cwd) => stopRemotionStudio(cwd)));
}
