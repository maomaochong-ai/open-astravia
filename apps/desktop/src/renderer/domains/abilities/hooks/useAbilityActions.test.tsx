// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstalledPlugin, McpServerConfigData, OpenMarketplaceMcpRuntimeProgress } from "@preload/api";
import type { McpSettingsModel } from "../../settings/components/useMcpSettingsModel";
import type { McpAbility, PluginAbility } from "../types";

vi.mock("@shared/i18n", () => ({ i18n: { t: (key: string) => key } }));
const showToast = vi.hoisted(() => vi.fn());
const notifyPluginsChanged = vi.hoisted(() => vi.fn());
vi.mock("@shared/store/toast-atoms", () => ({ showToast }));
vi.mock("../../plugins/runtime/plugin-events", () => ({ notifyPluginsChanged }));

const { useAbilityActions } = await import("./useAbilityActions");

function githubMcpAbility(): McpAbility {
	return {
		type: "mcp",
		id: "github:official:mcp:demo-mcp",
		slug: "demo-mcp",
		serverName: "demo-mcp",
		origin: {
			kind: "github-marketplace",
			sourceId: "official",
			marketplace: "official",
			marketplaceVersion: "2026.08.1",
			repository: "https://github.com/example/abilities",
		},
		market: {
			type: "mcp",
			slug: "demo-mcp",
			name: "Demo MCP",
			description: "Managed MCP",
			version: "1.0.0",
			configVersion: 2,
			icon: "",
			config: { mcp: { command: String.raw`\${VETTA_MCP_EXECUTABLE}` } },
		} as unknown as McpAbility["market"],
		preset: {
			id: "github:official:mcp:demo-mcp",
			name: "demo-mcp",
			displayName: "Demo MCP",
			description: "Managed MCP",
			config: { command: String.raw`\${VETTA_MCP_EXECUTABLE}` },
		},
		installConflictIds: [],
		readonly: false,
	} as unknown as McpAbility;
}

function mcpModel(overrides?: Partial<McpSettingsModel>): McpSettingsModel {
	return {
		onAddBuiltinServer: vi.fn(async () => "installed" as const),
		onAddRemoteServer: vi.fn(async () => undefined),
		onDeleteServer: vi.fn(async () => undefined),
		...overrides,
	} as McpSettingsModel;
}

