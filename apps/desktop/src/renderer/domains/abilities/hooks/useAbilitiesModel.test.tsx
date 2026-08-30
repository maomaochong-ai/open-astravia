// @vitest-environment jsdom
import type {
	LanguageState,
	MarketplaceSource,
	OpenMarketplaceCatalog,
	OpenMarketplaceSourceSnapshot,
} from "@preload/api";
import { i18n, initI18n } from "@shared/i18n";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { resolveAbilityDetailContent } from "../lib/ability-presentation";
import { AbilitiesPageView } from "../components/AbilitiesPageView";
import { useAbilitiesModel } from "./useAbilitiesModel";

vi.mock("@shared/components/cloud-slots", () => ({ cloudEnabled: false }));
vi.mock("@shared/tour", () => ({ CapabilitiesTour: () => null }));
vi.mock("../../settings/ai-assist", () => ({ SettingsAiAssist: () => null }));
vi.mock("../components/AbilityMcpDialogs", () => ({ AbilityMcpDialogs: () => null }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
// Isolate unrelated application stores, keeping real React/Jotai/i18next and ability hooks.
vi.mock("@shared/store/atoms", async () => {
	const { atom } = await import("jotai");
	return { authTokenAtom: atom(null), languageAtom: atom("en"), pluginI18nByIdAtom: atom({}) };
});

it("follows the application language broadcast for cached GitHub names, descriptions, groups, search and details", async () => {
	const repository = "https://github.com/example/abilities";
	const source: MarketplaceSource = {
		id: "official", name: "Official", type: "github", repository,
		archiveUrl: `${repository}/archive/refs/heads/main.zip`, ref: "main",
		enabled: true, builtin: true, autoUpdate: false, priority: 100,
		createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:00:00.000Z",
	};
	const snapshot: OpenMarketplaceSourceSnapshot = {
		source, sourceId: source.id, marketplaceVersion: "2026.08.30", repository, stale: false,
		syncedAt: source.updatedAt,
		abilities: [{
			type: "mcp", slug: "xiaohongshu-mcp", name: "Xiaohongshu MCP", description: "Search social content",
			version: "1.0.0", configVersion: 1, license: "", author: "", icon: "", category: "Social", tags: [],
			categoryI18n: { "zh-CN": "社交", en: "Social" },
			config: { mcp: { type: "http", url: "https://example.com/mcp" } },
			origin: { kind: "github-marketplace", sourceId: source.id, marketplace: "example-marketplace", marketplaceVersion: "2026.08.30", repository },
			detail: {
				blocks: [{ type: "hero", title: "English detail" }],
				i18n: { zh: { name: "小红书 MCP", description: "搜索小红书内容", blocks: [{ type: "hero", title: "中文详情" }] } },
			},
		}],
	};
	const listOpenMarketplaces = async (): Promise<OpenMarketplaceCatalog> => {
		return { sources: [source], snapshots: [snapshot], abilities: snapshot.abilities, failedSourceIds: [] };
	};
	const refreshOpenMarketplaces = vi.fn(async () => { throw new Error("offline"); });
	let languageChanged!: (state: LanguageState) => void;
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: {
			i18n: {
				initialState: { preference: "en", language: "en" },
				onLanguageChanged: (listener: typeof languageChanged) => { languageChanged = listener; return () => undefined; },
			},
			abilities: {
				getLedger: async () => ({}), listBuiltinPresentations: async () => ({}), listOpenMarketplaces,
				refreshOpenMarketplaces,
				onOpenMarketplacesUpdated: () => () => undefined,
			},
			skills: { getMarketManifest: async () => ({}), list: async () => [] },
			plugins: { listAll: async () => [] },
			mcp: { get: async () => ({ mcpServers: {} }) },
		},
	});
	initI18n();
	const { result } = renderHook(() => useAbilitiesModel());
	await waitFor(() => expect(result.current.refreshing).toBe(false));
	const itemId = "github:official:mcp:xiaohongshu-mcp";
	expect(result.current.findById(itemId)).toMatchObject({ title: "Xiaohongshu MCP", description: "Search social content" });
	const categoryIds = result.current.groups.map((group) => group.category);
	render(<AbilitiesPageView model={result.current} />);
	expect(screen.getByRole("heading", { name: "Social" })).toBeTruthy();
	act(() => result.current.setSearchQuery("小红书"));
	expect(result.current.items).toHaveLength(0);

	act(() => languageChanged({ preference: "zh", language: "zh" }));
	await waitFor(() => expect(result.current.items).toMatchObject([{ id: itemId, title: "小红书 MCP", description: "搜索小红书内容" }]));
	expect(screen.getByRole("heading", { name: "社交" })).toBeTruthy();
	expect(result.current.findById(itemId)?.category).toBe("Social");
	let item = result.current.findById(itemId);
	expect(resolveAbilityDetailContent(item?.detail ?? item?.market?.detail, i18n.language)).toMatchObject({
		name: "小红书 MCP", description: "搜索小红书内容", blocks: [{ type: "hero", title: "中文详情" }],
	});
	await waitFor(() => expect(result.current.refreshing).toBe(false));

	act(() => languageChanged({ preference: "en", language: "en" }));
	await waitFor(() => expect(result.current.items).toHaveLength(0));
	expect(screen.getByRole("heading", { name: "Social" })).toBeTruthy();
	act(() => result.current.setSearchQuery("social content"));
	expect(result.current.items).toMatchObject([{ id: itemId, title: "Xiaohongshu MCP", description: "Search social content" }]);
	item = result.current.findById(itemId);
	expect(resolveAbilityDetailContent(item?.detail ?? item?.market?.detail, i18n.language).blocks).toEqual([{ type: "hero", title: "English detail" }]);
	await waitFor(() => expect(result.current.refreshing).toBe(false));
	act(() => languageChanged({ preference: "system", language: "zh" }));
	await waitFor(() => expect(result.current.findById(itemId)?.title).toBe("小红书 MCP"));
	await waitFor(() => expect(result.current.refreshing).toBe(false));
	expect(refreshOpenMarketplaces).not.toHaveBeenCalled();
	act(() => result.current.setSearchQuery(""));
	expect(result.current.groups.map((group) => group.category)).toEqual(categoryIds);
});
