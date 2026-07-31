import { definePlugin } from "@vetta-org/plugin-sdk";
import { MobilePreviewPanel } from "./MobilePreviewPanel";
import { setPluginCtx } from "./plugin-context";
import { hasHtmlFile, TAB_ID } from "./tab-visibility";
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
			// 出现条件由插件自己驱动：cwd 里扫到 html/htm 才上栏。
			initiallyVisible: false,
		});

		/** 最近一次 conversation-changed 的 cwd，用于丢弃过期的扫描结果。 */
		let latestCwd: string | null = null;
		/** 每个 cwd 上一次写入的显隐，条件没变就不再调用，免得盖掉用户手动隐藏。 */
		const lastVisible = new Map<string, boolean>();

		const syncTabVisibility = (cwd: string) => {
			void hasHtmlFile(ctx.fs, cwd).then((visible) => {
				// 扫描是异步的，期间可能已切走——切走后再写就会写到别人的 cwd 上。
				if (latestCwd !== cwd) return;
				if (lastVisible.get(cwd) === visible) return;
				lastVisible.set(cwd, visible);
				ctx.ui.setActivityTabVisible(TAB_ID, visible);
			});
		};

		// 会话切换（含订阅时的首次回放）判定一次；每轮结束再判定一次，
		// agent 本轮新写出的 html 不必等切会话才能让 tab 出现。
		ctx.conversation.on((event) => {
			if (event.type === "conversation-changed") {
				const { cwd } = event.conversation;
				if (!cwd) return;
				latestCwd = cwd;
				syncTabVisibility(cwd);
			} else if (event.type === "turn-end" && latestCwd) {
				syncTabVisibility(latestCwd);
			}
		});
	},
});
