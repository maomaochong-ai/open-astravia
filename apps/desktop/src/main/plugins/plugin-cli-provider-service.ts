import { type ChildProcess, execFile } from "node:child_process";
import type { PluginCliProviderManifest, PluginCliProviderStatus } from "@vetta-org/plugin-sdk";
import { webContents } from "electron";
import type {
	PluginCommandRunOptions,
	PluginCommandRunResult,
	PluginCommandSpawnOptions,
	PluginCommandSpawnResult,
	PluginCommandSpawnStatus,
} from "../../preload/api-types/plugins.js";
import { PLUGIN_EXECUTION_CHANNELS } from "../../shared/plugin-ipc.js";
import { getAppLogger } from "../logger.js";
import { createPluginCommandEnvironment } from "./command-environment.js";
import { spawnCrossPlatformCommand } from "./command-launcher.js";
import { listPlugins } from "./plugin-catalog.js";
import {
	arePluginCliProvidersReady,
	clearPluginCliProviderReadiness,
	setPluginCliProviderReady,
} from "./plugin-cli-provider-readiness.js";
import { refreshAgentPlugins } from "./plugin-runtime-service.js";

const providerLog = getAppLogger("plugin");
const MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_RUN_TIMEOUT_MS = 120_000;
const MAX_RUN_TIMEOUT_MS = 30 * 60_000;
const KILL_GRACE_MS = 3_000;

interface ProviderSpawnRecord {
	spawnId: string;
	pluginId: string;
	providerId: string;
	child: ChildProcess;
	output: string;
	exit?: { exitCode: number | null; signal: string | null };
}

interface CliProviderProcessCallbacks {
	onStart?: (child: ChildProcess) => void;
	onOutput?: (chunk: Buffer) => void;
}

export interface PluginCliProviderServiceDependencies {
	listPlugins: typeof listPlugins;
	refreshRuntime(): void;
	broadcast(channel: string, payload: unknown): void;
	runProcess?: (
		file: string,
		args: string[],
		timeoutMs: number,
		options: { cwd?: string; env?: Record<string, string> },
		callbacks: CliProviderProcessCallbacks,
	) => Promise<PluginCommandRunResult>;
}

function providerKey(pluginId: string, providerId: string): string {
	return `${pluginId}:${providerId}`;
}

function appendOutput(current: string, chunk: Buffer | string): string {
	const next = current + chunk.toString();
	return next.length <= MAX_OUTPUT_BYTES ? next : next.slice(next.length - MAX_OUTPUT_BYTES);
}

function normalizeArgs(args: unknown): string[] {
	if (args === undefined) return [];
	if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
		throw new Error("CLI provider args must be an array of strings");
	}
	return [...args];
}

function normalizeOptions(options: PluginCommandRunOptions | PluginCommandSpawnOptions | undefined): {
	cwd?: string;
	env?: Record<string, string>;
} {
	if (options?.env !== undefined) {
		if (options.env === null || typeof options.env !== "object" || Array.isArray(options.env)) {
			throw new Error("CLI provider env must be a string map");
		}
		for (const value of Object.values(options.env)) {
			if (typeof value !== "string") throw new Error("CLI provider env must be a string map");
		}
	}
	return {
		cwd: typeof options?.cwd === "string" && options.cwd.trim() ? options.cwd : undefined,
		env: options?.env ? { ...options.env } : undefined,
	};
}

function clampTimeout(value: number | undefined, fallback = DEFAULT_RUN_TIMEOUT_MS): number {
	if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
	return Math.min(Math.floor(value), MAX_RUN_TIMEOUT_MS);
}

function killTree(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
	if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
	if (process.platform === "win32") {
		execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => undefined);
		return;
	}
	try {
		process.kill(-child.pid, signal);
	} catch {
		child.kill(signal);
	}
}

function broadcast(channel: string, payload: unknown): void {
	for (const contents of webContents.getAllWebContents()) {
		if (contents.isDestroyed()) continue;
		try {
			contents.send(channel, payload);
		} catch {
			// A renderer can disappear between enumeration and send.
		}
	}
}

export class PluginCliProviderService {
	private readonly statuses = new Map<string, PluginCliProviderStatus>();
	private readonly ensureOperations = new Map<string, Promise<void>>();
	private readonly installProcesses = new Map<string, ChildProcess>();
	private readonly spawns = new Map<string, ProviderSpawnRecord>();
	private readonly providerGenerations = new Map<string, number>();
	private spawnCounter = 0;

