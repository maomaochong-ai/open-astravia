// @vitest-environment jsdom
/**
 * 看板的模型选择器用的是宿主那一个（`plugin-sdk` 的 `ModelPicker`）。
 *
 * 旧实现是在插件里自己拼 `ModelSelectorView`（118 行）并用 `INHERIT_KEY` 哨兵把
 * 「跟随默认」塞进模型列表首组：清单靠插件自己映射、收藏与搜索跟着插件走、
 * 哨兵 key 还得在选中时再翻译回空串。迁移后插件只剩一次空值语义的适配。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
	props: [] as Record<string, unknown>[],
	emit: null as null | ((key: string | null) => void),
}));

vi.mock("@astravia-org/plugin-sdk", () => ({
	// 宿主渲染的组件在单测里换成一颗按钮：记录 props，点击时按宿主语义回传 key。
	ModelPicker: (props: Record<string, unknown>) => {
		host.props.push(props);
		host.emit = props.onChange as (key: string | null) => void;
		return <div data-testid="host-model-picker" />;
	},
}));

const { BoardModelPicker } = await import("../src/components/BoardModelPicker.js");

afterEach(() => {
	cleanup();
	host.props = [];
	host.emit = null;
});

describe("看板模型选择器", () => {
	it("把「跟随默认」交给宿主的空值项，而不是塞进模型列表的哨兵", () => {
		render(<BoardModelPicker value="" onChange={vi.fn()} inheritLabel="看板默认（Opus 5）" ariaLabel="执行模型" />);

		expect(screen.getByTestId("host-model-picker")).toBeTruthy();
		expect(host.props[0]).toMatchObject({
			// 空串 = 跟随默认 → 宿主用 null 表达「未选」。
			value: null,
			emptyOption: { label: "看板默认（Opus 5）" },
			placeholder: "看板默认（Opus 5）",
			ariaLabel: "执行模型",
		});
		// 旧实现会把哨兵 key 交给视图，并在选中时再翻译；这里不应出现任何哨兵。
		expect(JSON.stringify(host.props[0])).not.toContain("__kanban_inherit__");
	});

	it("空值语义进出都转换：宿主回 null 变成空串，选中模型原样透传", () => {
		const onChange = vi.fn();
		render(<BoardModelPicker value="acme/fast" onChange={onChange} inheritLabel="跟随默认" ariaLabel="执行模型" />);

		expect(host.props[0]?.value).toBe("acme/fast");

		host.emit?.(null);
		expect(onChange).toHaveBeenLastCalledWith("");

		host.emit?.("acme/slow");
		expect(onChange).toHaveBeenLastCalledWith("acme/slow");
	});

	it("看板不按轮次调思考档位，因此不给宿主推理栏", () => {
		render(<BoardModelPicker value="" onChange={vi.fn()} inheritLabel="跟随默认" ariaLabel="执行模型" />);
		expect(host.props[0]).not.toHaveProperty("reasoning");
	});
});
