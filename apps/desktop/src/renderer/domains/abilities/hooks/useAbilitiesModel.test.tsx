// @vitest-environment jsdom
import type {
	LanguageState,
	InstalledSkill,
	MarketplaceSource,
	OpenMarketplaceCatalog,
	OpenMarketplaceSourceSnapshot,
} from "@preload/api";
import { i18n, initI18n } from "@shared/i18n";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { resolveAbilityDetailContent } from "../lib/ability-presentation";
import { AbilitiesPageView } from "../components/AbilitiesPageView";
import { BundleMembersSection } from "../components/detail/BundleMembersSection";
import { BundleInstallDialog } from "../components/detail/BundleInstallDialog";
import { useAbilitiesModel } from "./useAbilitiesModel";

vi.mock("@shared/components/cloud-slots", () => ({ cloudEnabled: false }));
vi.mock("@shared/tour", () => ({ CapabilitiesTour: () => null }));
vi.mock("../../settings/ai-assist", () => ({ SettingsAiAssist: () => null }));
vi.mock("../components/AbilityMcpDialogs", () => ({ AbilityMcpDialogs: () => null }));
const navigation = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigation }));
// Isolate unrelated application stores, keeping real React/Jotai/i18next and ability hooks.
vi.mock("@shared/store/atoms", async () => {
	const { atom } = await import("jotai");
	return { authTokenAtom: atom(null), languageAtom: atom("en"), pluginI18nByIdAtom: atom({}) };
});

it("keeps bundle-only members out of discovery and its banner while preserving details, selection, localization and installed management", async () => {
	const repository = "https://github.com/example/market";
	const source: MarketplaceSource = {
		id: "bundle-source", name: "Bundles", type: "github", repository, archiveUrl: `${repository}/archive/main.zip`, ref: "main",
		enabled: true, builtin: false, autoUpdate: false, priority: 100, createdAt: "2026-08-30", updatedAt: "2026-08-30",
	};
	const base = {
		description: "", version: "2.0.0", configVersion: 1, author: "", license: "", category: "Social", icon: "", tags: [],
		origin: { kind: "github-marketplace" as const, sourceId: source.id, marketplace: "test", marketplaceVersion: "2", repository },
	};
	const snapshot: OpenMarketplaceSourceSnapshot = {
		source, sourceId: source.id, marketplaceVersion: "2", repository, syncedAt: "2026-08-30", stale: false,
		abilities: [
			{ ...base, type: "bundle", slug: "research", name: "Research", listed: true, config: { members: [
				{ type: "skill", slug: "guide", name: "Guide", icon: "", version: "2.0.0", exists: true },
				{ type: "mcp", slug: "search", name: "Search", icon: "", version: "2.0.0", exists: true },
			] }, detail: { i18n: { zh: { name: "调研" } } } },
			{ ...base, type: "skill", slug: "guide", name: "Guide", listed: false, config: {}, detail: { content: "English guide", i18n: { zh: { name: "检索指南", content: "中文指南" } } } },
			{ ...base, type: "mcp", slug: "search", name: "Search", listed: false, config: { mcp: { command: "uvx" }, mcp_parameters: [{ key: "TOKEN", label: "Token", secret: true, required: true }] }, detail: {} },
		],
	};
	const catalog: OpenMarketplaceCatalog = { sources: [source], snapshots: [snapshot], abilities: snapshot.abilities, failedSourceIds: [] };
	let installed: Record<string, InstalledSkill> = {};
	Object.defineProperty(window, "vetta", { configurable: true, value: {
		abilities: {
			getLedger: async () => ({}), listBuiltinPresentations: async () => ({}),
			listOpenMarketplaces: async () => structuredClone(catalog), refreshOpenMarketplaces: async () => structuredClone(catalog),
			onOpenMarketplacesUpdated: () => () => undefined,
		},
		skills: { getMarketManifest: async () => installed, list: async () => [] }, plugins: { listAll: async () => [] },
		mcp: { get: async () => ({ mcpServers: {} }) },
	} });
	initI18n();
	await i18n.changeLanguage("en");
	const { result } = renderHook(() => useAbilitiesModel());
	await waitFor(() => expect(result.current.refreshing).toBe(false));
	const guideId = "github:bundle-source:skill:guide";
	const bundleId = "github:bundle-source:bundle:research";
	expect(result.current.items.filter((item) => item.fromMarket).map((item) => item.id)).toEqual([bundleId]);
	expect(result.current.bannerIcons.map((item) => item.id)).toEqual([bundleId]);
	const bundle = result.current.findById(bundleId);
	if (!bundle || bundle.type !== "bundle") throw new Error("Bundle missing");
	expect(bundle.memberItems.map((item) => item.slug)).toEqual(["guide", "search"]);
	expect(bundle.memberItems[1].market?.config).toMatchObject({ mcp_parameters: [{ key: "TOKEN", secret: true, required: true }] });
	const members = render(<BundleMembersSection item={bundle} />);
	await userEvent.click(screen.getByRole("button", { name: /Guide/ }));
	expect(navigation).toHaveBeenLastCalledWith({ to: "/abilities", search: { detail: guideId } });
	members.unmount();
	const confirm = vi.fn();
	const dialog = render(<BundleInstallDialog bundle={bundle} open onOpenChange={() => undefined} onConfirm={confirm} />);
	await userEvent.click(screen.getByRole("checkbox", { name: /Search/ }));
	await userEvent.click(screen.getByRole("button", { name: /Install 1/ }));
	expect(confirm.mock.calls[0][0].map((item: { id: string }) => item.id)).toEqual([guideId]);
	dialog.unmount();
	act(() => result.current.setSearchQuery("Guide"));
	expect(result.current.items).toHaveLength(0);
	await act(async () => { await i18n.changeLanguage("zh"); });
	await waitFor(() => expect(result.current.findById(guideId)?.title).toBe("检索指南"));
	expect(resolveAbilityDetailContent(result.current.findById(guideId)?.market?.detail, "zh").content).toBe("中文指南");
	await waitFor(() => expect(result.current.refreshing).toBe(false));
	installed = { guide: { name: "guide", version: "1.0.0", installedAt: "2026-08-30", enabled: false, source: "market", type: "skill" } };
	// Supply the stable source identity of an already installed member, as recorded before unlisting.
	window.vetta.abilities.getLedger = async () => ({ "skill:guide": { type: "skill", version: "1.0.0", configVersion: 1, installedAt: "2026-08-30", origin: base.origin, catalogId: guideId, slug: "guide" } });
	act(() => { result.current.setSearchQuery(""); result.current.setScope("mine"); result.current.refresh(); });
	await waitFor(() => expect(result.current.items).toMatchObject([{ id: guideId, installed: true, enabled: false, needsUpdate: true }]));
	act(() => result.current.setScope("discover"));
	expect(result.current.items.filter((item) => item.fromMarket).map((item) => item.id)).toEqual([bundleId]);
	// Independently listing the same package changes visibility, not its catalog identity.
	snapshot.abilities = snapshot.abilities.map((item) => item.slug === "guide" ? { ...item, listed: true } : item);
	act(() => result.current.refresh());
	await waitFor(() => expect(result.current.items.some((item) => item.id === guideId)).toBe(true));
	expect(result.current.findById(guideId)).toMatchObject({ installed: true, enabled: false, needsUpdate: true });
	await act(async () => { await i18n.changeLanguage("en"); });
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
