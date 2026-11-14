import { describe, expect, it } from "vitest";
import * as pluginUi from "./index";

/**
 * `plugin-ui` 是宿主与插件之间的**公共 UI 合同**：列进来的每一个运行时导出都会随
 * Module Federation 共享域发给外置插件，改它的 props 等于改别人的编译期依赖。
 *
 * 所以这份清单是显式的：新增或删除导出都必须同时改这里，让「顺手把某个业务视图挂
 * 上去」在测试里立刻失败。类型导出无法在运行时枚举（`export type` 会被擦掉），
 * 它们由 `tsc` 的出口面保证，这里只管运行时值。
 */
const RUNTIME_EXPORTS = [
	"ModelSelectorView",
	"MultiplierTag",
	"PROVIDER_ICONS",
	"ProviderIcon",
	"fmtMultiplier",
	"getProviderIcon",
	"MotionSelect",
	"SettingHeading",
	"SettingRow",
	"SettingSection",
] as const;

describe("plugin-ui export surface", () => {
	it("exposes exactly the reviewed runtime components", () => {
		expect(Object.keys(pluginUi).sort()).toEqual([...RUNTIME_EXPORTS].sort());
	});

	it("does not leak business views", () => {
		// 带数据源与写回逻辑的设置页/能力页视图属于宿主功能，不是可复用形态。
		for (const name of ["AppearanceSettingsView", "SettingsView", "AbilitiesView"]) {
			expect(pluginUi).not.toHaveProperty(name);
		}
	});
});