	constructor(
		private readonly dependencies: PluginCliProviderServiceDependencies = {
			listPlugins,
			refreshRuntime: refreshAgentPlugins,
			broadcast,
		},
	) {}

	getStatus(pluginId: string, providerId: string): PluginCliProviderStatus {
		const { plugin } = this.requireProvider(pluginId, providerId);
		if (!plugin.enabled) return { providerId, phase: "disabled", recentOutput: "" };
		const key = providerKey(pluginId, providerId);
		const current = this.statuses.get(key);
		if (current) return current;
		void this.ensure(pluginId, providerId);
		return { providerId, phase: "checking", recentOutput: "" };
	}

	ensureEnabledProviders(): void {
		for (const plugin of this.dependencies.listPlugins()) {
			if (!plugin.enabled) continue;
			for (const provider of plugin.cliProviders ?? []) void this.ensure(plugin.id, provider.id);
		}
	}

	ensurePlugin(pluginId: string): void {
		const plugin = this.dependencies.listPlugins().find((candidate) => candidate.id === pluginId);
		if (!plugin?.enabled) return;
		for (const provider of plugin.cliProviders ?? []) void this.ensure(plugin.id, provider.id);
	}

	arePluginProvidersReady(pluginId: string): boolean {
		const plugin = this.dependencies.listPlugins().find((candidate) => candidate.id === pluginId);
		if (!plugin || !plugin.cliProviders || plugin.cliProviders.length === 0) return true;
		return arePluginCliProvidersReady(pluginId, plugin.cliProviders);
	}

	async retry(pluginId: string, providerId: string): Promise<void> {
		this.requireProvider(pluginId, providerId);
		const key = providerKey(pluginId, providerId);
		this.stopInstall(key);
		this.bumpGeneration(key);
		this.ensureOperations.delete(key);
		await this.ensure(pluginId, providerId);
	}

	disablePlugin(pluginId: string): void {
		clearPluginCliProviderReadiness(pluginId);
		const prefix = `${pluginId}:`;
		const providerKeys = new Set<string>();
		for (const key of this.statuses.keys()) if (key.startsWith(prefix)) providerKeys.add(key);
		for (const key of this.ensureOperations.keys()) if (key.startsWith(prefix)) providerKeys.add(key);
		for (const key of this.installProcesses.keys()) if (key.startsWith(prefix)) providerKeys.add(key);
		const plugin = this.dependencies.listPlugins().find((candidate) => candidate.id === pluginId);
		for (const provider of plugin?.cliProviders ?? []) {
			providerKeys.add(providerKey(pluginId, provider.id));
		}
		for (const key of providerKeys) this.bumpGeneration(key);
		for (const [key] of this.installProcesses) {
			if (key.startsWith(prefix)) this.stopInstall(key);
		}
		for (const key of this.ensureOperations.keys()) {
			if (key.startsWith(prefix)) this.ensureOperations.delete(key);
		}
		for (const record of this.spawns.values()) {
			if (record.pluginId === pluginId && record.exit === undefined) void this.stopSpawn(pluginId, record.spawnId);
		}
		for (const provider of plugin?.cliProviders ?? []) {
			this.setStatus(pluginId, { providerId: provider.id, phase: "disabled", recentOutput: "" });
		}
	}

	async run(
		pluginId: string,
		providerId: string,
		args: unknown,
		options?: PluginCommandRunOptions,
	): Promise<PluginCommandRunResult> {
		const { provider } = this.requireReadyProvider(pluginId, providerId);
		const normalized = normalizeOptions(options);
		return this.executeProcess(provider.command, normalizeArgs(args), clampTimeout(options?.timeoutMs), normalized);
	}

