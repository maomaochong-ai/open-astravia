// @vitest-environment jsdom

import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useDockedOutlet } from "./useDockedOutlet";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let outlet: HTMLDivElement | null = null;

/** 同时渲染宽屏侧栏与窄屏 sheet 两份 outlet 容器，模拟跨断点切换时的重叠期。 */
function Probe({ aside, sheet }: { aside: boolean; sheet: boolean }) {
	const [current, registerOutlet] = useDockedOutlet();
	outlet = current;
	return createElement(
		Fragment,
		null,
		aside ? createElement("div", { key: "aside", "data-role": "aside", ref: registerOutlet }) : null,
		sheet ? createElement("div", { key: "sheet", "data-role": "sheet", ref: registerOutlet }) : null,
	);
}

function render(props: { aside: boolean; sheet: boolean }): void {
	act(() => {
		root?.render(createElement(Probe, props));
	});
}

beforeEach(() => {
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement("div");
	document.body.append(container);
	act(() => {
		root = createRoot(container as HTMLDivElement);
	});
});

afterEach(() => {
	act(() => root?.unmount());
	container?.remove();
	root = null;
	container = null;
	outlet = null;
});

it("退场容器卸载时不清空新容器的登记", () => {
	// 窄屏：只有 bottom sheet。
	render({ aside: false, sheet: true });
	expect(outlet?.dataset.role).toBe("sheet");

	// 拉宽的瞬间：侧栏已挂载，sheet 还在播退场动画，两份容器并存。
	render({ aside: true, sheet: true });
	expect(outlet?.dataset.role).toBe("aside");

	// 动画结束、sheet 卸载——登记必须仍指向侧栏那份，而不是被清成 null。
	render({ aside: true, sheet: false });
	expect(outlet?.dataset.role).toBe("aside");
});

it("当前登记的容器卸载后清空", () => {
	render({ aside: true, sheet: false });
	expect(outlet?.dataset.role).toBe("aside");

	render({ aside: false, sheet: false });
	expect(outlet).toBeNull();
});
