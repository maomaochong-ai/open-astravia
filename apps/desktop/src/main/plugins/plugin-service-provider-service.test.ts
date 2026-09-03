import { ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginServiceProviderManifest } from "@vetta-org/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstalledPlugin } from "../../preload/api-types/plugins.js";
import { PluginServiceProviderService } from "./plugin-service-provider-service.js";

vi.mock("./plugin-catalog.js", () => ({ listPlugins: () => [] }));
vi.mock("electron", () => ({ webContents: { getAllWebContents: () => [] } }));
vi.mock("../logger.js", () => ({ getAppLogger: () => ({ warn: vi.fn() }) }));

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "vetta-service-lifecycle-"));
	directories.push(root);
	const dataDirectory = join(root, "data");
	const cacheDirectory = join(root, "cache");
	await mkdir(dataDirectory);
	await mkdir(cacheDirectory);
	await writeFile(
		join(root, "config.tpl"),
		`port=\${VETTA_SERVICE_PORT}\nruntime=\${VETTA_SERVICE_RUNTIME_DIR}\nkey=\${VETTA_SERVICE_SECRET_API_KEY}`,
	);
	const manifest: PluginServiceProviderManifest = {
		id: "bridge",
		runtime: { version: "1.0.0", platforms: {} },
		credentials: [{ id: "api-key" }],
		templates: [
			{ source: "config.tpl", destination: "generated.conf", mode: "render" },
			{ source: "config.tpl", destination: "user.conf", mode: "create" },
		],
		process: { args: ["--config", `\${VETTA_SERVICE_CACHE_DIR}/generated.conf`] },
		health: { path: "/health", credentialId: "api-key" },
	};
	const plugin: InstalledPlugin = {
		id: "managed-bridge",
		name: "Managed Bridge",
		version: "1.0.0",
		activeVersion: "1.0.0",
		pluginApiVersion: "^1.5.0",
		entryUrl: "vetta-plugin://managed-bridge/index.js",
		moduleFederation: { remoteName: "managed_bridge", expose: "./plugin" },
		styleUrls: [],
		permissions: [],
		grantedPermissions: [],
		allowedNetworkHosts: [],
		allowedBrowserHosts: [],
		declaredCommands: [],
		grantedCommandNames: [],
		defaultLocale: "en",
		locales: {},
		enabled: true,
		required: false,
		installedAt: "2026-09-03T00:00:00Z",
		updatedAt: "2026-09-03T00:00:00Z",
		source: "remote",
		trustLevel: "community",
		rootPath: root,
		serviceProviders: [manifest],
	};
	const paths = () => ({
		rootDirectory: root,
		runtimeDirectory: join(root, manifest.runtime.version),
		dataDirectory,
		cacheDirectory,
		executable: join(root, "bridge.exe"),
	});
	const resolveRuntime = vi.fn(async () => paths());
	const installRuntime = vi.fn(async () => paths());
	const children: ChildProcess[] = [];
	const spawnProcess = vi.fn(() => {
		const child = new ChildProcess();
		children.push(child);
		return child;
	});
	const killProcess = vi.fn((child: ChildProcess) => {
		child.emit("exit", 0, null);
	});
	const fetchClient = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }));
	let port = 19000;
	const service = new PluginServiceProviderService({
		listPlugins: () => [plugin],
		installer: { getPlatform: () => ({ tag: "win32-x64" }), install: installRuntime, resolve: resolveRuntime },
		fetchClient,
		spawnProcess,
		killProcess,
		allocatePort: async () => ++port,
		broadcast: vi.fn(),
	});
	return {
		service,
		manifest,
		plugin,
		paths,
		resolveRuntime,
		installRuntime,
		spawnProcess,
		children,
		fetchClient,
		killProcess,
	};
}