	async spawn(
		pluginId: string,
		providerId: string,
		args: unknown,
		options?: PluginCommandSpawnOptions,
	): Promise<PluginCommandSpawnResult> {
		const { provider } = this.requireReadyProvider(pluginId, providerId);
		const normalized = normalizeOptions(options);
		const child = spawnCrossPlatformCommand(provider.command, normalizeArgs(args), {
			cwd: normalized.cwd,
			env: createPluginCommandEnvironment(normalized.env),
			windowsHide: true,
			detached: process.platform !== "win32",
			stdio: ["ignore", "pipe", "pipe"],
		});
		const spawnId = `cli-provider-${++this.spawnCounter}-${Date.now().toString(36)}`;
		const record: ProviderSpawnRecord = {
			spawnId,
			pluginId,
			providerId,
			child,
			output: "",
		};
		this.spawns.set(spawnId, record);
		child.stdout?.on("data", (chunk: Buffer) => {
			record.output = appendOutput(record.output, chunk);
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			record.output = appendOutput(record.output, chunk);
		});
		child.on("exit", (exitCode, signal) => {
			record.exit = { exitCode, signal };
			this.dependencies.broadcast(PLUGIN_EXECUTION_CHANNELS.CLI_PROVIDER_SPAWN_EXIT, {
				pluginId,
				spawnId,
				exitCode,
				signal,
			});
		});
		return await new Promise<PluginCommandSpawnResult>((resolve, reject) => {
			child.once("spawn", () => resolve({ spawnId, pid: child.pid ?? -1 }));
			child.once("error", (error: NodeJS.ErrnoException) => {
				this.spawns.delete(spawnId);
				reject(new Error(`CLI provider failed to start: ${provider.command} (${error.code ?? error.message})`));
			});
		});
	}

	getSpawnStatus(pluginId: string, spawnId: string): PluginCommandSpawnStatus {
		const record = this.spawns.get(spawnId);
		if (!record || record.pluginId !== pluginId) return { running: false, pid: -1, recentOutput: "" };
		return {
			running: record.exit === undefined,
			pid: record.child.pid ?? -1,
			exit: record.exit,
			recentOutput: record.output,
		};
	}

