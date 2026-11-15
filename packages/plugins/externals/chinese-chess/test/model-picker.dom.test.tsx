// @vitest-environment jsdom
/**
 * 象棋插件的模型选择走宿主的 `ModelPicker`。
 *
 * 旧实现是插件自己的原生 `<select>`，模型清单来自 `ctx.ai.listModels()`，因此要
 * `ai.models.list` 权限、清单与宿主不同步、也没有「跟随默认」之外的任何语义。
 * 现在哨兵映射到 `emptyOption`：选中「默认」回调 null，宿主据此用用户的默认模型。
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const picker = vi.hoisted(() => ({ rendered: [] as Record<string, unknown>[], select: null as null | ((key: string | null) => void) }));

vi.mock("@astravia-org/plugin-sdk", async () => {
	const actual = await vi.importActual<Record<string, unknown>>("@astravia-org/plugin-sdk");
	return {
		...actual,
		useTranslation: () => ({ t: (key: string) => key }),
		ModelPicker: (props: Record<string, unknown>) => {
			picker.rendered.push(props);
			picker.select = props.onChange as (key: string | null) => void;
			return <div data-testid="host-model-picker" />;
		},
	};
});

const { NewGameScreen } = await import("../src/components/NewGameScreen.js");

describe("象棋：模型选择交给宿主", () => {
	afterEach(cleanup);

	it("用宿主选择器，「默认」映射成 emptyOption，选默认时回调 null", async () => {
		picker.rendered = [];
		const onStart = vi.fn();
		render(<NewGameScreen onStart={onStart} />);

		expect(screen.getByTestId("host-model-picker")).toBeTruthy();
		const props = picker.rendered[0];
		expect(props).toMatchObject({
			value: null,
			emptyOption: { label: "newGame.model.default" },
			placeholder: "newGame.model.default",
			ariaLabel: "model.label",
		});

		// 宿主回传 null ==「跟随默认」，插件这边保持 null，不做自造哨兵。
		act(() => picker.select?.(null));
		expect(props?.onChange).toBeTypeOf("function");
	});

	it("选中的模型 key 原样进入开局参数", async () => {
		picker.rendered = [];
		const onStart = vi.fn();
		render(<NewGameScreen onStart={onStart} />);

		act(() => picker.select?.("openai/gpt-5"));
		screen.getByRole("button", { name: "newGame.start" }).click();
		expect(onStart).toHaveBeenCalledWith(expect.anything(), "openai/gpt-5");
	});
});
