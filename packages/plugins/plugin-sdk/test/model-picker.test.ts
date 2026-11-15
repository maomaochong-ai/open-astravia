import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { __setPluginHostBridge } from "../src/host-bridge.js";
import { ModelPicker, type PluginModelPickerProps } from "../src/model-picker.js";

/**
 * 插件里的模型选择器是宿主渲染的：SDK 只把 props 转交给 bridge 上的那个组件。
 * 这条用例同时守住两件事——props 原样透传（含 `menuClassName` 这类排布合同），
 * 以及宿主没装 bridge 时给出明确错误，而不是运行期 `undefined is not a function`。
 */

afterEach(() => __setPluginHostBridge(undefined as never));

const PROPS: PluginModelPickerProps = {
	value: "acme/fast",
	onChange: () => undefined,
	emptyOption: { label: "跟随默认" },
	placeholder: "选择模型",
	defaultModelKey: "acme/fast",
	autoSelectDefault: true,
	disabled: false,
	ariaLabel: "模型",
	variant: "field",
	className: "w-full",
	menuClassName: "z-[110]",
	reasoning: { value: "low", onChange: () => undefined },
};

function HostPicker(): null {
	return null;
}

describe("plugin-sdk ModelPicker", () => {
	it("把 props 原样交给宿主的模型选择器", () => {
		__setPluginHostBridge({ ModelPicker: HostPicker } as never);

		const element = ModelPicker(PROPS) as ReactElement<PluginModelPickerProps>;

		expect(element.type).toBe(HostPicker);
		expect(element.props).toEqual(PROPS);
	});

	it("menuClassName 随合同字段一起透传（插件把菜单抬到更高浮层之上）", () => {
		__setPluginHostBridge({ ModelPicker: HostPicker } as never);

		const element = ModelPicker({ ...PROPS, menuClassName: "z-[120]" }) as ReactElement<PluginModelPickerProps>;

		expect(element.props).toMatchObject({ menuClassName: "z-[120]", value: "acme/fast" });
	});

	it("旧宿主的 bridge 上没有这一项时明确报错，而不是静默渲染空白", () => {
		__setPluginHostBridge({} as never);
		// 报错要说出「宿主版本过低」，否则插件作者只会看到一片空白。
		expect(() => ModelPicker(PROPS)).toThrow(/newer Desktop is required/i);
	});

	it("宿主没装 bridge 时同样报错", () => {
		__setPluginHostBridge(undefined as never);
		expect(() => ModelPicker(PROPS)).toThrow(/host bridge/i);
	});
});
