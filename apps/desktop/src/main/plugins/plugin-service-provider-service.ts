import { type ChildProcess, execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type {
	PluginServiceArtifactPayload,
	PluginServiceConnection,
	PluginServiceHostPlatform,
	PluginServiceProviderManifest,
	PluginServiceRequest,
	PluginServiceResponse,
	PluginServiceStatus,
} from "@vetta-org/plugin-sdk";
import { webContents } from "electron";
import { PLUGIN_EXECUTION_CHANNELS } from "../../shared/plugin-ipc.js";
import { getAppLogger } from "../logger.js";
import { createPluginCommandEnvironment } from "./command-environment.js";
import { spawnCrossPlatformCommand } from "./command-launcher.js";
import { listPlugins } from "./plugin-catalog.js";
import { readPluginServiceResponse } from "./plugin-service-response.js";
import { PluginServiceRuntimeInstaller, type PluginServiceRuntimePaths } from "./plugin-service-runtime-installer.js";

const serviceLog = getAppLogger("plugin");
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_TEMPLATE_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const DEFAULT_STARTUP_TIMEOUT_MS = 45_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const STOP_GRACE_MS = 3_000;
const TOKEN_PATTERN = /\$\{VETTA_SERVICE_(PORT|RUNTIME_DIR|DATA_DIR|CACHE_DIR|SECRET_([A-Z0-9_]+))\}/g;

interface ServiceSecrets {
	schemaVersion: 1;
	values: Record<string, string>;
}

interface ServiceRecord {
	pluginId: string;
	service: PluginServiceProviderManifest;
	status: PluginServiceStatus;
	child?: ChildProcess;
	baseUrl?: string;
	secrets?: ServiceSecrets;
	transportReady: boolean;
	operation?: Promise<PluginServiceStatus>;
	stopping?: Promise<PluginServiceStatus>;
	generation: number;
}

interface PluginServiceProviderDependencies {
	listPlugins: typeof listPlugins;
	installer: Pick<PluginServiceRuntimeInstaller, "getPlatform" | "install" | "resolve">;
	fetchClient: (url: string, init?: RequestInit) => Promise<Response>;
	spawnProcess: typeof spawnCrossPlatformCommand;
	killProcess: typeof killTree;
	allocatePort: typeof allocateLoopbackPort;
	broadcast(channel: string, payload: unknown): void;
}

function serviceKey(pluginId: string, serviceId: string): string {
	return `${pluginId}:${serviceId}`;
}

function appendOutput(current: string, chunk: Buffer | string): string {
	const next = current + chunk.toString();
	return next.length <= MAX_OUTPUT_BYTES ? next : next.slice(next.length - MAX_OUTPUT_BYTES);
}

function broadcast(channel: string, payload: unknown): void {
	for (const contents of webContents.getAllWebContents()) {
		if (!contents.isDestroyed()) contents.send(channel, payload);
	}
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

async function allocateLoopbackPort(): Promise<number> {
	return await new Promise<number>((resolvePort, reject) => {
		const server = createServer();
		server.unref();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address == null || typeof address === "string") {
				server.close();
				reject(new Error("Failed to allocate loopback port"));
				return;
			}
			server.close((error) => (error ? reject(error) : resolvePort(address.port)));
		});
	});
}

function isContained(parent: string, target: string): boolean {
	const fromParent = relative(parent, target);
	return fromParent === "" || (!fromParent.startsWith(`..${sep}`) && fromParent !== ".." && !isAbsolute(fromParent));
}

