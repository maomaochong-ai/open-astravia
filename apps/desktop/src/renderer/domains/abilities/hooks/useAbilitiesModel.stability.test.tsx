// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) }));
vi.mock("../../plugins/runtime/plugin-i18n", () => ({ usePluginTextResolver: () => (text: string) => text }));

const progress = vi.hoisted(() => ({
	probed: { operationProgressById: new Map<string, number>() as Map<string, number> },
}));

const MARKET = vi.hoisted(() => [
	{
		slug: "demo-skill",
		type: "skill" as const,
		name: "Demo Skill",
		description: "演示条目",
		license: "MIT",
		version: "1.0.0",
		author: "test",
		icon: "",
		category: "",
		tags: [],
		sha256: "",
		download_count: 0,
		config: {},
		detail: {},
		updated_at: "2026-01-01T00:00:00.000Z",
	},
]);

const stable = vi.hoisted(() => {
	const noop = () => undefined;
	const asyncNoop = async () => undefined;
	return {
		promptMcpSetup: vi.fn(noop),
		onAuthorizeOAuth: vi.fn(asyncNoop),
		onConfigureBuiltinSecrets: vi.fn(noop),
		onRevokeOAuth: vi.fn(asyncNoop),
		onToggleEditServer: vi.fn(noop),
		refresh: vi.fn(noop),
		refreshLocalInstallState: vi.fn(asyncNoop),
	};
});

// `actions` / `mcp` 在真实代码里是每次渲染新建的对象字面量；桩必须保持这个形状，
// 否则测试无法暴露「依赖整个对象导致回调失效」。
vi.mock("./useAbilityActions", () => ({
	useAbilityActions: () => ({
		applyPluginSetup: vi.fn(),
		busyIds: new Set<string>(),
		dismissPermissionPrompt: vi.fn(),
		dismissSetupPrompt: vi.fn(),
		error: null,
		importPluginArchive: vi.fn(),
		importSkillArchive: vi.fn(),
		importing: false,
		install: vi.fn(),
		installBundleMembers: vi.fn(),
		operationById: new Map(),
		operationProgressById: progress.probed.operationProgressById,
		pendingPluginSetup: null,
		permissionPromptSlug: null,
		promptMcpSetup: stable.promptMcpSetup,
		reloadPlugin: vi.fn(),
		setPluginCommand: vi.fn(),
		setPluginPermission: vi.fn(),
		setupPromptId: null,
		toggle: vi.fn(),
		uninstall: vi.fn(),
		uninstallMembers: vi.fn(),
	}),
}));

vi.mock("../../settings/components/useMcpSettingsModel", () => ({
	useMcpSettingsModel: () => ({
		onAuthorizeOAuth: stable.onAuthorizeOAuth,
		onConfigureBuiltinSecrets: stable.onConfigureBuiltinSecrets,
		onRevokeOAuth: stable.onRevokeOAuth,
		onToggleEditServer: stable.onToggleEditServer,
	}),
}));

vi.mock("./useAbilityData", () => ({
	useAbilityData: () => ({
		addMarketplaceSource: vi.fn(),
		clearMarketplaceSourceCredential: vi.fn(),
		error: null,
		ledger: {},
		loading: false,
		localPresentations: {},
		localSkills: [],
		market: MARKET,
		marketplaceCatalog: { abilities: [], failedSourceIds: [], snapshots: [], sources: [] },
		marketplaceSources: [],
		mcpSetupStatus: {},
		plugins: [],
		refresh: stable.refresh,
		refreshLocalInstallState: stable.refreshLocalInstallState,
		refreshMarketplaceSource: vi.fn(),
		refreshing: false,
		removeMarketplaceSource: vi.fn(),
		skillManifest: {},
		updateMarketplaceSource: vi.fn(),
	}),
}));

const { useAbilitiesModel } = await import("./useAbilitiesModel");

describe("useAbilitiesModel row action stability", () => {
	it("keeps every card callback identical across renders so memoised rows are skipped", () => {
		const { result, rerender } = renderHook(() => useAbilitiesModel());
		const first = result.current;

		rerender();

		// 一次无关的重渲（搜索框输入、操作进度）不该让整页卡片失效。
		expect(result.current.setup).toBe(first.setup);
		expect(result.current.configure).toBe(first.configure);
		expect(result.current.edit).toBe(first.edit);
		expect(result.current.revokeAuthorization).toBe(first.revokeAuthorization);
	});
});

/**
 * 横幅（能力页顶部的引导卡片）按自己的图标池随机洗牌，池子换引用就会重新洗牌并跳回第一张。
 * 安装进度每秒几次 tick，`allItems` 因此不断换引用，但横幅的内容其实没变。
 */
describe("useAbilitiesModel banner stability", () => {
	it("keeps the same banner icons while install progress ticks", () => {
		progress.probed.operationProgressById = new Map();
		const { result, rerender } = renderHook(() => useAbilitiesModel());
		const firstBanners = result.current.bannerIcons;
		const firstItems = result.current.allItems;
		expect(firstBanners.length).toBeGreaterThan(0);

		// 一次安装进度 tick：条目集合没变，只多了操作进度。
		progress.probed.operationProgressById = new Map([["skill:demo-skill", 0.4]]);
		rerender();

		// 进度确实进来了（说明这次是真的重算过），但横幅池子的身份必须保持。
		expect(result.current.allItems).not.toBe(firstItems);
		expect(result.current.bannerIcons).toBe(firstBanners);
		expect(result.current.bannerIcons.map((icon) => icon.title)).toEqual(firstBanners.map((icon) => icon.title));
	});
});
