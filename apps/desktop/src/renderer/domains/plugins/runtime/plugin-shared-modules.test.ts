import { describe, expect, it } from "vitest";
import { createPluginRuntimeShared, pluginSharedModules } from "./plugin-shared-modules";

/**
 * 共享模块的**键就是包名**，而包名改过一次（`@vetta/ui` → `@vetta-org/ui`）。
 *
 * 市场上已发布的插件在自己的 remoteEntry 里声明的仍是旧名：宿主只提供新名时，它们在共享域
 * 里落空、退回各自打包的那一份，于是宿主与插件各持一份组件实例——样式与状态都会出问题，
 * 而且不报错。重建全部既有插件不现实，所以两个名字必须同时在位。
 */
describe("plugin shared modules", () => {
	it("serves the design system under both its current and legacy package name", () => {
		expect(pluginSharedModules["@vetta-org/ui"].module).toBe(pluginSharedModules["@vetta/ui"].module);
	});

	it("serves the host component surface under both names too", () => {
		expect(pluginSharedModules["@vetta-org/theme-ui/plugin-ui"].module).toBe(
			pluginSharedModules["@vetta/theme-ui/plugin-ui"].module,
		);
	});

	it("exposes every registered name to the federation share scope", () => {
		const shared = createPluginRuntimeShared();

		for (const name of Object.keys(pluginSharedModules)) {
			expect(Object.keys(shared)).toContain(name);
		}
		// 共享条目的类型是联合体；取到的这一支带 lib()，它返回的实例必须与新名同一份。
		const legacy = shared["@vetta/ui"];
		const resolve = (Array.isArray(legacy) ? legacy[0] : legacy) as { lib?: () => unknown } | undefined;
		expect(resolve?.lib?.()).toBe(pluginSharedModules["@vetta-org/ui"].module);
	});
});