describe("PluginServiceProviderService", () => {
	it("regenerates the current port and runtime while preserving data and credentials across restarts and upgrades", async () => {
		const f = await fixture();
		await f.service.start(f.plugin.id, "bridge");
		const firstConnection = f.service.connection(f.plugin.id, "bridge", "api-key");
		await writeFile(join(f.paths().dataDirectory, "user.conf"), "user-owned");
		f.plugin.serviceProviders = [{ ...f.manifest, runtime: { ...f.manifest.runtime, version: "2.0.0" } }];
		await f.service.restart(f.plugin.id, "bridge");
		const next = f.service.connection(f.plugin.id, "bridge", "api-key");
		const config = await readFile(join(f.paths().cacheDirectory, "generated.conf"), "utf8");
		expect(next.baseUrl).not.toBe(firstConnection.baseUrl);
		expect(next.credential).toBe(firstConnection.credential);
		expect(config).toContain(`port=${new URL(next.baseUrl).port}`);
		expect(config).toContain(f.paths().runtimeDirectory);
		expect(await readFile(join(f.paths().dataDirectory, "user.conf"), "utf8")).toBe("user-owned");
		expect((await f.service.getStatus(f.plugin.id, "bridge")).version).toBe("2.0.0");
		f.service.stopAll();
	});

	it("cancels startup while installation is pending and allows a later restart", async () => {
		const f = await fixture();
		let release!: () => void;
		f.resolveRuntime.mockImplementationOnce(async () => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return f.paths();
		});
		const starting = f.service.start(f.plugin.id, "bridge");
		await f.service.stop(f.plugin.id, "bridge");
		release();
		await starting;
		expect(f.spawnProcess).not.toHaveBeenCalled();
		expect((await f.service.getStatus(f.plugin.id, "bridge")).phase).toBe("stopped");
		await f.service.start(f.plugin.id, "bridge");
		expect((await f.service.getStatus(f.plugin.id, "bridge")).phase).toBe("ready");
		f.service.stopAll();
	});

	it("ignores late exits from a disabled process after re-enabling", async () => {
		const f = await fixture();
		await f.service.start(f.plugin.id, "bridge");
		f.killProcess.mockImplementation(() => undefined);
		f.service.disablePlugin(f.plugin.id);
		await f.service.start(f.plugin.id, "bridge");
		f.children[0]?.emit("exit", 0, null);
		expect((await f.service.getStatus(f.plugin.id, "bridge")).phase).toBe("ready");
		expect(f.service.connection(f.plugin.id, "bridge").baseUrl).toBe("http://127.0.0.1:19002");
	});

	it("enforces ownership, credential declarations, same-origin requests and disabled services", async () => {
		const f = await fixture();
		await f.service.start(f.plugin.id, "bridge");
		await expect(f.service.request(f.plugin.id, "bridge", { path: "//example.com" })).rejects.toThrow(
			"root-relative",
		);
		await expect(f.service.request(f.plugin.id, "bridge", { path: "/\\example.com" })).rejects.toThrow(
			"loopback origin",
		);
		expect(() => f.service.connection("other", "bridge")).toThrow("Plugin not found");
		expect(() => f.service.connection(f.plugin.id, "bridge", "unknown")).toThrow("not declared");
		await f.service.request(f.plugin.id, "bridge", { path: "/models", credentialId: "api-key" });
		const init = f.fetchClient.mock.calls.at(-1)?.[1];
		expect(init?.redirect).toBe("manual");
		expect(new Headers(init?.headers).get("Authorization")).toBe(
			`Bearer ${f.service.connection(f.plugin.id, "bridge", "api-key").credential}`,
		);
		f.plugin.enabled = false;
		expect(() => f.service.connection(f.plugin.id, "bridge")).toThrow("Plugin disabled");
		f.service.stopAll();
	});

	it("does not rotate malformed persisted credentials or spawn with a broken secret store", async () => {
		const f = await fixture();
		await writeFile(join(f.paths().dataDirectory, "service-secrets.json"), "broken");
		expect((await f.service.start(f.plugin.id, "bridge")).phase).toBe("failed");
		expect(f.spawnProcess).not.toHaveBeenCalled();
		expect(await readFile(join(f.paths().dataDirectory, "service-secrets.json"), "utf8")).toBe("broken");
	});

	it("accepts only plugin-supplied runtime bytes and reports the host platform", async () => {
		const f = await fixture();
		expect(f.service.getPlatform()).toEqual({ tag: "win32-x64" });
		const payloads = [{ destination: "core", data: "YmluYXJ5" }];
		expect((await f.service.install(f.plugin.id, "bridge", payloads)).installed).toBe(true);
		expect(f.installRuntime).toHaveBeenCalledWith(f.plugin.id, f.manifest, payloads);
	});

	it("requires the plugin to provision a newly declared runtime version after reload", async () => {
		const f = await fixture();
		await f.service.start(f.plugin.id, "bridge");
		f.service.disablePlugin(f.plugin.id);
		f.plugin.serviceProviders = [{ ...f.manifest, runtime: { ...f.manifest.runtime, version: "2.0.0" } }];
		f.resolveRuntime.mockRejectedValueOnce(new Error("missing v2"));
		const status = await f.service.getStatus(f.plugin.id, "bridge");
		expect(status).toMatchObject({ version: "2.0.0", phase: "stopped", installed: false });
	});
});
