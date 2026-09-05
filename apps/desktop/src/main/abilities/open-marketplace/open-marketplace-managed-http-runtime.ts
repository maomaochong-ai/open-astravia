import { type ChildProcess, execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";

export const MANAGED_HTTP_RUNTIME_FILE = ".managed-http-runtime.json";
export const MANAGED_HTTP_PORT_TOKEN = `\${VETTA_MCP_PORT}`;

export interface ManagedHttpRuntimeSetup {
	readonly kind: "http-qrcode";
	readonly statusPath: string;
	readonly qrcodePath: string;
	readonly logoutPath: string;
}

export interface ManagedHttpRuntimeSpec {
	readonly schemaVersion: 2;
	readonly id: string;
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string>>;
	readonly cwd?: string;
	readonly mcpPath: string;
	readonly readyTimeoutMs: number;
	readonly configurableEnvKeys: readonly string[];
	readonly setup?: ManagedHttpRuntimeSetup;
}

interface RunningRuntime {
	readonly child: ChildProcess;
	readonly url: string;
	readonly environmentKey: string;
}

export interface ManagedHttpRuntimeServiceOptions {
	readonly rootDir: string;
	readonly fetchImpl?: typeof fetch;
	readonly spawnProcess?: typeof spawn;
	readonly allocatePort?: () => Promise<number>;
	readonly wait?: (milliseconds: number) => Promise<void>;
	readonly onDiagnostic?: (message: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isContained(parent: string, target: string): boolean {
	const pathFromParent = relative(parent, target);
	return (
		pathFromParent === "" ||
		(!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== ".." && !isAbsolute(pathFromParent))
	);
}

export function isManagedHttpPath(value: unknown): value is string {
	return typeof value === "string" && /^\/(?!\/)/.test(value) && !/[\\\x00-\x20#?]/.test(value);
}

function readPath(value: unknown, field: string): string {
	if (!isManagedHttpPath(value)) {
		throw new Error(`Managed HTTP runtime ${field} must be a local absolute URL path`);
	}
	return value;
}

function readStringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
		throw new Error(`Managed HTTP runtime ${field} must be a string array`);
	}
	return [...value];
}

function readStringRecord(value: unknown, field: string): Record<string, string> {
	if (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== "string")) {
		throw new Error(`Managed HTTP runtime ${field} must be a string record`);
	}
	return { ...value } as Record<string, string>;
}

export function parseManagedHttpRuntimeSpec(
	value: unknown,
	rootDir: string,
	expectedId: string,
): ManagedHttpRuntimeSpec {
	if (!isRecord(value) || value.schemaVersion !== 2 || value.id !== expectedId) {
		throw new Error("Invalid managed HTTP runtime spec");
	}
	if (!/^[a-zA-Z0-9._-]+$/.test(expectedId)) throw new Error("Invalid managed HTTP runtime id");
	if (typeof value.command !== "string" || !isAbsolute(value.command)) {
		throw new Error("Managed HTTP runtime command must be absolute");
	}
	const abilityRoot = join(rootDir, expectedId);
	if (!isContained(join(abilityRoot, "runtime"), value.command)) {
		throw new Error("Managed HTTP runtime command must stay inside its runtime directory");
	}
	if (value.cwd !== undefined && (typeof value.cwd !== "string" || !isContained(abilityRoot, value.cwd))) {
		throw new Error("Managed HTTP runtime cwd must stay inside its ability directory");
	}
	const readyTimeoutMs = value.readyTimeoutMs;
	if (
		typeof readyTimeoutMs !== "number" ||
		!Number.isInteger(readyTimeoutMs) ||
		readyTimeoutMs < 1 ||
		readyTimeoutMs > 600_000
	) {
		throw new Error("Invalid managed HTTP runtime readyTimeoutMs");
	}
	const configurableEnvKeys = readStringArray(value.configurableEnvKeys, "configurableEnvKeys");
	if (
		configurableEnvKeys.some((key) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) ||
		new Set(configurableEnvKeys).size !== configurableEnvKeys.length
	) {
		throw new Error("Invalid managed HTTP runtime configurableEnvKeys");
	}
	let setup: ManagedHttpRuntimeSetup | undefined;
	if (value.setup !== undefined) {
		if (!isRecord(value.setup) || value.setup.kind !== "http-qrcode") {
			throw new Error("Invalid managed HTTP runtime setup");
		}
		setup = {
			kind: "http-qrcode",
			statusPath: readPath(value.setup.statusPath, "setup.statusPath"),
			qrcodePath: readPath(value.setup.qrcodePath, "setup.qrcodePath"),
			logoutPath: readPath(value.setup.logoutPath, "setup.logoutPath"),
		};
	}
	return {
		schemaVersion: 2,
		id: expectedId,
		command: value.command,
		args: readStringArray(value.args, "args"),
		env: readStringRecord(value.env, "env"),
		...(value.cwd === undefined ? {} : { cwd: value.cwd as string }),
		mcpPath: readPath(value.mcpPath, "mcpPath"),
		readyTimeoutMs,
		configurableEnvKeys,
		...(setup ? { setup } : {}),
	};
}

async function allocateLoopbackPort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.unref();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address === null || typeof address === "string") {
				server.close(() => reject(new Error("Failed to allocate a managed MCP loopback port")));
				return;
			}
			server.close(() => resolve(address.port));
		});
	});
}

