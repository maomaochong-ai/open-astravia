// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./persistent-page-loaders", () => ({
	loadSettingsPage: () => Promise.resolve({ default: () => <p>settings-body</p> }),
	loadAbilitiesPage: () => Promise.resolve({ default: () => <p>abilities-body</p> }),
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
			default: ({ teamId, sessionId }: { teamId?: string; sessionId?: string }) => (
				<p>{`team-${teamId}-${sessionId ?? "none"}`}</p>
			),
		}),
	loadWorkspacePage: () => Promise.resolve({ default: () => <p>workspace-unused</p> }),
}));

vi.mock("../domains/plugins/components/PluginWorkspaceViewRoute", () => ({
	PluginWorkspaceViewSurface: ({ pluginId, viewId }: { pluginId?: string; viewId?: string }) => (
		<p>{`workspace-${pluginId}-${viewId}`}</p>
	),
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

vi.mock("../shared/theme/pages/ThemePageRouteShell", () => ({
	ThemePageRouteShell: ({ themeId, pageId }: { themeId?: string; pageId?: string }) => (
		<h1>{`theme-shell-${themeId}-${pageId}`}</h1>
	),
}));

vi.mock("./outlet-page-loaders", () => ({
	loadProjectDetailPage: () =>
		Promise.resolve({
			default: ({ cwd }: { cwd?: string }) => <p>{`project-${cwd}`}</p>,
		}),
	loadSessionViewerPage: () =>
		Promise.resolve({
			default: ({ path }: { path?: string }) => <p>{`viewer-${path}`}</p>,
		}),
	loadThemePageRoute: () =>
		Promise.resolve({
			default: ({ themeId, pageId }: { themeId?: string; pageId?: string }) => (
				<p>{`theme-${themeId}-${pageId}`}</p>
			),
		}),
}));

const { PersistentRouteStage } = await import("./PersistentRouteStage.js");

describe("PersistentRouteStage", () => {
	it("侧栏切到设置再切回聊天时两棵树都还在，聊天节点不重建", async () => {
		const { container, rerender } = render(<PersistentRouteStage currentPath="/" />);
		await waitFor(() => {
			expect(container.textContent).toContain("chat-body");
		});
		const chat = container.querySelector("p");
		expect(chat?.textContent).toBe("chat-body");

		rerender(<PersistentRouteStage currentPath="/settings/models" />);
		await waitFor(() => {
			expect(container.textContent).toContain("settings-body");
		});
		expect(container.textContent).toContain("chat-body");
		const settings = [...container.querySelectorAll("p")].find((node) => node.textContent === "settings-body");
		expect(settings).toBeTruthy();
		expect(settings?.closest("[hidden]")).toBeNull();
		expect(
			[...container.querySelectorAll("div")].filter((node) => node.className.includes("flex-1") && node.querySelector("p")),
		).toHaveLength(1);

		rerender(<PersistentRouteStage currentPath="/" />);
		await waitFor(() => {
			const settingsAgain = [...container.querySelectorAll("p")].find((node) => node.textContent === "settings-body");
			expect(settingsAgain?.closest("[hidden]")).not.toBeNull();
		});
		const chatAgain = [...container.querySelectorAll("p")].find((node) => node.textContent === "chat-body");
		expect(chatAgain).toBe(chat);
		expect(chatAgain?.closest("[hidden]")).toBeNull();
	});

	it("走进设计画廊再切回聊天时两棵树都还在，聊天节点不重建", async () => {
		const { container, rerender } = render(<PersistentRouteStage currentPath="/" />);
		await waitFor(() => {
			expect(container.textContent).toContain("chat-body");
		});
		const chat = [...container.querySelectorAll("p")].find((node) => node.textContent === "chat-body");
		expect(chat).toBeTruthy();

		rerender(<PersistentRouteStage currentPath="/workspace/vetta-ui-design/gallery" />);
		await waitFor(() => {
			expect(container.textContent).toContain("workspace-vetta-ui-design-gallery");
		});
		expect(container.textContent).not.toContain("outlet-body");
		const gallery = [...container.querySelectorAll("p")].find(
			(node) => node.textContent === "workspace-vetta-ui-design-gallery",
		);
		expect(gallery?.closest("[hidden]")).toBeNull();
		expect(container.textContent).toContain("chat-body");
		await waitFor(() => {
			expect(chat?.closest("[hidden]")).not.toBeNull();
		});

		rerender(<PersistentRouteStage currentPath="/" />);
		await waitFor(() => {
			const galleryHidden = [...container.querySelectorAll("p")].find(
				(node) => node.textContent === "workspace-vetta-ui-design-gallery",
			);
			expect(galleryHidden?.closest("[hidden]")).not.toBeNull();
		});
		const chatAgain = [...container.querySelectorAll("p")].find((node) => node.textContent === "chat-body");
		const galleryAgain = [...container.querySelectorAll("p")].find(
			(node) => node.textContent === "workspace-vetta-ui-design-gallery",
		);
		expect(chatAgain).toBe(chat);
		expect(galleryAgain).toBe(gallery);
		expect(chatAgain?.closest("[hidden]")).toBeNull();
	});

	it("第一次走进能力页先画出标题壳，不等页面 chunk", async () => {
		const { container } = render(<PersistentRouteStage currentPath="/abilities" />);
		expect(container.textContent).toContain("page.title");
		expect(container.textContent).not.toContain("abilities-body");
		await waitFor(() => {
			expect(container.textContent).toContain("abilities-body");
		});
	});

	it("第一次走进团队会话先画出标题壳，不等会话 chunk", async () => {
		const { container } = render(<PersistentRouteStage currentPath="/agent-teams/t1/sessions/s1" />);
		expect(container.textContent).toContain("teams.title");
		expect(container.textContent).not.toContain("team-t1-s1");
		await waitFor(() => {
			expect(container.textContent).toContain("team-t1-s1");
		});
	});

	it("第一次走进新会话先画出问候语，不等页面 chunk", async () => {
		const { container } = render(<PersistentRouteStage currentPath="/new-session" />);
		expect(container.textContent).toContain("newSession.greetingDefault");
		expect(container.textContent).not.toContain("new-session-body");
		await waitFor(() => {
			expect(container.textContent).toContain("new-session-body");
		});
	});

	it("第一次走进聊天先画出会话标题，不等对话 chunk", async () => {
		const { container } = render(<PersistentRouteStage currentPath="/" />);
		expect(container.textContent).toContain("chatView.defaultSessionTitle");
		expect(container.textContent).not.toContain("chat-body");
		expect(container.querySelector("[aria-busy='true']")).toBeNull();
		await waitFor(() => {
			expect(container.textContent).toContain("chat-body");
		});
	});

	it("启动后未访问过的页面不会被挂进隐藏树", async () => {
		const { container } = render(<PersistentRouteStage currentPath="/" />);
		await waitFor(() => {
			expect(container.textContent).toContain("chat-body");
		});
		// 留出比早先启动期预挂更长的窗口，确认没有空闲回调把未访问页挂进来。
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 600));
		});
		expect(container.textContent).not.toContain("abilities-body");
		expect(container.textContent).not.toContain("knowledge-body");
		expect(container.textContent).not.toContain("settings-body");
		expect(container.querySelector("[hidden]")).toBeNull();
		const chat = [...container.querySelectorAll("p")].find((node) => node.textContent === "chat-body");
		expect(chat?.closest("[hidden]")).toBeNull();
	});

	it("走进团队会话再切回聊天时两棵树都还在，聊天节点不重建", async () => {
		const { container, rerender } = render(<PersistentRouteStage currentPath="/" />);
		await waitFor(() => {
			expect(container.textContent).toContain("chat-body");
		});
		const chat = [...container.querySelectorAll("p")].find((node) => node.textContent === "chat-body");
		expect(chat).toBeTruthy();

		rerender(<PersistentRouteStage currentPath="/agent-teams/t1/sessions/s1" />);
		await waitFor(() => {
			expect(container.textContent).toContain("team-t1-s1");
		});
		expect(container.textContent).not.toContain("outlet-body");
		expect(container.textContent).toContain("chat-body");

		rerender(<PersistentRouteStage currentPath="/" />);
		await waitFor(() => {
			const teamHidden = [...container.querySelectorAll("p")].find((node) => node.textContent === "team-t1-s1");
			expect(teamHidden?.closest("[hidden]")).not.toBeNull();
		});
		expect([...container.querySelectorAll("p")].find((node) => node.textContent === "chat-body")).toBe(chat);
	});

	it("切回已保活的能力页时离场页立刻 hidden，不叠在能力标题上面", async () => {
		const { container, rerender } = render(<PersistentRouteStage currentPath="/abilities" />);
		await waitFor(() => {
			expect(container.textContent).toContain("abilities-body");
		});

		rerender(<PersistentRouteStage currentPath="/new-session" />);
		await waitFor(() => {
			expect(container.textContent).toContain("new-session-body");
		});

		rerender(<PersistentRouteStage currentPath="/abilities" />);
		const abilities = [...container.querySelectorAll("p")].find((node) => node.textContent === "abilities-body");
		expect(abilities?.closest("[hidden]")).toBeNull();
		expect(
			[...container.querySelectorAll("div")].some(
				(node) => node.className.includes("absolute") && node.className.includes("inset-0"),
			),
		).toBe(false);
	});

	it("走进项目详情再切回聊天时两棵树都还在，不走 Outlet", async () => {
		const { container, rerender } = render(<PersistentRouteStage currentPath="/" />);
		await waitFor(() => {
			expect(container.textContent).toContain("chat-body");
		});
		const chat = [...container.querySelectorAll("p")].find((node) => node.textContent === "chat-body");

		rerender(<PersistentRouteStage currentPath={`/project/${encodeURIComponent("/tmp/demo")}`} />);
		await waitFor(() => {
			expect(container.textContent).toContain("project-/tmp/demo");
		});
		expect(container.textContent).not.toContain("outlet-body");
		expect(container.textContent).toContain("chat-body");

		rerender(<PersistentRouteStage currentPath="/" />);
		await waitFor(() => {
			const projectHidden = [...container.querySelectorAll("p")].find((node) => node.textContent === "project-/tmp/demo");
			expect(projectHidden?.closest("[hidden]")).not.toBeNull();
		});
		expect([...container.querySelectorAll("p")].find((node) => node.textContent === "chat-body")).toBe(chat);
	});

	it("第一次走进项目详情先画出目录名，不等页面 chunk", () => {
		const { container } = render(
			<PersistentRouteStage currentPath={`/project/${encodeURIComponent("/tmp/demo-app")}`} />,
		);
		expect(container.textContent).toContain("demo-app");
		expect(container.textContent).not.toContain("project-/tmp/demo-app");
	});

	it("走进会话查看器和主题页再切回聊天时两棵树都还在，不走 Outlet", async () => {
		const { container, rerender } = render(<PersistentRouteStage currentPath="/" />);
		await waitFor(() => {
			expect(container.textContent).toContain("chat-body");
		});
		const chat = [...container.querySelectorAll("p")].find((node) => node.textContent === "chat-body");

		rerender(<PersistentRouteStage currentPath={`/viewer/${encodeURIComponent("/tmp/session.jsonl")}`} />);
		await waitFor(() => {
			expect(container.textContent).toContain("viewer-/tmp/session.jsonl");
		});
		expect(container.textContent).not.toContain("outlet-body");

		rerender(<PersistentRouteStage currentPath="/theme/theme.example/gallery" />);
		await waitFor(() => {
			expect(container.textContent).toContain("theme-theme.example-gallery");
		});
		expect(container.textContent).not.toContain("outlet-body");
		expect(container.textContent).toContain("viewer-/tmp/session.jsonl");

		rerender(<PersistentRouteStage currentPath="/" />);
		await waitFor(() => {
			const viewerHidden = [...container.querySelectorAll("p")].find(
				(node) => node.textContent === "viewer-/tmp/session.jsonl",
			);
			expect(viewerHidden?.closest("[hidden]")).not.toBeNull();
		});
		expect([...container.querySelectorAll("p")].find((node) => node.textContent === "chat-body")).toBe(chat);
	});

	it("第一次走进会话查看器先画出标题壳，不等页面 chunk", () => {
		const { container } = render(
			<PersistentRouteStage currentPath={`/viewer/${encodeURIComponent("/tmp/session.jsonl")}`} />,
		);
		expect(container.textContent).toContain("sessionViewer.export.defaultTitle");
		expect(container.textContent).not.toContain("viewer-/tmp/session.jsonl");
	});
});
