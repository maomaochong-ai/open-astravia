import { definePlugin } from "@vetta-org/plugin-sdk";
import { SettingsView } from "./components/SettingsView.js";
import { SimulatorPanel } from "./components/SimulatorPanel.js";
import { setPluginCtx } from "./plugin-context.js";
import { disposeRuntimeController } from "./runtime/runtime-instance.js";
import { getSettingsStore, resetSettingsStore } from "./runtime/settings-instance.js";
import { detectPlatform, shouldShowTab, TAB_ID } from "./tab-visibility.js";
import "./style.css";

const WORKSPACE_VIEW_ID = "console";

export default definePlugin({
	activate(ctx) {
		setPluginCtx(ctx);
		resetSettingsStore();
		// 旧激活遗留的 serve 在这里收掉；controller 本身是惰性建的，不预先创建。
		void disposeRuntimeController();
		const platform = detectPlatform(navigator.userAgent);

		// MF 的共享依赖（含 jsx runtime）是异步填充的，模块顶层不能出现 JSX；
		// icon 必须在 activate 内构造。
		ctx.ui.registerActivityTab({
			id: TAB_ID,
			label: "%tab.label%",
			icon: (
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
					<rect x="6" y="2.5" width="12" height="19" rx="3" />
					<path d="M10 18.8h4" strokeLinecap="round" />
				</svg>
			),
			component: SimulatorPanel,
			scope_use: ["conversation", "project"],
			// 缺省不上栏：非 macOS 或非 iOS 工程时上栏只会给出一个永远报错的面板。
			initiallyVisible: false,
			retention: "warm",
		});

		ctx.ui.registerWorkspaceView({
			id: WORKSPACE_VIEW_ID,
			label: "%settings.title%",
			description: "%settings.subtitle%",
			component: SettingsView,
		});

		const settings = getSettingsStore();
		/** 每个 cwd 上一次写入的显隐。条件没变就不再调用，避免盖掉用户手动隐藏。 */
		const lastVisible = new Map<string, boolean>();
		let latestCwd: string | null = null;

		const applyVisibility = async (cwd: string): Promise<void> => {
			let entryNames: string[] = [];
			try {
				entryNames = (await ctx.fs.readDir(cwd)).map((entry) => entry.name);
			} catch {
				// 目录不可读时按「不是 iOS 工程」处理，保持隐藏。
			}
			const visible = shouldShowTab({
				platform,
				entryNames,
				alwaysShow: (await settings.load()).alwaysShowTab,
			});
			if (lastVisible.get(cwd) === visible) return;
			lastVisible.set(cwd, visible);
			try {
				ctx.ui.setActivityTabVisible(TAB_ID, visible, { cwd });
			} catch (error) {
				console.warn("[ios-simulator] setActivityTabVisible failed:", error);
			}
		};

		// 订阅后会立刻回放一次 conversation-changed，所以不用等下次切会话。
		ctx.conversation.on((event) => {
			if (event.type !== "conversation-changed") return;
			const { cwd } = event.conversation;
			if (!cwd) return;
			latestCwd = cwd;
			void applyVisibility(cwd);
		});

		// 用户在配置页改了「始终显示」要立刻生效，而不是等下次切会话。
		settings.subscribe(() => {
			const cwd = latestCwd;
			if (!cwd) return;
			lastVisible.delete(cwd);
			void applyVisibility(cwd);
		});
	},
	async deactivate() {
		resetSettingsStore();
		await disposeRuntimeController();
	},
});
