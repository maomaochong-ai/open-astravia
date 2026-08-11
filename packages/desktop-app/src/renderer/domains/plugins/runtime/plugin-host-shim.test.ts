import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { installPluginHostShim } from "./plugin-host-shim";
import { pluginHostShimModules } from "./plugin-shared-modules";

/**
 * `vetta-host://*` 的生成式 shim（主进程 plugin-protocol.ts）在插件模块求值时读
 * `globalThis.__VETTA_PLUGIN_HOST__.<key>`。这个全局对象漏一个 key 不会有任何类型
 * 错误——插件却会在加载时抛 `Cannot read properties of undefined`，整个插件（含它
 * 注册的侧边栏入口）静默消失。历史上 `themeUiPlugin` 就是这样漏掉的。
 */

const PROTOCOL_SOURCE = fileURLToPath(new URL("../../../../main/plugins/plugin-protocol.ts", import.meta.url));

function hostKeysReadByProtocolShim(): string[] {
	const source = readFileSync(PROTOCOL_SOURCE, "utf-8");
	const keys = new Set<string>();
	for (const match of source.matchAll(/__VETTA_PLUGIN_HOST__\.([A-Za-z_$][\w$]*)/g)) {
		keys.add(match[1]);
	}
	return [...keys].sort();
}

describe("installPluginHostShim", () => {
	it("装上 plugin-shared-modules 里的全部宿主模块", () => {
		installPluginHostShim();
		expect(globalThis.__VETTA_PLUGIN_HOST__).toBeDefined();
		for (const key of Object.keys(pluginHostShimModules)) {
			expect(globalThis.__VETTA_PLUGIN_HOST__?.[key as keyof typeof pluginHostShimModules]).toBeDefined();
		}
	});

	it("主进程 shim 读到的每个 key 都存在——漏一个就是插件静默消失", () => {
		installPluginHostShim();
		const host = globalThis.__VETTA_PLUGIN_HOST__;
		const readKeys = hostKeysReadByProtocolShim();
		// 断言解析确实抓到了东西，否则正则失效会让这条测试变成空跑。
		expect(readKeys.length).toBeGreaterThan(3);
		expect(readKeys).toContain("themeUiPlugin");
		for (const key of readKeys) {
			expect(host?.[key as keyof typeof pluginHostShimModules], `__VETTA_PLUGIN_HOST__.${key} 未装载`).toBeDefined();
		}
	});

	it("theme-ui 侧的模型选择器可达（0.3.0 看板加载失败的直接原因）", () => {
		installPluginHostShim();
		expect(globalThis.__VETTA_PLUGIN_HOST__?.themeUiPlugin.ModelSelectorView).toBeDefined();
	});
});
