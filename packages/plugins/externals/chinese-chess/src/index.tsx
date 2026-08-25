import { definePlugin } from "@vetta-org/plugin-sdk";
import type { JSX } from "react";
import { ChessView } from "./components/ChessView";
import { createChessRuntime } from "./host";
import { ChessRuntimeProvider } from "./runtime-context";
import "./style.css";

/**
 * 中国象棋对弈：一个独立的工作区视图（侧边栏入口「象棋」）。
 *
 * 对弈完全走插件内部 loop（ctx.ai.chat + 插件私有 make_move 工具），不向宿主
 * Agent 注册任何工具或 skill——玩法插件不应该污染正常会话的工具面。棋局状态
 * 存在插件私有存储里，除非用户手动重置，跨重启保留。
 *
 * 没有 `deactivate()`：运行态只有一个内存 store（不订阅宿主事件、不留定时器），
 * 注册的贡献由宿主统一处置，本插件没有需要自己释放的资源。运行态也刻意不放在
 * 模块级——宿主重载时新实例先 activate、旧实例后 dispose，模块级单例会被旧实例
 * 清空，视图随即失效。
 */
export default definePlugin({
	activate(ctx) {
		const runtime = createChessRuntime(ctx);

		ctx.ui.registerWorkspaceView({
			id: "board",
			label: "%view.chess.label%",
			// 不声明 icon：宿主回落到 plugin.json 里的插件 Logo（assets/logo.svg）。
			description: "%view.chess.description%",
			component: function ChineseChessWorkspaceView(): JSX.Element {
				// 闭包持有本次 activate 的运行态，视图因此不受后续重载影响。
				return (
					<ChessRuntimeProvider value={runtime}>
						<ChessView />
					</ChessRuntimeProvider>
				);
			},
		});

		// 预热：点开侧边栏入口时直接看到棋盘，而不是等存档慢慢读。
		void runtime.store.ensureLoaded();
	},
});
