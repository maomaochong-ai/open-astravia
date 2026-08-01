import { type CardDescriptor, definePlugin, type PluginPendingToolCall } from "@vetta-org/plugin-sdk";
import "./style.css";
import { ScreenshotCard } from "./cards/ScreenshotCard";
import { SCREENSHOT_CARD_TYPE, SCREENSHOT_TOOL_NAME, screenshotCardDescriptor } from "./cards/screenshot-card";
import { CanvasTab } from "./canvas/CanvasTab";
import { getCanvasController, notifyAgentToolStart, notifyFrameSettled } from "./canvas/design-runtime";
import { stopAllDesignServers } from "./engine/engine-manager";
import { ExportMockupDialog } from "./mockup/ExportMockupDialog";
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

function ScreenshotIcon() {
	return (
		<svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
			<rect x="3" y="6" width="18" height="14" rx="2" />
			<circle cx="12" cy="13" r="3.2" />
			<path d="M8.5 6l1.3-2h4.4l1.3 2" strokeLinejoin="round" />
		</svg>
	);
}

/**
 * 截图进行中就先出卡（骨架占位）。key 与 handler 同源（同一个画布控制器），
 * 所以 pending 卡和落定卡是同一张逻辑卡；画布没开时 handler 直接报错、块随即落定，
 * 骨架自然消失。
 */
function pendingScreenshotCard(toolCall: PluginPendingToolCall): CardDescriptor | null {
	if (toolCall.toolName !== SCREENSHOT_TOOL_NAME) return null;
	const raw = toolCall.args.frame;
	const frameId = typeof raw === "string" ? raw.replace(/\.tsx$/, "") : "";
	const session = getCanvasController()?.session;
	if (!frameId || !session) return null;
	return screenshotCardDescriptor(session.vetdPath, session.dirPath, frameId);
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

		// 导出渲染图的 dialog 走全局插槽：设计画布在活动面板里太窄，
		// 判断圆角/边框需要整窗口的预览面积。
		ctx.ui.registerGlobalSlot({ id: "export-mockup-dialog", component: ExportMockupDialog });

		ctx.ui.registerFilePreview({ extensions: ["vetd"], component: VetdPreview });

		ctx.ui.registerCardRenderer({
			type: SCREENSHOT_CARD_TYPE,
			component: ScreenshotCard,
			title: "%card.screenshot.title%",
			icon: <ScreenshotIcon />,
			pendingFor: pendingScreenshotCard,
		});

		registerDesignTools(ctx);
	},
	deactivate() {
		void stopAllDesignServers();
	},
});
