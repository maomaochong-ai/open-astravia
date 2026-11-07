// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) }));
vi.mock("../../plugins/runtime/plugin-i18n", () => ({ usePluginTextResolver: () => (text: string) => text }));

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
		operationProgressById: new Map(),
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
		market: [],
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