function githubPluginAbility(installed: boolean): PluginAbility {
	return {
		type: "plugin",
		id: "github:official:plugin:demo-plugin",
		slug: "demo-plugin",
		title: "Demo plugin",
		version: "2.0.0",
		installed,
		origin: {
			kind: "github-marketplace",
			sourceId: "official",
			marketplace: "official",
			marketplaceVersion: "2026.09.1",
			repository: "https://github.com/example/abilities",
		},
	} as unknown as PluginAbility;
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

describe("useAbilityActions managed MCP wiring", () => {
	let progressHandler: ((progress: OpenMarketplaceMcpRuntimeProgress) => void) | undefined;

	beforeEach(() => {
		showToast.mockClear();
		notifyPluginsChanged.mockClear();
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: {
				abilities: {
					onMcpRuntimeProgress: vi.fn((handler: (progress: OpenMarketplaceMcpRuntimeProgress) => void) => {
						progressHandler = handler;
						return () => {
							progressHandler = undefined;
						};
					}),
					prepareOpenMcpAbility: vi.fn(async () => ({
						command: "C:/Users/test/.vetta/abilities/mcp/demo/runtime/versions/1.0.0/demo.exe",
						args: ["--stdio"],
					})),
					removeOpenMcpRuntime: vi.fn(async () => undefined),
					installOpenAbility: vi.fn(async () => undefined),
				},
				plugins: {
					applySetup: vi.fn(async () => ({ id: "demo-plugin" }) as InstalledPlugin),
					reload: vi.fn(async () => ({ id: "demo-plugin" }) as InstalledPlugin),
				},
			},
		});
	});

	it("surfaces runtime download progress while preparation is in flight", async () => {
		let resolvePrepare!: (config: { command: string; args: string[] }) => void;
		window.vetta.abilities.prepareOpenMcpAbility = vi.fn(
			() =>
				new Promise<McpServerConfigData>((resolve) => {
					resolvePrepare = resolve;
				}),
		);
		const item = githubMcpAbility();
		const { result } = renderHook(() => useAbilityActions({ mcp: mcpModel(), refresh: vi.fn() }));

		act(() => result.current.install(item));
		await waitFor(() => expect(progressHandler).toBeDefined());
		act(() =>
			progressHandler?.({
				sourceId: "official",
				slug: "demo-mcp",
				phase: "downloading",
				downloadedBytes: 50,
				totalBytes: 100,
			}),
		);
		expect(result.current.operationProgressById.get(item.id)).toMatchObject({
			phase: "downloading",
			downloadedBytes: 50,
			totalBytes: 100,
		});
		await act(async () => resolvePrepare({ command: "/runtime/demo", args: [] }));
		await waitFor(() => expect(result.current.operationById.has(item.id)).toBe(false));
	});

	it("prepares a GitHub MCP runtime before handing its resolved config to the setup flow", async () => {
		const mcp = mcpModel();
		const refresh = vi.fn();
		const item = githubMcpAbility();
		const { result } = renderHook(() => useAbilityActions({ mcp, refresh }));

		act(() => result.current.install(item));

		await waitFor(() => expect(mcp.onAddBuiltinServer).toHaveBeenCalledOnce());
		expect(window.vetta.abilities.prepareOpenMcpAbility).toHaveBeenCalledWith("demo-mcp", "official");
		expect(mcp.onAddBuiltinServer).toHaveBeenCalledWith(
			expect.objectContaining({
				config: {
					command: "C:/Users/test/.vetta/abilities/mcp/demo/runtime/versions/1.0.0/demo.exe",
					args: ["--stdio"],
				},
			}),
			expect.objectContaining({ abilityVersion: "1.0.0", runtimeName: "demo-mcp" }),
		);
		expect(refresh).toHaveBeenCalled();
	});

	it("removes the server config before cleaning managed runtime files", async () => {
		const onDeleteServer = vi.fn(async () => undefined);
		const mcp = mcpModel({ onDeleteServer });
		const item = githubMcpAbility();
		const { result } = renderHook(() => useAbilityActions({ mcp, refresh: vi.fn() }));

		act(() => result.current.uninstall(item));

		await waitFor(() => expect(window.vetta.abilities.removeOpenMcpRuntime).toHaveBeenCalledOnce());
		expect(onDeleteServer).toHaveBeenCalledWith("demo-mcp");
		expect(onDeleteServer.mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(window.vetta.abilities.removeOpenMcpRuntime).mock.invocationCallOrder[0]!,
		);
		expect(window.vetta.abilities.removeOpenMcpRuntime).toHaveBeenCalledWith("demo-mcp", "official");
	});

	it("updates an installed plugin, exposes both phases, then reloads it automatically", async () => {
		const install = deferred();
		const reload = deferred();
		window.vetta.abilities.installOpenAbility = vi.fn(() => install.promise);
		window.vetta.plugins.reload = vi.fn(() =>
			reload.promise.then(() => ({ id: "demo-plugin" }) as InstalledPlugin),
		);
		const refresh = vi.fn();
		const item = githubPluginAbility(true);
		const { result } = renderHook(() => useAbilityActions({ mcp: mcpModel(), refresh }));

		act(() => result.current.install(item));
		expect(result.current.operationById.get(item.id)).toBe("updating");
		expect(result.current.busyIds.has(item.id)).toBe(true);

		await act(async () => install.resolve());
		await waitFor(() => expect(window.vetta.plugins.reload).toHaveBeenCalledWith("demo-plugin"));
		expect(result.current.operationById.get(item.id)).toBe("applyingUpdate");
		expect(vi.mocked(window.vetta.abilities.installOpenAbility).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(window.vetta.plugins.reload).mock.invocationCallOrder[0]!,
		);

		await act(async () => reload.resolve());
		await waitFor(() => expect(result.current.operationById.has(item.id)).toBe(false));
		expect(refresh).toHaveBeenCalledOnce();
		expect(notifyPluginsChanged).toHaveBeenCalledOnce();
		expect(showToast).toHaveBeenCalledWith({
			variant: "success",
			message: "abilities:message.updatedAndReloaded",
		});
		expect(result.current.permissionPromptSlug).toBeNull();
	});

	it("keeps first-time plugin setup separate and does not reload a fresh install", async () => {
		const item = githubPluginAbility(false);
		window.vetta.plugins.listAll = vi.fn(async () => [{ id: "demo-plugin", enabled: false } as InstalledPlugin]);
		const { result } = renderHook(() => useAbilityActions({ mcp: mcpModel(), refresh: vi.fn() }));

		act(() => result.current.install(item));

		await waitFor(() => expect(result.current.permissionPromptSlug).toBe("demo-plugin"));
		expect(result.current.pendingPluginSetup?.plugin?.id).toBe("demo-plugin");
		expect(window.vetta.plugins.reload).not.toHaveBeenCalled();
		expect(showToast).not.toHaveBeenCalled();
	});

	it("pauses an update when the new manifest changes permissions", async () => {
		const item = {
			...githubPluginAbility(true),
			permissions: ["storage.read"],
			grantedPermissions: ["storage.read"],
			commands: ["old.command"],
			grantedCommands: ["old.command"],
		} as PluginAbility;
		window.vetta.plugins.listAll = vi.fn(async () => [
			{
				id: "demo-plugin",
				permissions: ["storage.read", "network.fetch"],
				grantedPermissions: ["storage.read"],
				declaredCommands: ["old.command", "new.command"],
				grantedCommandNames: ["old.command"],
				pendingVersion: "2.0.0",
				enabled: true,
			} as InstalledPlugin,
		]);
		const { result } = renderHook(() => useAbilityActions({ mcp: mcpModel(), refresh: vi.fn() }));

		act(() => result.current.install(item));

		await waitFor(() => expect(result.current.permissionPromptSlug).toBe("demo-plugin"));
		expect(result.current.pendingPluginSetup?.permissionChanges).toEqual({
			added: ["network.fetch"],
			removed: [],
			retained: ["storage.read"],
		});
		expect(window.vetta.plugins.reload).not.toHaveBeenCalled();
	});

	it("reports an automatic reload failure without claiming the update is active", async () => {
		window.vetta.plugins.reload = vi.fn(async () => {
			throw new Error("reload failed");
		});
		const refresh = vi.fn();
		const item = githubPluginAbility(true);
		const { result } = renderHook(() => useAbilityActions({ mcp: mcpModel(), refresh }));

		act(() => result.current.install(item));

		await waitFor(() => expect(result.current.error).toBe("reload failed"));
		expect(result.current.operationById.has(item.id)).toBe(false);
		expect(refresh).toHaveBeenCalledOnce();
		expect(showToast).not.toHaveBeenCalled();
	});
});
