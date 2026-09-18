// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { startTransition } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./persistent-page-loaders", () => ({
	loadSettingsPage: () => Promise.resolve({ default: () => <p>settings-body</p> }),
	loadAbilitiesPage: () => new Promise(() => {}),
	loadAgentsPage: () => Promise.resolve({ default: () => <p>agents-body</p> }),
	loadAutomationPage: () => Promise.resolve({ default: () => <p>automation-body</p> }),
	loadBatchTasksPage: () => Promise.resolve({ default: () => <p>batch-body</p> }),
	loadKnowledgePage: () => Promise.resolve({ default: () => <p>knowledge-body</p> }),
	loadKnowledgeListPage: () => Promise.resolve({ default: () => <p>knowledge-all-body</p> }),
	loadScenesPage: () => Promise.resolve({ default: () => <p>scenes-body</p> }),
	loadNewSessionPage: () => Promise.resolve({ default: () => <p>new-session-body</p> }),
	loadChatPage: () => Promise.resolve({ default: () => <p>chat-body</p> }),
	loadTeamChatPage: () =>
		Promise.resolve({
			default: () => <p>team-body</p>,
		}),
	loadWorkspacePage: () => Promise.resolve({ default: () => <p>workspace-unused</p> }),
}));

vi.mock("../domains/plugins/components/PluginWorkspaceViewRoute", () => ({
	PluginWorkspaceViewSurface: () => <p>workspace-body</p>,
}));

vi.mock("@tanstack/react-router", () => ({
	Outlet: () => <p>outlet-body</p>,
	useNavigate: () => () => undefined,
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}));

vi.mock("./ChatSurface", () => ({
	ChatSurface: () => <p>chat-body</p>,
}));

vi.mock("./ChatSurfaceShell", () => ({
	ChatSurfaceShell: () => <h1>chatView.defaultSessionTitle</h1>,
}));

vi.mock("./outlet-page-loaders", () => ({
	loadProjectDetailPage: () => Promise.resolve({ default: () => <p>project-body</p> }),
	loadSessionViewerPage: () => Promise.resolve({ default: () => <p>viewer-body</p> }),
	loadThemePageRoute: () => Promise.resolve({ default: () => <p>theme-body</p> }),
}));

const { PersistentRouteStage } = await import("./PersistentRouteStage.js");

describe("PersistentRouteStage pending chunk", () => {
	it("第一次点进 chunk 未完成的页面先露出标题壳，之前不会挂进隐藏树", async () => {
		const { container, rerender } = render(<PersistentRouteStage currentPath="/" />);
		await waitFor(() => {
			expect(container.textContent).toContain("chat-body");
		});
		expect(container.textContent).not.toContain("page.title");
		expect(container.querySelector("[hidden]")).toBeNull();

		act(() => {
			startTransition(() => {
				rerender(<PersistentRouteStage currentPath="/abilities" />);
			});
		});

		const visibleTitle = [...container.querySelectorAll("h1")].find((node) => node.textContent === "page.title");
		expect(visibleTitle).toBeTruthy();
		expect(visibleTitle?.closest("[hidden]")).toBeNull();
		expect(container.textContent).not.toContain("abilities-body");
	});
});
