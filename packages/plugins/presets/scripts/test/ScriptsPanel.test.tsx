// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { __BottomPanelContext, type PluginBottomPanelContextValue } from "@vetta-org/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScriptsPanel } from "../src/components/ScriptsPanel";
import { setScriptsFs } from "../src/runtime";
import type { ScriptsFs } from "../src/scripts/discover";

vi.mock("@vetta-org/plugin-sdk", async (importOriginal) => ({
	...(await importOriginal<typeof import("@vetta-org/plugin-sdk")>()),
	useTranslation: () => ({
		locale: "en",
		t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
	}),
}));

const FILES: Record<string, string> = {
	"package.json": JSON.stringify({ name: "acme", scripts: { dev: "turbo dev" } }),
	"bun.lock": "",
	"apps/web/package.json": JSON.stringify({ name: "@acme/web", scripts: { dev: "vite", build: "vite build" } }),
	"Makefile": "test: ## 跑全部测试\n\tbun test\n",
};

function installFs(files: Record<string, string>) {
	const fs: ScriptsFs = {
		listFilesRecursive: async () =>
			Object.keys(files).map((relPath) => ({
				name: relPath.slice(relPath.lastIndexOf("/") + 1),
				path: `/repo/${relPath}`,
				relPath,
			})),
		readFile: async (path) => ({ content: files[path.slice("/repo/".length)] ?? "", encoding: "utf8" }),
	};
	setScriptsFs(fs);
}

function renderPanel(overrides: Partial<PluginBottomPanelContextValue> = {}) {
	const open = new Set<string>();
	let counter = 0;
	const context: PluginBottomPanelContextValue = {
		instanceId: "scripts-1",
		cwd: "/repo",
		active: true,
		setMeta: () => {},
		setCloseGuard: () => {},
		openTerminal: vi.fn(() => {
			const id = `terminal-${++counter}`;
			open.add(id);
			return id;
		}),
		revealInstance: vi.fn((id: string) => open.has(id)),
		...overrides,
	};
	render(
		<__BottomPanelContext.Provider value={context}>
			<ScriptsPanel />
		</__BottomPanelContext.Provider>,
	);
	return { context, open, user: userEvent.setup() };
}

beforeEach(() => installFs(FILES));
afterEach(() => {
	cleanup();
	setScriptsFs(undefined);
});

describe("脚本面板：常见使用流程", () => {
	it("按项目分组列出 package.json 脚本和 Makefile 目标，点一下就开终端跑", async () => {
		const { context, user } = renderPanel();

		const web = await screen.findByRole("region", { name: "@acme/web" });
		expect(within(screen.getByRole("region", { name: "acme" })).getByText("test")).toBeTruthy();
		// 原始命令放在悬停提示里，芯片本身只写脚本名，宫格才排得密。
		expect(within(web).getByRole("button", { name: "build" }).getAttribute("title")).toBe("bun run build\nvite build");

		await user.click(within(web).getByRole("button", { name: /^dev/ }));

		expect(context.openTerminal).toHaveBeenCalledWith({
			command: "bun run dev",
			cwd: "/repo/apps/web",
			label: "@acme/web: dev",
		});
	});

	it("再点同一个脚本切回它的终端；终端被关掉后重新开；行尾按钮总是新开", async () => {
		const { context, open, user } = renderPanel();
		const root = await screen.findByRole("region", { name: "acme" });
		const devRow = within(root).getByRole("button", { name: /^dev/ });

		await user.click(devRow);
		await user.click(devRow);
		expect(context.openTerminal).toHaveBeenCalledTimes(1);
		expect(context.revealInstance).toHaveBeenLastCalledWith("terminal-1");

		open.delete("terminal-1");
		await user.click(devRow);
		expect(context.openTerminal).toHaveBeenCalledTimes(2);

		await user.click(within(root).getByRole("button", { name: /action.runInNewTerminal.*"dev"/ }));
		expect(context.openTerminal).toHaveBeenCalledTimes(3);
		expect(context.openTerminal).toHaveBeenLastCalledWith({ command: "bun run dev", cwd: "/repo", label: "dev" });
	});

	it("搜索按名字、命令和项目过滤，没有命中时给出提示", async () => {
		const { user } = renderPanel();
		await screen.findByRole("region", { name: "acme" });

		await user.type(screen.getByRole("textbox", { name: "search.placeholder" }), "vite build");
		expect(screen.queryByRole("region", { name: "acme" })).toBeNull();
		const web = screen.getByRole("region", { name: "@acme/web" });
		expect(within(web).getByRole("button", { name: "build" })).toBeTruthy();
		expect(within(web).queryByRole("button", { name: "dev" })).toBeNull();

		await user.click(screen.getByRole("button", { name: "search.clear" }));
		expect(screen.getByRole("region", { name: "acme" })).toBeTruthy();
		await user.type(screen.getByRole("textbox", { name: "search.placeholder" }), "zzz");
		expect(screen.getByText("state.noMatch")).toBeTruthy();
	});

	it("宿主拒绝开终端（如缺权限）时把原因显示出来", async () => {
		const { user } = renderPanel({
			openTerminal: () => {
				throw new Error("Plugin permission denied: terminal.run");
			},
		});
		const root = await screen.findByRole("region", { name: "acme" });

		await user.click(within(root).getByRole("button", { name: /^dev/ }));

		expect(screen.getByRole("alert").textContent).toContain("Plugin permission denied: terminal.run");
	});

	it("没有任何脚本时说明原因；重新扫描能看到新加的脚本", async () => {
		installFs({ "README.md": "" });
		const { user } = renderPanel();
		expect(await screen.findByText("state.empty.title")).toBeTruthy();

		installFs(FILES);
		await user.click(screen.getByRole("button", { name: "action.refresh" }));

		expect(await screen.findByRole("region", { name: "acme" })).toBeTruthy();
	});
});

describe("脚本很多的项目", () => {
	const many = {
		"package.json": JSON.stringify({
			name: "big",
			scripts: Object.fromEntries(Array.from({ length: 14 }, (_, index) => [`task-${index}`, `echo ${index}`])),
		}),
	};

	it("卡片默认只露出前 10 个，点「更多」展开、再点收起", async () => {
		installFs(many);
		const { user } = renderPanel();
		const card = await screen.findByRole("region", { name: "big" });
		expect(within(card).queryByRole("button", { name: "task-13" })).toBeNull();

		await user.click(within(card).getByRole("button", { name: /card.showMore.*4/ }));
		expect(within(card).getByRole("button", { name: "task-13" })).toBeTruthy();

		await user.click(within(card).getByRole("button", { name: "card.showLess" }));
		expect(within(card).queryByRole("button", { name: "task-13" })).toBeNull();
	});

	it("搜索时命中项不会被藏在「更多」后面", async () => {
		installFs(many);
		const { user } = renderPanel();
		await screen.findByRole("region", { name: "big" });

		await user.type(screen.getByRole("textbox", { name: "search.placeholder" }), "big");

		expect(within(screen.getByRole("region", { name: "big" })).getByRole("button", { name: "task-13" })).toBeTruthy();
	});
});
