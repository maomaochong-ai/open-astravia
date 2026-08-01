import { definePlugin, type PluginFileExplorerEntry } from "@vetta-org/plugin-sdk";
import { MobilePreviewPanel } from "./MobilePreviewPanel";
import { setPluginCtx } from "./plugin-context";
import { selectionHasHtmlFile, TAB_ID } from "./tab-visibility";
import "./style.css";

export default definePlugin({
	activate(ctx) {
		setPluginCtx(ctx);
		// 注意：MF 插件的共享依赖（含 jsx runtime）是异步填充的，模块顶层
		// 不能出现 JSX；icon 须在 activate 内构造（此时 bootstrap 已完成）。
		ctx.ui.registerActivityTab({
			id: TAB_ID,
			label: "%tab.label%",
			icon: (
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
					<rect x="7" y="2.5" width="10" height="19" rx="2.5" />
					<path d="M10.5 18.5h3" strokeLinecap="round" />
				</svg>
			),
			component: MobilePreviewPanel,
			// 仅交互式对话场景出现。
			scope_use: ["conversation", "project", "cli"],
			// 缺省不上栏；仅文件树选中 html 时 setActivityTabVisible(true)。
			// 旧版未声明该字段时默认 true，会永久占栏——必须显式 false。
			initiallyVisible: false,
		});

		/** 最近一次 conversation-changed 的 cwd。 */
		let latestCwd: string | null = null;
		/**
		 * 每个 cwd 上一次写入的显隐。条件没变就不再调用：
		 * 避免反复 set 盖掉用户手动点减号的隐藏（同条件再写 true 会重新上栏）。
		 */
		const lastVisible = new Map<string, boolean>();

		const readSelection = (): readonly PluginFileExplorerEntry[] => {
			try {
				return ctx.fileExplorer.getSelection();
			} catch (error) {
				// 缺 workspace.read 授权 / 文件树未就绪：按「未选中」处理，不上栏。
				console.warn("[mobile-ui-preview] getSelection failed, keep tab hidden:", error);
				return [];
			}
		};

		const applyVisibility = (cwd: string, selection: readonly PluginFileExplorerEntry[]) => {
			const visible = selectionHasHtmlFile(selection);
			if (lastVisible.get(cwd) === visible) return;
			lastVisible.set(cwd, visible);
			try {
				ctx.ui.setActivityTabVisible(TAB_ID, visible);
			} catch (error) {
				console.warn("[mobile-ui-preview] setActivityTabVisible failed:", error);
			}
		};

		const syncFromSelection = () => {
			const cwd = latestCwd;
			if (!cwd) return;
			applyVisibility(cwd, readSelection());
		};

		// 会话切换（含订阅时的首次回放）：按当前选区写显隐。
		// 会把历史 localStorage 里「曾因整树扫到 html 而上栏」的脏记录洗成 false，
		// 除非此刻选区里真有 html。
		ctx.conversation.on((event) => {
			if (event.type !== "conversation-changed") return;
			const { cwd } = event.conversation;
			if (!cwd) {
				latestCwd = null;
				return;
			}
			latestCwd = cwd;
			syncFromSelection();
		});

		try {
			ctx.fileExplorer.onDidChangeSelection((selection) => {
				const cwd = latestCwd;
				if (!cwd) return;
				applyVisibility(cwd, selection);
			});
		} catch (error) {
			console.warn("[mobile-ui-preview] onDidChangeSelection failed:", error);
		}
	},
});
