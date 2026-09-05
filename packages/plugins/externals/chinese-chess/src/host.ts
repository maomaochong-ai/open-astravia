import type { PluginContext } from "@vetta-org/plugin-sdk";
import { ChessStore } from "./game/store";
import type { ChessRuntime } from "./runtime-context";

/**
 * 把宿主 ctx 收敛成本插件的运行态。每次 `activate()` 建一份，由该次注册的视图
 * 闭包持有——没有模块级单例，因此重载期间新旧实例互不干扰。
 */
export function createChessRuntime(ctx: PluginContext): ChessRuntime {
	const store = new ChessStore({
		storage: {
			readFile: (key, encoding) => ctx.storage.readFile(key, encoding),
			writeFile: (key, data, encoding) => ctx.storage.writeFile(key, data, encoding),
		},
		ai: { chat: (request) => ctx.ai.chat(request) },
		notify: (options) => ctx.ui.notify(options),
	});
	return {
		store,
		listModels: async () => {
			try {
				return await ctx.ai.listModels();
			} catch {
				// 未授予 ai.models.list 或没有可用模型：选择器隐藏，不打断对局。
				return null;
			}
		},
	};
}
