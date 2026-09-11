import { definePlugin } from "@vetta-org/plugin-sdk";

/**
 * 纯预设插件：三个人设完全由 plugin.json 的 `agent.agents` 声明，宿主在装载 manifest 时
 * 就能铺档案，运行时不需要任何贡献。入口只为满足 manifest 的 entry/moduleFederation 约定。
 */
export default definePlugin({
	activate() {},
});
