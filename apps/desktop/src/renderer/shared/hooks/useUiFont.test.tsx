// @vitest-environment jsdom
/**
 * 用户路径：在设置页选一档字体 → 偏好落盘 → 根节点立刻换字体栈 → 侧边栏等读取该偏好的组件同步更新。
 * 任何一步断开，用户看到的都是「点了没反应」或是「重启后回退」，
 * 所以这里从 hook 的公共入口点进去，而不是分别断言原子和 localStorage。
 */
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FONT_STORAGE_KEY } from "../theme/ui-font";
import { useUiFont } from "./useUiFont";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(onReady: (api: ReturnType<typeof useUiFont>) => void): { unmount: () => void } {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const store = createStore();
	function Harness(): null {
		onReady(useUiFont());
		return null;
	}
	act(() => {
		root.render(
			<Provider store={store}>
				<Harness />
			</Provider>,
		);
	});
	return {
		unmount: () => {
			act(() => root.unmount());
			container.remove();
		},
	};
}

describe("useUiFont 的写入路径", () => {
	beforeEach(() => {
		localStorage.clear();
		document.documentElement.style.removeProperty("--font-sans");
		document.documentElement.style.removeProperty("--font-mono");
		document.documentElement.removeAttribute("data-font");
	});

	afterEach(() => {
		localStorage.clear();
	});

	it("选一档后立即换字体、写持久化，并同步给读取该偏好的组件", () => {
		let api: ReturnType<typeof useUiFont> | undefined;
		const mounted = mount((next) => {
			api = next;
		});

		expect(api?.family).toBe("system");

		act(() => api?.setFamily("rounded"));

		expect(api?.family).toBe("rounded");
		expect(localStorage.getItem(FONT_STORAGE_KEY)).toBe("rounded");
		expect(document.documentElement.dataset.font).toBe("rounded");
		expect(document.documentElement.style.getPropertyValue("--font-sans")).toContain("SF Pro Rounded");
		// 代码块、diff 与终端读的是同一个令牌，不能只换界面那一侧。
		expect(document.documentElement.style.getPropertyValue("--font-mono")).toContain("SF Pro Rounded");

		mounted.unmount();
	});

});