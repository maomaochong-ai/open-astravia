/**
 * 历史抽屉的可见行为：列表按版本倒序、最新一条是「当前」且不给恢复按钮、
 * 恢复要过二次确认、读不出来时说「读不到」而不是装作没有历史。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${vars.name ?? vars.count}` : key) }),
}));

const listHistory = vi.fn();
const restoreDesign = vi.fn();
const readDir = vi.fn();

vi.mock("../src/history/history-client", () => ({ listHistory: (...args: unknown[]) => listHistory(...args) }));
vi.mock("../src/history/restore", () => ({ restoreDesign: (...args: unknown[]) => restoreDesign(...args) }));
vi.mock("../src/plugin-context", () => ({ getPluginCtx: () => ({ fs: { readDir: (...a: unknown[]) => readDir(...a) } }) }));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HistoryDrawer } from "../src/history/HistoryDrawer";
import type { DesignSession } from "../src/vetd/design-session";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = { dirPath: "/w/a.vetd" } as unknown as DesignSession;
const onPeek = vi.fn();

let host: HTMLDivElement;
let root: Root;

function commits() {
	return [
		{ sha: "c3", title: "把导航栏改到左侧", timestamp: Date.now(), files: ["frames/home.tsx"] },
		{ sha: "c2", title: "登录页换成深色", timestamp: Date.now() - 3_600_000, files: ["frames/login.tsx"] },
		{ sha: "c1", title: "初始状态", timestamp: Date.now() - 7_200_000, files: [] },
	];
}

async function render(): Promise<void> {
	await act(async () => {
		root.render(<HistoryDrawer session={session} peekSha={null} onPeek={onPeek} onClose={() => {}} />);
	});
}

function rows(): HTMLElement[] {
	return [...host.querySelectorAll("article")] as HTMLElement[];
}

function buttonsWithText(text: string): HTMLButtonElement[] {
	return ([...host.querySelectorAll("button")] as HTMLButtonElement[]).filter((button) =>
		button.textContent?.includes(text),
	);
}

beforeEach(() => {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	listHistory.mockReset().mockResolvedValue(commits());
	restoreDesign.mockReset().mockResolvedValue({ restored: null, stashed: null, reinstalled: false });
	readDir.mockReset().mockRejectedValue(new Error("ENOENT"));
	onPeek.mockReset();
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
});

describe("HistoryDrawer", () => {
	it("按版本倒序列出，最新一条标为当前", async () => {
		await render();
		expect(rows().map((row) => row.getAttribute("aria-label"))).toEqual([
			"把导航栏改到左侧",
			"登录页换成深色",
			"初始状态",
		]);
		expect(rows()[0]?.textContent).toContain("history.current");
	});

	it("当前版本没有恢复按钮，其余都有", async () => {
		await render();
		expect(buttonsWithText("history.restore")).toHaveLength(2);
		expect(rows()[0]?.querySelector("button")).toBeNull();
	});

	it("变更文件跟在时间后面——原话没信息量时靠它认版本", async () => {
		await render();
		expect(rows()[1]?.textContent).toContain("frames/login.tsx");
	});

	it("恢复要先过二次确认", async () => {
		await render();
		await act(async () => {
			buttonsWithText("history.restore")[0]?.click();
		});
		expect(restoreDesign).not.toHaveBeenCalled();
		expect(host.textContent).toContain("history.confirm.title");

		await act(async () => {
			buttonsWithText("history.confirm.ok")[0]?.click();
		});
		expect(restoreDesign).toHaveBeenCalledTimes(1);
		expect(restoreDesign.mock.calls[0]?.[2]).toMatchObject({ sha: "c2" });
	});

	it("指针事件不冒泡到画布——画布根会 setPointerCapture，冒过去按钮就点不动了", async () => {
		// 这条不是形式检查：漏掉它时的表现是「查看」和「恢复到此」全都毫无反应，
		// 没有报错、没有 toast，看起来像按钮坏了。ControlBar / ConfirmDialog 同此约定。
		// 画布根必须是 React 根容器的**祖先**：React 18 把合成监听器挂在根容器上，
		// 挂在同一个元素上的原生监听器 stopPropagation 本来就拦不住（那要 stopImmediate）。
		const canvas = document.createElement("div");
		canvas.append(host);
		document.body.append(canvas);
		const onCanvasPointerDown = vi.fn();
		canvas.addEventListener("pointerdown", onCanvasPointerDown);
		await render();
		const button = buttonsWithText("history.peek")[0];
		await act(async () => {
			button?.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
		});
		expect(onCanvasPointerDown).not.toHaveBeenCalled();
		canvas.remove();
	});

	it("查看是另一个按钮，不写历史", async () => {
		await render();
		await act(async () => {
			buttonsWithText("history.peek")[0]?.click();
		});
		// 查看不该走恢复那条路：它是可丢弃的临时态。
		expect(onPeek).toHaveBeenCalledTimes(1);
		expect(onPeek.mock.calls[0]?.[0]).toMatchObject({ sha: "c2" });
		expect(restoreDesign).not.toHaveBeenCalled();
	});

	it("取消确认就什么都不做", async () => {
		await render();
		await act(async () => {
			buttonsWithText("history.restore")[0]?.click();
		});
		await act(async () => {
			buttonsWithText("history.confirm.cancel")[0]?.click();
		});
		expect(restoreDesign).not.toHaveBeenCalled();
		expect(host.textContent).not.toContain("history.confirm.title");
	});

	it("恢复后重新拉一次列表", async () => {
		await render();
		await act(async () => {
			buttonsWithText("history.restore")[0]?.click();
		});
		await act(async () => {
			buttonsWithText("history.confirm.ok")[0]?.click();
		});
		expect(listHistory).toHaveBeenCalledTimes(2);
	});

	it("有缩略图就显示", async () => {
		readDir.mockResolvedValue([{ name: "home.jpg", path: "/w/a.vetd/.history/thumbs/c3/home.jpg", isDirectory: false }]);
		await render();
		expect(host.querySelectorAll("img").length).toBeGreaterThan(0);
	});

	it("读不到历史时说读不到，而不是装作没有版本", async () => {
		listHistory.mockRejectedValue(new Error("runner 挂了"));
		await render();
		expect(host.textContent).toContain("history.drawer.failed");
		expect(host.textContent).not.toContain("history.drawer.empty");
	});

	it("真的没有版本时才说空", async () => {
		listHistory.mockResolvedValue([]);
		await render();
		expect(host.textContent).toContain("history.drawer.empty");
	});
});