function secretTokenName(id: string): string {
	return id.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function isServiceSecrets(value: unknown): value is ServiceSecrets {
	if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	if (
		record.schemaVersion !== 1 ||
		record.values == null ||
		typeof record.values !== "object" ||
		Array.isArray(record.values)
	) {
		return false;
	}
	return Object.values(record.values).every((item) => typeof item === "string");
}

async function readOrCreateSecrets(
	dataDirectory: string,
	service: PluginServiceProviderManifest,
): Promise<ServiceSecrets> {
	const path = join(dataDirectory, "service-secrets.json");
	let secrets: ServiceSecrets = { schemaVersion: 1, values: {} };
	try {
		const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
		if (!isServiceSecrets(parsed)) throw new Error("Invalid persisted service credentials");
		secrets = parsed;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	let changed = false;
	for (const credential of service.credentials ?? []) {
		if (secrets.values[credential.id]) continue;
		secrets.values[credential.id] = randomBytes(credential.bytes ?? 32).toString("base64url");
		changed = true;
	}
	if (changed || !existsSync(path)) await writeFile(path, JSON.stringify(secrets), { mode: 0o600 });
	return secrets;
}

function replacementValues(
	paths: PluginServiceRuntimePaths,
	port: number,
	secrets: ServiceSecrets,
): Record<string, string> {
	const values: Record<string, string> = {
		PORT: String(port),
		RUNTIME_DIR: paths.runtimeDirectory,
		DATA_DIR: paths.dataDirectory,
		CACHE_DIR: paths.cacheDirectory,
	};
	for (const [id, value] of Object.entries(secrets.values)) values[`SECRET_${secretTokenName(id)}`] = value;
	return values;
}

function replaceTokens(value: string, values: Record<string, string>): string {
	return value.replace(TOKEN_PATTERN, (match, key: string) => values[key] ?? match);
}

async function materializeTemplates(
	pluginRoot: string,
	paths: PluginServiceRuntimePaths,
	service: PluginServiceProviderManifest,
	values: Record<string, string>,
): Promise<void> {
	for (const template of service.templates ?? []) {
		const source = resolve(pluginRoot, template.source);
		const destinationRoot = template.mode === "render" ? paths.cacheDirectory : paths.dataDirectory;
		const destination = resolve(destinationRoot, template.destination);
		if (!isContained(pluginRoot, source) || !isContained(destinationRoot, destination)) {
			throw new Error(`Unsafe service template path: ${template.source}`);
		}
		if (template.mode === "create" && existsSync(destination)) continue;
		const content = await readFile(source, "utf8");
		if (Buffer.byteLength(content) > MAX_TEMPLATE_BYTES) throw new Error("Service template is too large");
		await mkdir(dirname(destination), { recursive: true });
		await writeFile(destination, replaceTokens(content, values), {
			mode: 0o600,
			flag: template.mode === "render" ? "w" : "wx",
		});
	}
}

function credentialFor(record: ServiceRecord, credentialId: string | undefined): string | undefined {
	if (!credentialId) return undefined;
	if (!record.service.credentials?.some((credential) => credential.id === credentialId)) {
		throw new Error(`Service credential not declared: ${record.service.id}/${credentialId}`);
	}
	const value = record.secrets?.values[credentialId];
	if (!value) throw new Error(`Service credential unavailable: ${record.service.id}/${credentialId}`);
	return value;
}

function normalizeRequest(
	request: PluginServiceRequest,
): Required<Pick<PluginServiceRequest, "path" | "method" | "responseType" | "timeoutMs">> & PluginServiceRequest {
	if (!request || typeof request !== "object") throw new Error("Invalid service request");
	if (typeof request.path !== "string" || !request.path.startsWith("/") || request.path.startsWith("//")) {
		throw new Error("Service request path must be root-relative");
	}
	const method = request.method ?? "GET";
	if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new Error("Invalid service request method");
	const timeoutMs = request.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
	if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000)
		throw new Error("Invalid service request timeout");
	return { ...request, method, responseType: request.responseType ?? "json", timeoutMs };
}

export class PluginServiceProviderService {
	private readonly records = new Map<string, ServiceRecord>();

	constructor(
		private readonly dependencies: PluginServiceProviderDependencies = (() => {
			const rootDirectory = join(getVettaHomePath(), "plugin-services");
			return {
				listPlugins,
				installer: new PluginServiceRuntimeInstaller(rootDirectory),
				fetchClient: fetch,
				spawnProcess: spawnCrossPlatformCommand,
				killProcess: killTree,
				allocatePort: allocateLoopbackPort,
				broadcast,
			};
		})(),
	) {}

	getPlatform(): PluginServiceHostPlatform {
		const platform = this.dependencies.installer.getPlatform();
		if (!/^(win32|darwin|linux)-(x64|arm64)$/.test(platform.tag)) {
			throw new Error(`Unsupported service host platform: ${platform.tag}`);
		}
		return platform as PluginServiceHostPlatform;
	}

	async getStatus(pluginId: string, serviceId: string): Promise<PluginServiceStatus> {
		const { plugin, service } = this.requireService(pluginId, serviceId);
		if (!plugin.enabled) return this.statusFor(service, "disabled");
		const existing = this.records.get(serviceKey(pluginId, serviceId));
		if (existing && JSON.stringify(existing.service) === JSON.stringify(service)) return existing.status;
		const installed = await this.dependencies.installer.resolve(pluginId, service).then(
			() => true,
			() => false,
		);
		if (existing) {
			existing.service = service;
			existing.status = this.statusFor(service, "stopped", installed);
			existing.transportReady = false;
			return existing.status;
		}
		return this.statusFor(service, "stopped", installed);
	}

	async install(
		pluginId: string,
		serviceId: string,
		artifacts: PluginServiceArtifactPayload[],
	): Promise<PluginServiceStatus> {
		const { plugin, service } = this.requireService(pluginId, serviceId);
		if (!plugin.enabled) throw new Error(`Plugin disabled: ${pluginId}`);
		const key = serviceKey(pluginId, serviceId);
		let record = this.records.get(key);
		if (record?.child) throw new Error("Stop the service before installing its runtime");
		if (record?.operation) return record.operation;
		if (!record) {
			record = {
				pluginId,
				service,
				status: this.statusFor(service, "stopped"),
				transportReady: false,
				generation: 0,
			};
			this.records.set(key, record);
		} else {
			record.service = service;
		}
		const generation = ++record.generation;
		this.setStatus(record, "installing");
		const operation = this.dependencies.installer
			.install(pluginId, service, artifacts)
			.then(() =>
				record && record.generation === generation
					? this.setStatus(record, "stopped", undefined, true)
					: record!.status,
			)
			.catch((error: unknown) => {
				if (!record || record.generation !== generation)
					return record?.status ?? this.statusFor(service, "stopped");
				return this.setStatus(record, "failed", error instanceof Error ? error.message : String(error), false);
			})
			.finally(() => {
				if (record?.operation === operation) record.operation = undefined;
			});
		record.operation = operation;
		return operation;
	}

	async start(pluginId: string, serviceId: string): Promise<PluginServiceStatus> {
		const { plugin, service } = this.requireService(pluginId, serviceId);
		if (!plugin.enabled) throw new Error(`Plugin disabled: ${pluginId}`);
		const key = serviceKey(pluginId, serviceId);
		let record = this.records.get(key);
		if (record?.stopping) {
			await record.stopping;
			return this.start(pluginId, serviceId);
		}
		if (record?.status.phase === "ready") {
			if (JSON.stringify(record.service) === JSON.stringify(service)) return record.status;
			await this.stop(pluginId, serviceId);
			return this.start(pluginId, serviceId);
		}
		if (record?.status.phase === "starting" && record.child) {
			if (JSON.stringify(record.service) === JSON.stringify(service)) return record.status;
			await this.stop(pluginId, serviceId);
			return this.start(pluginId, serviceId);
		}
		if (record?.operation) {
			if (["disabled", "stopped", "stopping"].includes(record.status.phase)) {
				await record.operation;
				return this.start(pluginId, serviceId);
			}
			return record.operation;
		}
		if (!record) {
			record = {
				pluginId,
				service,
				status: this.statusFor(service, "stopped"),
				transportReady: false,
				generation: 0,
			};
			this.records.set(key, record);
		} else {
			record.service = service;
			record.status = this.statusFor(service, "stopped");
		}
		const generation = ++record.generation;
		const operation = this.performStart(record, plugin.rootPath, generation).finally(() => {
			if (record?.operation === operation) record.operation = undefined;
		});
		record.operation = operation;
		return operation;
	}

	async stop(pluginId: string, serviceId: string): Promise<PluginServiceStatus> {
		const { service } = this.requireService(pluginId, serviceId);
		const record = this.records.get(serviceKey(pluginId, serviceId));
		if (!record) return this.statusFor(service, "stopped");
		if (record.stopping) return record.stopping;
		record.generation += 1;
		record.transportReady = false;
		if (!record.child) return this.setStatus(record, "stopped");
		this.setStatus(record, "stopping");
		const child = record.child;
		const stopping = new Promise<void>((resolveStop) => {
			const timer = setTimeout(() => this.dependencies.killProcess(child, "SIGKILL"), STOP_GRACE_MS);
			timer.unref();
			child.once("exit", () => {
				clearTimeout(timer);
				resolveStop();
			});
			this.dependencies.killProcess(child);
		})
			.then(() => {
				if (record.child === child) {
					record.child = undefined;
					record.baseUrl = undefined;
					record.transportReady = false;
				}
				return record.status.phase === "disabled" ? record.status : this.setStatus(record, "stopped");
			})
			.finally(() => {
				if (record.stopping === stopping) record.stopping = undefined;
			});
		record.stopping = stopping;
		return stopping;
	}

	async restart(pluginId: string, serviceId: string): Promise<PluginServiceStatus> {
		await this.stop(pluginId, serviceId);
		return this.start(pluginId, serviceId);
	}

	async reportReady(pluginId: string, serviceId: string, ready: boolean): Promise<PluginServiceStatus> {
		const { plugin, service } = this.requireService(pluginId, serviceId);
		if (!plugin.enabled) throw new Error(`Plugin disabled: ${pluginId}`);
		if (service.health.readiness?.mode !== "plugin") {
			throw new Error(`Service does not use plugin readiness: ${pluginId}/${serviceId}`);
		}
		const record = this.records.get(serviceKey(pluginId, serviceId));
		if (!record || !record.child || !record.baseUrl || !record.transportReady) {
			throw new Error(`Service transport is not ready: ${pluginId}/${serviceId}`);
		}
		return this.setStatus(record, ready ? "ready" : "starting");
	}

	disablePlugin(pluginId: string): void {
		for (const record of this.records.values()) {
			if (record.pluginId !== pluginId) continue;
			record.generation += 1;
			if (record.child) this.dependencies.killProcess(record.child, "SIGKILL");
			record.child = undefined;
			record.baseUrl = undefined;
			record.transportReady = false;
			this.setStatus(record, "disabled");
		}
	}

	stopAll(): void {
		for (const record of this.records.values()) {
			record.generation += 1;
			record.transportReady = false;
			if (record.child) this.dependencies.killProcess(record.child, "SIGKILL");
		}
	}

	connection(pluginId: string, serviceId: string, credentialId?: string): PluginServiceConnection {
		const record = this.requireReadyRecord(pluginId, serviceId);
		return { baseUrl: record.baseUrl!, credential: credentialFor(record, credentialId) };
	}

	async request<T = unknown>(
		pluginId: string,
		serviceId: string,
		input: PluginServiceRequest,
	): Promise<PluginServiceResponse<T>> {
		const record = this.requireReadyRecord(pluginId, serviceId);
		return this.requestRecord<T>(record, input);
	}

	private async requestRecord<T>(
		record: ServiceRecord,
		input: PluginServiceRequest,
	): Promise<PluginServiceResponse<T>> {
		const request = normalizeRequest(input);
		const url = new URL(request.path, record.baseUrl);
		if (url.origin !== new URL(record.baseUrl!).origin)
			throw new Error("Service request must stay on its loopback origin");
		const credential = credentialFor(record, request.credentialId);
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), request.timeoutMs);
		try {
			const headers = new Headers(request.headers);
			if (credential) headers.set("Authorization", `Bearer ${credential}`);
			let body: string | undefined;
			if (request.body !== undefined) {
				headers.set("Content-Type", "application/json");
				body = JSON.stringify(request.body);
			}
			const response = await this.dependencies.fetchClient(url.toString(), {
				method: request.method,
				headers,
				body,
				redirect: "manual",
				signal: controller.signal,
			});
			const text = (await readPluginServiceResponse(response, MAX_RESPONSE_BYTES)).toString("utf8");
			const responseBody = request.responseType === "text" || !text ? text : (JSON.parse(text) as unknown);
			return {
				ok: response.ok,
				status: response.status,
				statusText: response.statusText,
				headers: Object.fromEntries(response.headers.entries()),
				body: responseBody as T,
			};
		} finally {
			clearTimeout(timer);
		}
	}

	private async performStart(
		record: ServiceRecord,
		pluginRoot: string,
		generation: number,
	): Promise<PluginServiceStatus> {
		try {
			const paths = await this.dependencies.installer.resolve(record.pluginId, record.service);
			record.status = { ...record.status, installed: true };
			if (record.generation !== generation) return record.status;
			const secrets = await readOrCreateSecrets(paths.dataDirectory, record.service);
			const port = await this.dependencies.allocatePort();
			const values = replacementValues(paths, port, secrets);
			await materializeTemplates(pluginRoot, paths, record.service, values);
			if (record.generation !== generation) return record.status;
			const args = (record.service.process.args ?? []).map((value) => replaceTokens(value, values));
			const env = Object.fromEntries(
				Object.entries(record.service.process.env ?? {}).map(([key, value]) => [key, replaceTokens(value, values)]),
			);
			const child = this.dependencies.spawnProcess(paths.executable, args, {
				cwd: paths.runtimeDirectory,
				env: createPluginCommandEnvironment(env),
				windowsHide: true,
				detached: process.platform !== "win32",
				stdio: ["ignore", "pipe", "pipe"],
			});
			record.child = child;
			record.baseUrl = `http://127.0.0.1:${port}`;
			record.secrets = secrets;
			record.transportReady = false;
			this.setStatus(record, "starting");
			child.stdout?.on("data", (chunk: Buffer) => this.captureOutput(record, chunk));
			child.stderr?.on("data", (chunk: Buffer) => this.captureOutput(record, chunk));
			child.once("exit", (exitCode, signal) => {
				if (record.child !== child || record.generation !== generation) return;
				record.child = undefined;
				record.baseUrl = undefined;
				record.transportReady = false;
				if (record.status.phase === "stopping") return;
				this.setStatus(record, "failed", `Service exited (${exitCode ?? signal ?? "unknown"})`);
			});
			child.once("error", (error: NodeJS.ErrnoException) => {
				if (record.generation === generation) this.setStatus(record, "failed", error.code ?? error.message);
			});
			await this.waitUntilReady(record, generation);
			if (record.generation !== generation) return record.status;
			record.transportReady = true;
			if (record.service.health.readiness?.mode === "plugin") return record.status;
			return this.setStatus(record, "ready");
		} catch (error) {
			if (record.generation !== generation) return record.status;
			const message = error instanceof Error ? error.message : String(error);
			serviceLog.warn("Plugin service failed to start", {
				pluginId: record.pluginId,
				serviceId: record.service.id,
				message,
			});
			if (record.child) this.dependencies.killProcess(record.child, "SIGKILL");
			record.child = undefined;
			record.baseUrl = undefined;
			record.transportReady = false;
			return this.setStatus(record, "failed", message);
		}
	}

	private async waitUntilReady(record: ServiceRecord, generation: number): Promise<void> {
		const deadline = Date.now() + (record.service.health.timeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS);
		let lastStatus: number | undefined;
		while (Date.now() < deadline && record.generation === generation) {
			if (!record.child || record.status.phase === "failed") throw new Error("Service exited before becoming ready");
			try {
				const response = await this.requestRecord(record, {
					path: record.service.health.path,
					credentialId: record.service.health.credentialId,
					responseType: "text",
					timeoutMs: 5_000,
				});
				lastStatus = response.status;
				if (response.ok) return;
			} catch {
				// The process may not have bound its loopback port yet.
			}
			await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
		}
		throw new Error(lastStatus ? `Service health check failed: ${lastStatus}` : "Service startup timed out");
	}

	private captureOutput(record: ServiceRecord, chunk: Buffer): void {
		let output = chunk.toString();
		for (const secret of Object.values(record.secrets?.values ?? {})) {
			if (secret) output = output.replaceAll(secret, "[redacted]");
		}
		record.status = { ...record.status, recentOutput: appendOutput(record.status.recentOutput, output) };
		this.dependencies.broadcast(PLUGIN_EXECUTION_CHANNELS.SERVICE_STATUS, {
			pluginId: record.pluginId,
			status: record.status,
		});
	}

	private setStatus(
		record: ServiceRecord,
		phase: PluginServiceStatus["phase"],
		message?: string,
		installed = record.status.installed,
	): PluginServiceStatus {
		record.status = { ...record.status, phase, message, installed };
		this.dependencies.broadcast(PLUGIN_EXECUTION_CHANNELS.SERVICE_STATUS, {
			pluginId: record.pluginId,
			status: record.status,
		});
		return record.status;
	}

	private statusFor(
		service: PluginServiceProviderManifest,
		phase: PluginServiceStatus["phase"],
		installed = false,
	): PluginServiceStatus {
		return { serviceId: service.id, phase, version: service.runtime.version, installed, recentOutput: "" };
	}

	private requireService(
		pluginId: string,
		serviceId: string,
	): {
		plugin: ReturnType<typeof listPlugins>[number];
		service: PluginServiceProviderManifest;
	} {
		const plugin = this.dependencies.listPlugins().find((candidate) => candidate.id === pluginId);
		if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
		const service = plugin.serviceProviders?.find((candidate) => candidate.id === serviceId);
		if (!service) throw new Error(`Service provider not declared: ${pluginId}/${serviceId}`);
		return { plugin, service };
	}

	private requireReadyRecord(pluginId: string, serviceId: string): ServiceRecord {
		const { plugin } = this.requireService(pluginId, serviceId);
		if (!plugin.enabled) throw new Error(`Plugin disabled: ${pluginId}`);
		const record = this.records.get(serviceKey(pluginId, serviceId));
		const pluginReadinessProbe =
			record?.service.health.readiness?.mode === "plugin" &&
			record.transportReady &&
			record.status.phase === "starting";
		if (!record || (!pluginReadinessProbe && record.status.phase !== "ready") || !record.baseUrl) {
			throw new Error(`Service is not ready: ${pluginId}/${serviceId}`);
		}
		return record;
	}
}

export const pluginServiceProviderService = new PluginServiceProviderService();
