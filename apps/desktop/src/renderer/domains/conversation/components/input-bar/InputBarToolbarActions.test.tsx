// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InputBarLeadingActions } from "./InputBarToolbarActions";
import { ModelMenuFooterContext } from "./model-menu-footer-context";
import type { InputBarModel } from "./types";

/**
 * 工具栏里的竖线用来分隔相邻两组控件。执行模式移进模型菜单后，工具栏里它的位置空了出来，
 * 若仍照旧画线就会在行首留一根悬空短线——这是本次要锁住的行为。
 */
function model(overrides: Partial<InputBarModel> = {}): InputBarModel {
	return {
		hasSession: true,
		labels: {
			toolbar: { add: "添加", addImage: "添加图片", attachFile: "附加文件" },
			capsule: { removeDefault: "移除", activeGroup: "已激活" },
		},
		actions: {},
		leadingTools: [],
		activeActions: [{ id: "skill:one", label: "技能一", icon: "icon-[a]", onRemove: () => {} }],
		...overrides,
	} as unknown as InputBarModel;
}

const dividerCount = (container: HTMLElement): number =>
	container.querySelectorAll("div.h-4.w-px").length;

describe("输入栏工具栏的竖线", () => {
	it("执行模式在菜单里时，行首不再留悬空竖线", () => {
		const { container } = render(
			<ModelMenuFooterContext.Provider value={<span>权限模式</span>}>
				<InputBarLeadingActions model={model()} />
			</ModelMenuFooterContext.Provider>,
		);

		expect(dividerCount(container)).toBe(0);
	});

	it("没有菜单底栏时（团队对话），执行模式留在工具栏，竖线照常分隔", () => {
		const { container } = render(
			<ModelMenuFooterContext.Provider value={null}>
				<InputBarLeadingActions model={model()} />
			</ModelMenuFooterContext.Provider>,
		);

		expect(dividerCount(container)).toBe(1);
	});

	it("没有激活胶囊时也不画分隔线", () => {
		const { container } = render(
			<ModelMenuFooterContext.Provider value={null}>
				<InputBarLeadingActions model={model({ activeActions: [] })} />
			</ModelMenuFooterContext.Provider>,
		);

		expect(dividerCount(container)).toBe(0);
	});
});
