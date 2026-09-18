import { describe, expect, it, vi } from "vitest";

const loaders = vi.hoisted(() => ({
	loadAbilitiesPage: vi.fn(() => Promise.resolve()),
	loadAgentsPage: vi.fn(() => Promise.resolve()),
	loadAutomationPage: vi.fn(() => Promise.resolve()),
	loadBatchTasksPage: vi.fn(() => Promise.resolve()),
	loadChatPage: vi.fn(() => Promise.resolve()),
	loadKnowledgeListPage: vi.fn(() => Promise.resolve()),
	loadKnowledgePage: vi.fn(() => Promise.resolve()),
	loadNewSessionPage: vi.fn(() => Promise.resolve()),
	loadScenesPage: vi.fn(() => Promise.resolve()),
	loadSettingsPage: vi.fn(() => Promise.resolve()),
	loadTeamChatPage: vi.fn(() => Promise.resolve()),
	loadWorkspacePage: vi.fn(() => Promise.resolve()),
}));

vi.mock("./persistent-page-loaders", () => loaders);
vi.mock("../domains/settings/components/settings-tab-loaders", () => ({
	prefetchSettingsTab: vi.fn(),
}));

const { prefetchIdleRoutes } = await import("./route-prefetch.js");

describe("prefetchIdleRoutes", () => {
	it("立刻预取设计、能力、智能体、新会话、设置 chunk，不等 4 秒空闲", () => {
		const cancel = prefetchIdleRoutes();
		expect(loaders.loadWorkspacePage).toHaveBeenCalledTimes(1);
		expect(loaders.loadAbilitiesPage).toHaveBeenCalledTimes(1);
		expect(loaders.loadAgentsPage).toHaveBeenCalledTimes(1);
		expect(loaders.loadNewSessionPage).toHaveBeenCalledTimes(1);
		expect(loaders.loadSettingsPage).toHaveBeenCalledTimes(1);
		expect(loaders.loadTeamChatPage).not.toHaveBeenCalled();
		cancel();
	});
});
