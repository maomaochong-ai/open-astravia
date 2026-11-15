// @vitest-environment jsdom
/**
 * 提示词优化的模型选择走宿主的选择器（`plugin-sdk` 的 `ModelPicker`）。
 *
 * 这条用例守住的是一条真实缺陷：插件曾经自己调 `ai.listModels()` 拉清单、自己过滤
 * 「支持文本」，于是①要 `ai.models.list` 权限、②清单与宿主输入栏不是同一份（云端目录
 * 增删后插件还是旧的）、③没有默认模型、收藏与思考档位。现在只把「记住哪个模型」留在插件里。
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const picker = vi.hoisted(() => ({ rendered: [] as Record<string, unknown>[] }));

vi.mock("@astravia-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
	// 宿主渲染的组件在单测里换成一颗按钮：记录拿到的 props，点击时按宿主的语义回传一个 key。
	ModelPicker: (props: Record<string, unknown>) => {
		picker.rendered.push(props);
		return (
			<button type="button" onClick={() => (props.onChange as (key: string) => void)("acme/fast")}>
				host-model-picker
			</button>
		);
	},
}));

// 宿主的 UI 原语在插件单测里不参与断言：换成最朴素的元素，避免引入宿主设计系统的 React 单例。
vi.mock("@astravia-org/ui", () => ({
	Button: ({ children, ...props }: React.ComponentProps<"button">) => <button type="button" {...props}>{children}</button>,
	Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const { PromptOptimizationControl } = await import("../src/prompt-optimization/PromptOptimizationControl.js");

describe("提示词优化的模型选择", () => {
	afterEach(cleanup);

	it("用宿主的模型选择器，并把选中的 key 交给调用方", async () => {
		picker.rendered = [];
		const onModelChange = vi.fn();
		const onOptimize = vi.fn();

		render(
			<PromptOptimizationControl
				selectedModelKey="acme/slow"
				isOptimizing={false}
				canOptimize
				onModelChange={onModelChange}
				onOptimize={onOptimize}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "nodeEditor.promptOptimization.title" }));
		await act(async () => {});

		// 用宿主的选择器（旧实现是插件自绘的 Select + 自己拉来的模型清单）。
		const trigger = await screen.findByRole("button", { name: "host-model-picker" });
		expect(picker.rendered).toHaveLength(1);

		fireEvent.click(trigger);
		expect(onModelChange).toHaveBeenCalledWith("acme/fast");
	});

	it("交给宿主选择器的值是受控的，并带上自动补默认模型与浮层层级", async () => {
		picker.rendered = [];
		render(
			<PromptOptimizationControl
				selectedModelKey={undefined}
				isOptimizing={false}
				canOptimize
				onModelChange={vi.fn()}
				onOptimize={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "nodeEditor.promptOptimization.title" }));
		await act(async () => {});
		await screen.findByRole("button", { name: "host-model-picker" });

		expect(picker.rendered[0]).toMatchObject({
			value: null,
			autoSelectDefault: true,
			// 画布节点编辑器是 z-[100] 的浮层：菜单要能抬到它之上。
			menuClassName: "z-[110]",
			ariaLabel: "nodeEditor.promptOptimization.model",
		});
	});
});
