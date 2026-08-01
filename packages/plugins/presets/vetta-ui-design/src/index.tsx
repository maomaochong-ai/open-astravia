import { definePlugin } from "@vetta-org/plugin-sdk";
import "./style.css";
import { ScreenshotToolCard } from "./cards/ScreenshotToolCard";
import { CanvasTab } from "./canvas/CanvasTab";
import { notifyAgentToolStart, notifyFrameSettled } from "./canvas/design-runtime";
import { stopAllDesignServers } from "./engine/engine-manager";
import { setPluginCtx } from "./plugin-context";
import { VetdPreview } from "./preview/VetdPreview";
import { CANVAS_TAB_ID } from "./tab-ids";
import { registerDesignTools } from "./tools";
import { findVetdFiles } from "./vetd/discover";

function DesignIcon() {
	return (
		<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<rect x="3" y="3" width="8" height="12" rx="1" />
			<rect x="14" y="6" width="7" height="9" rx="1" />
			<path d="M7 19h10" strokeLinecap="round" />
		</svg>
	);
}

export default definePlugin({
	activate(ctx) {
		setPluginCtx(ctx);

		/** 最近一次 conversation-changed 的 cwd，用于丢弃过期的探测结果。 */
		let latestCwd: string | null = null;

		ctx.conversation.on((event) => {
			if (event.type === "conversation-changed") {
				const { cwd } = event.conversation;
				if (!cwd) return;
				latestCwd = cwd;
				void findVetdFiles(ctx.fs, cwd).then((found) => {
					if (latestCwd !== cwd) return;
					ctx.ui.setActivityTabVisible(CANVAS_TAB_ID, found.length > 0);
				});
				return;
			}
			if (event.type === "tool-call-start") {
				notifyAgentToolStart(event.args);
				return;
			}
			if (event.type === "turn-end") {
				notifyFrameSettled(null);
			}
		});

		ctx.ui.registerActivityTab({
			id: CANVAS_TAB_ID,
			label: "%tab.label%",
			icon: <DesignIcon />,
			component: CanvasTab,
			scope_use: ["project", "conversation"],
			// 出现条件由插件驱动：cwd 里有 .vetd 才上栏；vetd_create / 预览「打开画布」也会拉起。
			initiallyVisible: false,
		});

		ctx.ui.registerFilePreview({ extensions: ["vetd"], component: VetdPreview });

		ctx.ui.registerToolCallSlot({
			id: "screenshot-card",
			toolName: "vetd_screenshot",
			component: ScreenshotToolCard,
		});

		registerDesignTools(ctx);
	},
	deactivate() {
		void stopAllDesignServers();
	},
});
