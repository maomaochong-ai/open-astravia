// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { StepSlider } from "./step-slider";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
	document.body.replaceChildren();
});

const LABELS = ["75%", "90%", "100%", "110%", "125%", "150%"];

function mount(props: Partial<Parameters<typeof StepSlider>[0]> = {}) {
	const app = document.createElement("div");
	document.body.append(app);
	const root = createRoot(app);
	const onIndexChange = vi.fn();
	const onIndexCommit = vi.fn();
	act(() => {
		root.render(
			<StepSlider
				labels={LABELS}
				index={2}
				aria-label="界面大小"
				onIndexChange={onIndexChange}
				onIndexCommit={onIndexCommit}
				{...props}
			/>,
		);
	});
	const slider = app.querySelector<HTMLElement>('[data-slot="slider"]');
	if (!slider) throw new Error("slider not mounted");
	// happy-dom 不做布局：给出真实宽度，指针位置才能换算成档位。
	slider.getBoundingClientRect = () =>
		({ left: 0, top: 0, width: 300, height: 24, right: 300, bottom: 24, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
	return { app, root, slider, onIndexChange, onIndexCommit };
}

function pointer(element: HTMLElement, type: "pointerdown" | "pointermove" | "pointerup", clientX: number) {
	const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 });
	Object.defineProperty(event, "pointerId", { value: 1 });
	act(() => {
		element.dispatchEvent(event);
	});
}

describe("StepSlider", () => {
	test("拖动过程中只上报预览档位，松手才提交", () => {
		const { slider, onIndexChange, onIndexCommit } = mount();

		pointer(slider, "pointerdown", 5);
		expect(onIndexChange).toHaveBeenCalledWith(0);
		expect(onIndexCommit).not.toHaveBeenCalled();

		pointer(slider, "pointermove", 270);
		expect(onIndexChange).toHaveBeenLastCalledWith(5);
		expect(onIndexCommit).not.toHaveBeenCalled();

		pointer(slider, "pointerup", 270);
		expect(onIndexCommit).toHaveBeenCalledWith(5);
	});

	test("吸附到最近的档位而不是连续值", () => {
		const { slider, onIndexChange } = mount();

		// 300px / 6 档：x=118 落在第 3 档附近但更靠近第 2 档，取最近的整数档。
		pointer(slider, "pointerdown", 118);
		expect(onIndexChange).toHaveBeenCalledWith(2);
	});

	test("点档位标签直接提交该档", () => {
		const { app, onIndexChange, onIndexCommit } = mount();

		const last = Array.from(app.querySelectorAll("button")).at(-1);
		if (!last) throw new Error("labels not rendered");
		act(() => {
			last.click();
		});

		expect(onIndexCommit).toHaveBeenCalledWith(5);
		// 点标签是直接提交，不走拖动预览。
		expect(onIndexChange).not.toHaveBeenCalled();
	});

	test("禁用时不响应指针", () => {
		const { slider, onIndexChange, onIndexCommit } = mount({ disabled: true });

		pointer(slider, "pointerdown", 270);
		pointer(slider, "pointerup", 270);

		expect(onIndexChange).not.toHaveBeenCalled();
		expect(onIndexCommit).not.toHaveBeenCalled();
	});

	test("过渡动画带 motion-reduce 关闭", () => {
		const { app } = mount();
		// 缩放动画在滑动条上，关掉 prefers-reduced-motion 的用户不该看到宽度补间。
		const animated = Array.from(app.querySelectorAll<HTMLElement>("[data-slot='slider-range'], [data-slot='slider-thumb']"));
		expect(animated.length).toBeGreaterThan(0);
		for (const element of animated) {
			expect(element.className).toContain("motion-reduce:transition-none");
		}
	});
});
