// @vitest-environment jsdom

import { ActivityPanelContextProvider } from "@domains/activity-panel/registry/context";
import { useRendererMarkdownModel } from "@shared/hooks/useRendererMarkdownModel";
import {
	activityPanelOpenAtom,
	activityPanelTabByProjectAtom,
	fileExplorerRevealRequestAtom,
	filePreviewAtom,
} from "@shared/store/atoms";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RendererMarkdownContent } from "./RendererMarkdownContent";
import { RendererMarkdownScope } from "./RendererMarkdownScope";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

afterEach(cleanup);

const ROOT = "/ws/project";

/**
 * 交付物链接点开之后，文件面板要定位到那份文件：
 * 打开活动面板、切到文件 tab、把解析后的绝对路径交给文件树。
 *
 * 这里只断言「receiver 侧收到了什么」，树自己的展开/选中/滚动由
 * useFilesPanelModel.reveal.test.tsx 覆盖。
 */
function renderLink(workspaceId: string, cwd: string | null, link: string): { store: ReturnType<typeof createStore> } {
	const store = createStore();
	const workspace = createActivityWorkspace(workspaceId, cwd);
	function MarkdownLink(): JSX.Element {
		const model = useRendererMarkdownModel(cwd, true, workspaceId);
		return (
			<RendererMarkdownScope value={model}>
				<RendererMarkdownContent text={`产出：[report.md](${link})`} />
			</RendererMarkdownScope>
		);
	}
	render(
		<Provider store={store}>
			<ActivityPanelContextProvider value={{ workspace, knowledgeHistory: false }}>
				<MarkdownLink />
			</ActivityPanelContextProvider>
		</Provider>,
	);
	fireEvent.click(screen.getByRole("button", { name: /report\.md/ }));
	return { store };
}

describe("Markdown 文件链接", () => {
	it("点开会把文件树定位到工作区内的那份文件", () => {
		const { store } = renderLink(ROOT, ROOT, `${ROOT}/docs/report.md`);

		expect(store.get(activityPanelOpenAtom)).toBe(true);
		expect(store.get(activityPanelTabByProjectAtom).get(ROOT)).toBe("file");
		expect(store.get(fileExplorerRevealRequestAtom)?.path).toBe(`${ROOT}/docs/report.md`);
	});

	it("相对路径按会话工作区解析后再定位", () => {
		const { store } = renderLink(ROOT, ROOT, "./docs/report.md");

		expect(store.get(fileExplorerRevealRequestAtom)?.path).toBe(`${ROOT}/docs/report.md`);
	});

	it("工作区之外的路径也要能落位，而不是只在浮层里预览", () => {
		const { store } = renderLink(ROOT, ROOT, "/tmp/elsewhere/report.md");

		// 文件树只显示工作区内的条目，但面板仍应切到文件 tab：
		// 用户点的是「这个文件在哪」，把它丢进独立预览等于让他重新翻目录。
		expect(store.get(activityPanelTabByProjectAtom).get(ROOT)).toBe("file");
		expect(store.get(fileExplorerRevealRequestAtom)?.path).toBe("/tmp/elsewhere/report.md");
		expect(store.get(filePreviewAtom)).toBeNull();
	});
});
