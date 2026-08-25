import { definePlugin } from "@vetta-org/plugin-sdk";
import type { JSX } from "react";
import { KanbanBoardController } from "./board/board-controller";
import { boardNavBadge } from "./board/nav-badge";
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

/** 侧边栏入口角标的订阅，与 controller 同生命周期（见 activeController 的说明）。 */
let disposeBadge: (() => void) | null = null;

/** 视图 id：注册、跳转、改角标都要用它。 */
const BOARD_VIEW_ID = "board";

export default definePlugin({
	activate(ctx) {
		disposeBadge?.();
		disposeBadge = null;
		activeController?.dispose();
		const controller = new KanbanBoardController(ctx);
		activeController = controller;

		// UI 与 agent 工具共用同一个 controller：用户拖一张卡，agent 下次读板就看到。
		registerKanbanTools(ctx, controller);

		ctx.ui.registerWorkspaceView({
			id: BOARD_VIEW_ID,
			label: "%view.board.label%",
			icon: "icon-[solar--archive-minimalistic-outline]",
			description: "%view.board.description%",
			badge: { kind: "beta" },
			component: function KanbanWorkspaceView(): JSX.Element {
				return <BoardView controller={controller} />;
			},
		});

		// 角标跟着板面走：有任务在跑就报数量，空闲退回 Beta 标识。看板的价值一半在
		// 「不进任何会话页也知道现在有多少活在跑」，那就不该非得点开才看得到。
		let lastBadge = "";
		const pushBadge = (board: Parameters<Parameters<typeof controller.subscribe>[0]>[0]): void => {
			const badge = boardNavBadge(board);
			// 每次 setWorkspaceViewBadge 都会让宿主重发注册表快照并重算侧边栏，而
			// 板面因为拖拽、排序等原因变得很频繁，多数变化跟角标无关。
			const key = JSON.stringify(badge);
			if (key === lastBadge) return;
			lastBadge = key;
			ctx.ui.setWorkspaceViewBadge(BOARD_VIEW_ID, badge);
		};
		disposeBadge = controller.subscribe(pushBadge);

		// 预热：侧边栏入口一点开就该看到板面，而不是先闪一下空态。
		// 同时把角标推到磁盘上那份板面的真实状态——重启后本来就可能有任务在跑，
		// 不能等到用户动一下板子才第一次刷新。
		void controller.ensureLoaded().then(pushBadge);
	},
	deactivate() {
		disposeBadge?.();
		disposeBadge = null;
		activeController?.dispose();
		activeController = null;
	},
});
