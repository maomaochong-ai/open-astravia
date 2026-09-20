import { definePlugin } from "@vetta-org/plugin-sdk";
import "./style.css";
import { GitPanel } from "./components/GitPanel";
import { GitSettingsView } from "./components/GitSettingsView";
import { GitTurnCard } from "./components/GitTurnCard";
import { GitIcon } from "./components/icons";
import { emitRefreshSignal, emitTurnPhase, setAiApi, setFsApi, setGitCommand, setOfficialApi, setPanelResizer, setStorageApi } from "./git/runtime";
import { CHANGES_TAB_ID, isInsideGitWorkTree } from "./git/tab-visibility";

export default definePlugin({
	activate(ctx) {
		// Stash the command API for panels (zero-prop activity-tab components read it
		// via the globalThis runtime holder).
		setGitCommand(ctx.command);
		// 同理：右键菜单的「忽略此文件」要写 .gitignore，「在文件管理器中显示」走官方窄口子。
		setFsApi(ctx.fs);
		setOfficialApi(ctx.official);
		// 提交信息草稿按仓库持久化，避免切会话/重启后白写一场。
		setStorageApi(ctx.storage);
		// 提交信息的一键生成走宿主推理，不建会话、不落 session 文件。
		setAiApi(ctx.ai);

		/** 最近一次 conversation-changed 的 cwd，用于丢弃过期的仓库探测结果。 */
		let latestCwd: string | null = null;

		// Let panels resize their host activity panel (narrow click → max, close → narrow).
		// 面板内部改宽度走 setActivityPanelWidth：openActivityTab 语义是「打开某个标签卡」，
		// 在已经身处该标签卡里时用它拉宽，等于每次点文件都重新打开一次自己。
		setPanelResizer((width) => {
			if (width === undefined) ctx.ui.openActivityTab(CHANGES_TAB_ID);
			else ctx.ui.setActivityPanelWidth(width);
		});

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

		// Git 相关配置（提交信息模板、常用行为开关）。纯配置页，配好之后很少再来：
		// sidebar: false 只让它出现在 设置 → 扩展 里，不占侧边栏。
		ctx.ui.registerWorkspaceView({
			id: "settings",
			label: "%settings.title%",
			icon: "icon-[mdi--source-branch]",
			description: "%settings.tagline%",
			sidebar: false,
			component: GitSettingsView,
		});

		// 消息列表底部的 turn 卡：仅当目录是 Git 仓库且有变更时自显示。
		ctx.ui.registerTurnCard({
			id: "changes",
			component: GitTurnCard,
			scope_use: ["project"],
		});
	},
});