function stopProcessTree(child: ChildProcess): Promise<void> {
	if (!child.pid || child.exitCode !== null) return Promise.resolve();
	if (process.platform === "win32") {
		return new Promise((resolve) => {
			execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => resolve());
		});
	}
	child.kill("SIGTERM");
	return Promise.resolve();
}

/** Desktop-owned lifecycle for marketplace binaries that expose Streamable HTTP directly. */
export class ManagedHttpRuntimeService {
	private readonly fetchImpl: typeof fetch;
	private readonly spawnProcess: typeof spawn;
	private readonly allocatePort: () => Promise<number>;
	private readonly wait: (milliseconds: number) => Promise<void>;
	private readonly onDiagnostic: (message: string) => void;
	private readonly running = new Map<string, RunningRuntime>();
	private readonly starting = new Map<
		string,
		{ promise: Promise<string>; controller: AbortController; environmentKey: string }
	>();

	constructor(private readonly options: ManagedHttpRuntimeServiceOptions) {
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.spawnProcess = options.spawnProcess ?? spawn;
		this.allocatePort = options.allocatePort ?? allocateLoopbackPort;
		this.wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
		this.onDiagnostic = options.onDiagnostic ?? (() => undefined);
	}

	async readSpec(id: string): Promise<ManagedHttpRuntimeSpec> {
		if (!/^[a-zA-Z0-9._-]+$/.test(id)) throw new Error("Invalid managed HTTP runtime id");
		const raw = JSON.parse(
			await readFile(join(this.options.rootDir, id, MANAGED_HTTP_RUNTIME_FILE), "utf8"),
		) as unknown;
		return parseManagedHttpRuntimeSpec(raw, this.options.rootDir, id);
	}

	async ensure(id: string, environment: Readonly<Record<string, string>> = {}): Promise<string> {
		const spec = await this.readSpec(id);
		const overrides = this.validateEnvironmentOverrides(spec, environment);
		const environmentKey = JSON.stringify(
			Object.entries(overrides).sort(([left], [right]) => left.localeCompare(right)),
		);
		const pending = this.starting.get(id);
		if (pending) {
			if (pending.environmentKey === environmentKey) return pending.promise;
			pending.controller.abort();
			await pending.promise.catch(() => undefined);
		}
		const active = this.running.get(id);
		if (
			active &&
			active.environmentKey === environmentKey &&
			active.child.exitCode === null &&
			!active.child.killed
		) {
			return active.url;
		}
		if (active) {
			this.running.delete(id);
			await stopProcessTree(active.child);
		}
		const controller = new AbortController();
		const start = this.start(spec, overrides, environmentKey, controller.signal).finally(() =>
			this.starting.delete(id),
		);
		this.starting.set(id, { promise: start, controller, environmentKey });
		return start;
	}

