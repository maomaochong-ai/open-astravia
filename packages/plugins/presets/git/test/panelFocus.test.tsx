// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitChanges } from "../src/components/GitChanges";
import { clearPanelShowAll, peekPanelFocus, peekPanelShowAll, requestPanelFocus, requestPanelShowAll, setGitCommand } from "../src/git/runtime";
import type { ChangeEntry, StatusGroups } from "../src/git/types";

vi.mock("@astravia-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key, locale: "en" }),
}));
// The pane and the commit box are separate surfaces with their own tests; here we
// only care which entry the panel hands to them.
vi.mock("@pierre/diffs", () => ({ preloadHighlighter: async () => undefined }));
vi.mock("../src/components/DiffPane", () => ({
	DiffPane: ({ entry }: { entry: ChangeEntry }) => <div data-testid="diff-pane">{entry.path}</div>,
}));
vi.mock("../src/components/CommitBox", () => ({ CommitBox: () => null }));

const WIDE = 900;
const groups = (unstaged: ChangeEntry[], staged: ChangeEntry[] = []): StatusGroups => ({ conflict: [], staged, unstaged });

beforeEach(() => {
	setGitCommand({ run: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })) });
	// A panel this wide shows the diff pane next to the tree.
	vi.stubGlobal(
		"ResizeObserver",
		class {
			constructor(private readonly callback: ResizeObserverCallback) {}
			observe(target: Element) {
				this.callback([{ target, contentRect: { width: WIDE } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
			}
			unobserve() {}
			disconnect() {}
		},
	);
	Element.prototype.getBoundingClientRect = () => ({ width: WIDE, height: 600, top: 0, left: 0, right: WIDE, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("Git panel external focus", () => {
	it("selects the file a turn-card row asked for while the panel is already mounted", async () => {
		const target: ChangeEntry = { path: "src/target.ts", code: "M" };
		render(<GitChanges root="/repo" groups={groups([{ path: "src/other.ts", code: "M" }, target])} onOpenGraph={() => undefined} />);

		act(() => requestPanelFocus({ root: "/repo", path: target.path }));

		expect((await screen.findByTestId("diff-pane")).textContent).toBe(target.path);
		expect(peekPanelFocus("/repo")).toBeNull();
	});

	it("keeps the request pending until git status delivers the path, then consumes it", async () => {
		const target: ChangeEntry = { path: "src/late.ts", code: "A" };
		const view = render(<GitChanges root="/repo" groups={groups([])} onOpenGraph={() => undefined} />);

		act(() => requestPanelFocus({ root: "/repo", path: target.path }));
		expect(peekPanelFocus("/repo")).toBe(target.path);

		view.rerender(<GitChanges root="/repo" groups={groups([target])} onOpenGraph={() => undefined} />);

		expect((await screen.findByTestId("diff-pane")).textContent).toBe(target.path);
		expect(peekPanelFocus("/repo")).toBeNull();
	});

	it("ignores requests addressed at another repository", () => {
		render(<GitChanges root="/repo" groups={groups([{ path: "src/other.ts", code: "M" }])} onOpenGraph={() => undefined} />);

		act(() => requestPanelFocus({ root: "/elsewhere", path: "src/other.ts" }));

		expect(peekPanelFocus("/elsewhere")).toBe("src/other.ts");
	});

	it("follows the focused file into another section after it is staged", async () => {
		const target: ChangeEntry = { path: "src/target.ts", code: "M" };
		const other: ChangeEntry = { path: "src/aaa.ts", code: "M" };
		const view = render(<GitChanges root="/repo" groups={groups([other, target])} onOpenGraph={() => undefined} />);

		act(() => requestPanelFocus({ root: "/repo", path: target.path }));
		expect((await screen.findByTestId("diff-pane")).textContent).toBe(target.path);

		// 暂存后文件从 unstaged 摸到 staged；排序上第一个文件变成了 src/aaa.ts。
		view.rerender(<GitChanges root="/repo" groups={groups([other], [target])} onOpenGraph={() => undefined} />);

		expect((await screen.findByTestId("diff-pane")).textContent).toBe(target.path);
	});

	it("shows the whole list without selecting a file when asked (view-all)", async () => {
		const view = render(<GitChanges root="/repo" groups={groups([{ path: "src/other.ts", code: "M" }])} onOpenGraph={() => undefined} />);

		// 面板已挂载且已自动选中第一个文件时，「查看所有变更」仍要有可见效果。
		expect((await screen.findByTestId("diff-pane")).textContent).toBe("src/other.ts");

		act(() => requestPanelShowAll({ root: "/repo" }));

		expect(screen.queryByTestId("diff-pane")).toBeNull();
		expect(screen.getByText("diff.selectPrompt")).toBeTruthy();
		expect(peekPanelShowAll("/repo")).toBe(false);

		// 抑制态不能永久生效：用户再点文件（这里用外部 focus 模拟）仍要显示 diff。
		act(() => requestPanelFocus({ root: "/repo", path: "src/other.ts" }));
		expect((await screen.findByTestId("diff-pane")).textContent).toBe("src/other.ts");

		view.rerender(<GitChanges root="/repo" groups={groups([{ path: "src/other.ts", code: "M" }])} onOpenGraph={() => undefined} />);
		expect((await screen.findByTestId("diff-pane")).textContent).toBe("src/other.ts");
	});
});
