import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstalledPlugin, PluginCommandRunResult } from "../../preload/api-types/plugins.js";
import { clearPluginCliProviderReadiness } from "./plugin-cli-provider-readiness.js";
import { PluginCliProviderService } from "./plugin-cli-provider-service.js";

vi.mock("./plugin-catalog.js", () => ({ listPlugins: () => [] }));
vi.mock("./plugin-runtime-service.js", () => ({ refreshAgentPlugins: vi.fn() }));
vi.mock("electron", () => ({ webContents: { getAllWebContents: () => [] } }));
vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

function plugin(
	cliProviders: NonNullable<InstalledPlugin["cliProviders"]> = [
		{
			id: "lark-cli",
			command: "lark-cli",
			probe: { args: ["--version"] },
			install: { command: "npx", args: ["-y", "@larksuite/cli@latest", "install"] },
		},
	],
): InstalledPlugin {
	return {
		id: "feishu",
		name: "Feishu",
		version: "1.0.0",
		activeVersion: "1.0.0",
		pluginApiVersion: "^1.4.0",
		entryUrl: "vetta-plugin://feishu/index.js",
		moduleFederation: { remoteName: "feishu", expose: "./plugin" },
		styleUrls: [],
		permissions: [],
		grantedPermissions: [],
		allowedNetworkHosts: [],
		allowedBrowserHosts: [],
		declaredCommands: [],
		grantedCommandNames: [],
		cliProviders,
		defaultLocale: "en",
		locales: {},
		enabled: true,
		required: false,
		installedAt: "2026-09-01T00:00:00.000Z",
		updatedAt: "2026-09-01T00:00:00.000Z",
		source: "remote",
		trustLevel: "community",
		rootPath: "C:/plugins/feishu",
	};
}

afterEach(() => clearPluginCliProviderReadiness("feishu"));

describe("PluginCliProviderService", () => {
	it("probes, installs, verifies and publishes real lifecycle phases", async () => {
		const calls: Array<{ file: string; args: string[] }> = [];
		const results: PluginCommandRunResult[] = [
			{ stdout: "", stderr: "missing", exitCode: 1 },
			{ stdout: "installed", stderr: "", exitCode: 0 },
			{ stdout: "lark-cli 1.0.0", stderr: "", exitCode: 0 },
		];
		const events: Array<{ status: { phase: string; recentOutput: string } }> = [];
		const refreshRuntime = vi.fn();
		const service = new PluginCliProviderService({
			listPlugins: () => [plugin()],
			refreshRuntime,
			broadcast: (_channel, payload) => events.push(payload as (typeof events)[number]),
			runProcess: async (file, args, _timeout, _options, callbacks) => {
				calls.push({ file, args });
				if (file === "npx") callbacks.onOutput?.(Buffer.from("Downloading official CLI\n"));
				return results.shift() ?? { stdout: "", stderr: "", exitCode: 1 };
			},
		});

		await service.retry("feishu", "lark-cli");

		expect(calls).toEqual([
			{ file: "lark-cli", args: ["--version"] },
			{ file: "npx", args: ["-y", "@larksuite/cli@latest", "install"] },
			{ file: "lark-cli", args: ["--version"] },
		]);
		expect(events.map((event) => event.status.phase)).toEqual([
			"checking",
			"installing",
			"installing",
			"verifying",
			"ready",
		]);
		expect(events[2]?.status.recentOutput).toContain("Downloading official CLI");
		expect(service.arePluginProvidersReady("feishu")).toBe(true);
		expect(refreshRuntime).toHaveBeenCalledOnce();
	});

	it("skips installation when the declared executable already passes its probe", async () => {
		let runCount = 0;
		const service = new PluginCliProviderService({
			listPlugins: () => [plugin()],
			refreshRuntime: vi.fn(),
			broadcast: vi.fn(),
			runProcess: async (): Promise<PluginCommandRunResult> => {
				runCount += 1;
				return { stdout: "lark-cli 1.0.0", stderr: "", exitCode: 0 };
			},
		});

		await service.retry("feishu", "lark-cli");

		expect(runCount).toBe(1);
		expect(service.getStatus("feishu", "lark-cli").phase).toBe("ready");
	});

	it("does not let a cancelled install overwrite the disabled state", async () => {
		let runCount = 0;
		let finishInstall: ((result: PluginCommandRunResult) => void) | undefined;
		const service = new PluginCliProviderService({
			listPlugins: () => [plugin()],
			refreshRuntime: vi.fn(),
			broadcast: vi.fn(),
			runProcess: async (): Promise<PluginCommandRunResult> => {
				runCount += 1;
				if (runCount === 1) return { stdout: "", stderr: "missing", exitCode: 1 };
				return await new Promise((resolve) => {
					finishInstall = resolve;
				});
			},
		});

		const attempt = service.retry("feishu", "lark-cli");
		await vi.waitFor(() => expect(runCount).toBe(2));
		service.disablePlugin("feishu");
		finishInstall?.({ stdout: "installed", stderr: "", exitCode: 0 });
		await attempt;

		expect(service.getStatus("feishu", "lark-cli").phase).toBe("disabled");
	});

	it("isolates retries when one plugin declares multiple providers", async () => {
		let finishOtherProbe: ((result: PluginCommandRunResult) => void) | undefined;
		const installedPlugin = plugin([
			...(plugin().cliProviders ?? []),
			{
				id: "other-cli",
				command: "other-cli",
				probe: { args: ["--version"] },
				install: { command: "other-installer" },
			},
		]);
		const service = new PluginCliProviderService({
			listPlugins: () => [installedPlugin],
			refreshRuntime: vi.fn(),
			broadcast: vi.fn(),
			runProcess: async (file): Promise<PluginCommandRunResult> => {
				if (file !== "other-cli") return { stdout: "ready", stderr: "", exitCode: 0 };
				return await new Promise((resolve) => {
					finishOtherProbe = resolve;
				});
			},
		});

		expect(service.getStatus("feishu", "other-cli").phase).toBe("checking");
		await vi.waitFor(() => expect(finishOtherProbe).toBeTypeOf("function"));
		await service.retry("feishu", "lark-cli");
		finishOtherProbe?.({ stdout: "other ready", stderr: "", exitCode: 0 });

		await vi.waitFor(() => expect(service.getStatus("feishu", "other-cli").phase).toBe("ready"));
	});
});
