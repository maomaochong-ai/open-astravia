// @vitest-environment jsdom
/**
 * 市场 MCP 的添加闭环：mcp.json 落盘 → 台账补记 → 卡片状态，
 * 按真实接线（useMcpSettingsModel + useAbilityActions + buildMcpAbilities）验证。
 */
import type { AbilityLedger, McpConfigData } from "@preload/api";
import type { MarketAbility } from "@shared/lib/api";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpAbility } from "../types";
import { buildMcpAbilities } from "../lib/build-ability-items";
import { useMcpSettingsModel } from "../../settings/components/useMcpSettingsModel";
import { useAbilityActions } from "./useAbilityActions";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@shared/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@shared/store/toast-atoms", () => ({ showToast: () => {} }));
vi.mock("../../plugins/runtime/plugin-events", () => ({ notifyPluginsChanged: () => {} }));
vi.mock("@shared/store/atoms", () => ({ authTokenAtom: { toString: () => "authToken" } }));
vi.mock("jotai", async (importOriginal) => ({
	...(await importOriginal<typeof import("jotai")>()),
	useAtomValue: () => "token",
}));
vi.mock("../../settings/components/recordSettingsUsage", () => ({ recordSettingsUsage: () => {} }));

const t = ((key: string) => key) as never;

interface Parameter {
	key: string;
	label: string;
	required: boolean;
	secret: boolean;
}

/** 受管二进制 MCP 的市场行（小红书即此形态：参数全可选，登录靠运行期工具）。 */
function marketEntry(parameters: Parameter[]): MarketAbility {
	return {
		slug: "demo-mcp",
		type: "mcp",
		name: "Demo MCP",
		description: "demo",
		version: "2.5.0",
		icon: "",
		category: "",
		tags: [],
		author: "",
		license: "",
		sha256: "",
		download_count: 0,
		updated_at: "",
		configVersion: 2,
		config: {
			mcp: { command: "${VETTA_MCP_EXECUTABLE}", args: ["-transport=stdio"] },
			mcp_browser_auth: false,
			mcp_parameters: parameters,
		},
		origin: {
			kind: "github-marketplace",
			sourceId: "official",
			marketplace: "official",
			marketplaceVersion: "1",
			repository: "https://github.com/example/abilities",
		},
		catalogSource: {
			kind: "github",
			id: "official",
			name: "official",
			repository: "https://github.com/example/abilities",
		},
	} as unknown as MarketAbility;
}

function setupHarness(entry: MarketAbility) {
	const disk = { mcp: { mcpServers: {} } as McpConfigData, ledger: {} as AbilityLedger };
	// 渲染层持有的台账快照：只有 refresh() 才与磁盘同步，与 useAbilityData 一致。
	let ledgerSnapshot: AbilityLedger = {};
	(window as unknown as { vetta: unknown }).vetta = {
		mcp: {
			get: async () => structuredClone(disk.mcp),
			set: async (next: McpConfigData) => {
				disk.mcp = structuredClone(next);
			},
			authStatus: async () => ({}),
		},
		abilities: {
			// 主进程只认已经写进 mcp.json 的 server（见 ipc/abilities.ts）
			recordMcpInstall: async (name: string, version: string, metadata: Record<string, unknown>) => {
				if (!disk.mcp.mcpServers[name]) return;
				disk.ledger[`mcp:${name}`] = {
					version,
					installedAt: "2026-01-01T00:00:00.000Z",
					...metadata,
					runtimeName: name,
				} as never;
			},
			prepareOpenMcpAbility: async () => ({ command: "/runtime/demo", args: ["-transport=stdio"] }),
		},
	};

	const rendered = renderHook(() => {
		const refresh = (): void => {
			ledgerSnapshot = structuredClone(disk.ledger);
		};
		const mcp = useMcpSettingsModel();
		return { mcp, actions: useAbilityActions({ mcp, refresh }) };
	});

	const card = (): McpAbility =>
		buildMcpAbilities(
			[entry],
			{
				ledger: ledgerSnapshot,
				skillManifest: {},
				localSkills: [],
				plugins: [],
				mcpConfig: rendered.result.current.mcp.config,
				oauthAuthByName: {},
				mcpSetupStatus: {},
				busyIds: new Set(),
			},
			t,
		)[0] as McpAbility;

	return { disk, rendered, card };
}

describe("市场 MCP 添加闭环", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("参数全可选时直接安装，不弹配置引导", async () => {
		const entry = marketEntry([{ key: "XHS_PROXY", label: "Proxy URL", required: false, secret: false }]);
		const { disk, rendered, card } = setupHarness(entry);
		await waitFor(() => expect(rendered.result.current.mcp.config).not.toBeNull());

		await act(async () => {
			rendered.result.current.actions.install(card());
		});

		await waitFor(() => expect(Object.keys(disk.mcp.mcpServers)).toEqual(["demo-mcp"]));
		expect(rendered.result.current.mcp.secretsDialogPreset).toBeNull();
		expect(card().installed).toBe(true);
	});

});