	async stopSpawn(pluginId: string, spawnId: string): Promise<void> {
		const record = this.spawns.get(spawnId);
		if (!record || record.pluginId !== pluginId || record.exit !== undefined) return;
		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => killTree(record.child, "SIGKILL"), KILL_GRACE_MS);
			timer.unref();
			record.child.once("exit", () => {
				clearTimeout(timer);
				resolve();
			});
			killTree(record.child);
		});
	}

	stopAll(): void {
		for (const key of this.installProcesses.keys()) this.stopInstall(key);
		for (const record of this.spawns.values()) killTree(record.child, "SIGKILL");
	}

	private ensure(pluginId: string, providerId: string): Promise<void> {
		const key = providerKey(pluginId, providerId);
		const current = this.ensureOperations.get(key);
		if (current) return current;
		const generation = this.providerGenerations.get(key) ?? 0;
		let operation: Promise<void>;
		operation = this.performEnsure(pluginId, providerId, generation)
			.catch((error: unknown) => {
				if (!this.isCurrentGeneration(key, generation)) return;
				const previous = this.statuses.get(key);
				const message = error instanceof Error ? error.message : String(error);
				providerLog.warn("CLI provider setup failed", { pluginId, providerId, message });
				this.setStatus(pluginId, {
					providerId,
					phase: "failed",
					message,
					recentOutput: previous?.recentOutput ?? "",
				});
				this.dependencies.refreshRuntime();
			})
			.finally(() => {
				if (this.ensureOperations.get(key) === operation) this.ensureOperations.delete(key);
			});
		this.ensureOperations.set(key, operation);
		return operation;
	}

	private async performEnsure(pluginId: string, providerId: string, generation: number): Promise<void> {
		const key = providerKey(pluginId, providerId);
		const { plugin, provider } = this.requireProvider(pluginId, providerId);
		if (!plugin.enabled) {
			this.setStatus(pluginId, { providerId, phase: "disabled", recentOutput: "" });
			return;
		}
		let output = "";
		try {
			this.setStatus(pluginId, { providerId, phase: "checking", recentOutput: "" });
			const probe = await this.executeProcess(
				provider.command,
				provider.probe?.args ?? ["--version"],
				clampTimeout(provider.probe?.timeoutMs, 10_000),
			);
			if (!this.isCurrentGeneration(key, generation)) return;
			if (probe.exitCode === 0) {
				this.setStatus(pluginId, {
					providerId,
					phase: "ready",
					recentOutput: appendOutput(probe.stdout, probe.stderr).trim(),
				});
				this.dependencies.refreshRuntime();
				return;
			}
		} catch {
			// Missing or broken executable proceeds to the declared installer.
		}
		if (!this.isCurrentGeneration(key, generation)) return;

		this.setStatus(pluginId, { providerId, phase: "installing", recentOutput: "" });
		let install: PluginCommandRunResult;
		try {
			install = await this.executeProcess(
				provider.install.command,
				provider.install.args ?? [],
				clampTimeout(provider.install.timeoutMs, 10 * 60_000),
				undefined,
				(child) => this.installProcesses.set(key, child),
				(chunk) => {
					if (!this.isCurrentGeneration(key, generation)) return;
					output = appendOutput(output, chunk);
					this.setStatus(pluginId, { providerId, phase: "installing", recentOutput: output });
				},
			);
		} finally {
			this.installProcesses.delete(key);
		}
		if (!this.isCurrentGeneration(key, generation)) return;
		if (install.exitCode !== 0) throw new Error(`Installer exited with code ${install.exitCode ?? "unknown"}`);

		this.setStatus(pluginId, { providerId, phase: "verifying", recentOutput: output });
		const verified = await this.executeProcess(
			provider.command,
			provider.probe?.args ?? ["--version"],
			clampTimeout(provider.probe?.timeoutMs, 10_000),
		);
		if (!this.isCurrentGeneration(key, generation)) return;
		if (verified.exitCode !== 0) throw new Error("CLI executable was not available after installation");
		this.setStatus(pluginId, {
			providerId,
			phase: "ready",
			recentOutput: appendOutput(output, verified.stdout).trim(),
		});
		this.dependencies.refreshRuntime();
	}

	private executeProcess(
		file: string,
		args: string[],
		timeoutMs: number,
		options: { cwd?: string; env?: Record<string, string> } = {},
		onStart?: (child: ChildProcess) => void,
		onOutput?: (chunk: Buffer) => void,
	): Promise<PluginCommandRunResult> {
		if (this.dependencies.runProcess) {
			return this.dependencies.runProcess(file, args, timeoutMs, options, { onStart, onOutput });
		}
		return this.runProcess(file, args, timeoutMs, options, onStart, onOutput);
	}

	private async runProcess(
		file: string,
		args: string[],
		timeoutMs: number,
		options: { cwd?: string; env?: Record<string, string> } = {},
		onStart?: (child: ChildProcess) => void,
		onOutput?: (chunk: Buffer) => void,
	): Promise<PluginCommandRunResult> {
		return await new Promise<PluginCommandRunResult>((resolve, reject) => {
			const child = spawnCrossPlatformCommand(file, args, {
				cwd: options.cwd,
				env: createPluginCommandEnvironment(options.env),
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			});
			onStart?.(child);
			let stdout = "";
			let stderr = "";
			let settled = false;
			const timer = setTimeout(() => killTree(child), timeoutMs);
			timer.unref();
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout = appendOutput(stdout, chunk);
				onOutput?.(chunk);
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr = appendOutput(stderr, chunk);
				onOutput?.(chunk);
			});
			child.once("error", (error: NodeJS.ErrnoException) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				reject(new Error(`CLI command failed to start: ${file} (${error.code ?? error.message})`));
			});
			child.once("close", (exitCode) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve({ stdout, stderr, exitCode });
			});
		});
	}

	private requireProvider(
		pluginId: string,
		providerId: string,
	): {
		plugin: ReturnType<typeof listPlugins>[number];
		provider: PluginCliProviderManifest;
	} {
		const plugin = this.dependencies.listPlugins().find((candidate) => candidate.id === pluginId);
		if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
		const provider = plugin.cliProviders?.find((candidate) => candidate.id === providerId);
		if (!provider) throw new Error(`CLI provider not declared: ${pluginId}/${providerId}`);
		return { plugin, provider };
	}

	private requireReadyProvider(pluginId: string, providerId: string) {
		const result = this.requireProvider(pluginId, providerId);
		if (!result.plugin.enabled) throw new Error(`Plugin disabled: ${pluginId}`);
		if (this.statuses.get(providerKey(pluginId, providerId))?.phase !== "ready") {
			throw new Error(`CLI provider is not ready: ${pluginId}/${providerId}`);
		}
		return result;
	}

	private setStatus(pluginId: string, status: PluginCliProviderStatus): void {
		this.statuses.set(providerKey(pluginId, status.providerId), status);
		setPluginCliProviderReady(pluginId, status.providerId, status.phase === "ready");
		this.dependencies.broadcast(PLUGIN_EXECUTION_CHANNELS.CLI_PROVIDER_STATUS, { pluginId, status });
	}

	private stopInstall(key: string): void {
		const child = this.installProcesses.get(key);
		if (child) killTree(child);
		this.installProcesses.delete(key);
	}

	private bumpGeneration(key: string): void {
		this.providerGenerations.set(key, (this.providerGenerations.get(key) ?? 0) + 1);
	}

	private isCurrentGeneration(key: string, generation: number): boolean {
		return (this.providerGenerations.get(key) ?? 0) === generation;
	}
}

export const pluginCliProviderService = new PluginCliProviderService();