	async stop(id: string): Promise<void> {
		const pending = this.starting.get(id);
		pending?.controller.abort();
		await pending?.promise.catch(() => undefined);
		const runtime = this.running.get(id);
		this.running.delete(id);
		if (runtime) await stopProcessTree(runtime.child);
	}

	async stopAll(): Promise<void> {
		await Promise.all([...new Set([...this.running.keys(), ...this.starting.keys()])].map((id) => this.stop(id)));
	}

	private validateEnvironmentOverrides(
		spec: ManagedHttpRuntimeSpec,
		environment: Readonly<Record<string, string>>,
	): Record<string, string> {
		const allowed = new Set(spec.configurableEnvKeys);
		const overrides: Record<string, string> = {};
		for (const [key, value] of Object.entries(environment)) {
			if (!allowed.has(key)) throw new Error(`Managed HTTP runtime environment key is not configurable: ${key}`);
			if (value.trim()) overrides[key] = value.trim();
		}
		return overrides;
	}

	private async start(
		spec: ManagedHttpRuntimeSpec,
		environment: Readonly<Record<string, string>>,
		environmentKey: string,
		signal: AbortSignal,
	): Promise<string> {
		const id = spec.id;
		signal.throwIfAborted();
		const port = await this.allocatePort();
		signal.throwIfAborted();
		const replacePort = (value: string): string => value.replaceAll(MANAGED_HTTP_PORT_TOKEN, String(port));
		const url = `http://127.0.0.1:${port}${spec.mcpPath}`;
		const child = this.spawnProcess(spec.command, spec.args.map(replacePort), {
			cwd: spec.cwd,
			env: {
				...process.env,
				HOME: process.env.HOME || homedir(),
				...Object.fromEntries(Object.entries(spec.env).map(([key, value]) => [key, replacePort(value)])),
				...environment,
			},
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let spawnError: Error | undefined;
		child.once("error", (error) => {
			spawnError = error;
		});
		this.running.set(id, { child, url, environmentKey });
		child.stdout?.on("data", (data: Buffer) => this.onDiagnostic(`[${id}] ${data.toString().trimEnd()}`));
		child.stderr?.on("data", (data: Buffer) => this.onDiagnostic(`[${id}] ${data.toString().trimEnd()}`));
		child.once("exit", (code, signal) => {
			if (this.running.get(id)?.child === child) this.running.delete(id);
			this.onDiagnostic(`[${id}] exited code=${code ?? "null"} signal=${signal ?? "null"}`);
		});
		try {
			await this.waitForReady(url, child, spec.readyTimeoutMs, signal, () => spawnError);
			return url;
		} catch (error) {
			if (this.running.get(id)?.child === child) this.running.delete(id);
			await stopProcessTree(child);
			throw error;
		}
	}

	private async waitForReady(
		url: string,
		child: ChildProcess,
		timeoutMs: number,
		signal: AbortSignal,
		getSpawnError: () => Error | undefined,
	): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			signal.throwIfAborted();
			const spawnError = getSpawnError();
			if (spawnError) throw spawnError;
			if (child.exitCode !== null) throw new Error("Managed MCP service exited before it became ready");
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), 1_000);
			try {
				const response = await this.fetchImpl(url, {
					method: "HEAD",
					redirect: "error",
					signal: AbortSignal.any([controller.signal, signal]),
				});
				if (!response.ok && response.status !== 405 && response.status !== 406)
					throw new Error(`MCP readiness HTTP ${response.status}`);
				signal.throwIfAborted();
				if (getSpawnError()) throw getSpawnError();
				return;
			} catch {
				await this.wait(300);
			} finally {
				clearTimeout(timer);
			}
		}
		throw new Error("Managed MCP service did not become ready in time");
	}
}
