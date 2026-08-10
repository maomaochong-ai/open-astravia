import { definePlugin } from "@vetta-org/plugin-sdk";
import type { JSX } from "react";
import { KanbanBoardController } from "./board/board-controller";
import { BoardView } from "./components/BoardView";
import { registerKanbanTools } from "./register-tools";
import "./style.css";

/**
 * 看板：跨项目、跨会话的需求总览与派单入口。
 *
 * 它解决的问题是「对话多了就没人管得住」——用户不必记得某个需求当初开在哪个会话，
 * 只看三条泳道就知道什么在等完善、什么在跑、什么等着验收；发任务也不必先进某个
 * 会话页，在看板上敲一行就行。
 *
 * 注册为**工作区视图**（整页 surface + 侧边栏入口），而不是活动面板标签卡：
 * 看板是跨会话的，绑在某一次对话上没有意义。
 */
/**
 * 模块级持有当前激活的 controller：`deactivate()` 拿不到 ctx，而 controller 持有
 * 一个宿主会话运行态订阅（返回的是裸取消函数，不是宿主统一处置的 Disposable），
 * 必须在这里显式退订，否则热重载会一次次叠加订阅。
 */
let activeController: KanbanBoardController | null = null;

export default definePlugin({
	activate(ctx) {
		activeController?.dispose();
		const controller = new KanbanBoardController(ctx);
		activeController = controller;

		// UI 与 agent 工具共用同一个 controller：用户拖一张卡，agent 下次读板就看到。
		registerKanbanTools(ctx, controller);

		ctx.ui.registerWorkspaceView({
			id: "board",
			label: "%view.board.label%",
			icon: "icon-[solar--widget-4-linear]",
			description: "%view.board.description%",
			component: function KanbanWorkspaceView(): JSX.Element {
				return <BoardView controller={controller} />;
			},
		});

		// 预热：侧边栏入口一点开就该看到板面，而不是先闪一下空态。
		void controller.ensureLoaded();
	},
	deactivate() {
		activeController?.dispose();
		activeController = null;
	},
});
