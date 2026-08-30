// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpSettingsModel } from "../../settings/components/useMcpSettingsModel";
import type { McpAbility } from "../types";

vi.mock("@shared/i18n", () => ({ i18n: { t: (key: string) => key } }));

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

describe("useAbilityActions managed MCP wiring", () => {
	beforeEach(() => {
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: {
				abilities: {
					prepareOpenMcpAbility: vi.fn(async () => ({
						command: "C:/Users/test/.vetta/abilities/mcp/demo/runtime/versions/1.0.0/demo.exe",
						args: ["--stdio"],
					})),
					removeOpenMcpRuntime: vi.fn(async () => undefined),
				},
			},
		});
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
});
