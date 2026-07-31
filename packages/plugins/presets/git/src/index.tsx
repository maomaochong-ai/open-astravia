import { definePlugin } from "@vetta-org/plugin-sdk";
import "./style.css";
import { GitPanel } from "./components/GitPanel";
import { GitTurnCard } from "./components/GitTurnCard";
import { GitIcon } from "./components/icons";
import { emitRefreshSignal, emitTurnPhase, setGitCommand, setPanelResizer } from "./git/runtime";
import { CHANGES_TAB_ID, isInsideGitWorkTree } from "./git/tab-visibility";

export default definePlugin({
	activate(ctx) {
		// Stash the command API for panels (zero-prop activity-tab components read it
		// via the globalThis runtime holder).
		setGitCommand(ctx.command);

		/** 最近一次 conversation-changed 的 cwd，用于丢弃过期的仓库探测结果。 */
		let latestCwd: string | null = null;

		// Let panels resize their host activity panel (narrow click → max, close → narrow).
		setPanelResizer((width) => ctx.ui.openActivityTab(CHANGES_TAB_ID, width === undefined ? undefined : { width }));

		// Refresh the panel after each agent turn (it may have edited files), and
		// surface turn start/end phases for the turn card's per-turn baseline diff.
		// 会话切换（含订阅时的首次回放）按 cwd 判定是不是 git 仓库：是才把「Git 面板」
		// 放进标签栏，非仓库项目不占位。setActivityTabVisible 不会抢焦点弹开面板。
		ctx.conversation.on((event) => {
			if (event.type === "turn-start") {
				emitTurnPhase("start");
			} else if (event.type === "turn-end") {
				emitTurnPhase("end");
				emitRefreshSignal();
			} else if (event.type === "conversation-changed") {
				const { cwd } = event.conversation;
				if (!cwd) return;
				latestCwd = cwd;
				void isInsideGitWorkTree(ctx.command, cwd).then((inRepo) => {
					// 探测是异步的，期间可能已切走——切走后再写就会写到别人的 cwd 上。
					if (latestCwd !== cwd) return;
					ctx.ui.setActivityTabVisible(CHANGES_TAB_ID, inRepo);
				});
			}
		});

		ctx.ui.registerActivityTab({
			id: CHANGES_TAB_ID,
			label: "%tab.label%",
			icon: <GitIcon className="h-4 w-4" />,
			component: GitPanel,
			// 仅在普通项目对话里出现。
			scope_use: ["project"],
			// 出现条件由插件自己驱动：上面的 conversation-changed 探测到 git 工作区才上栏。
			initiallyVisible: false,
		});

		// 消息列表底部的 turn 卡：仅当目录是 Git 仓库且有变更时自显示。
		ctx.ui.registerTurnCard({
			id: "changes",
			component: GitTurnCard,
			scope_use: ["project"],
		});
	},
});
