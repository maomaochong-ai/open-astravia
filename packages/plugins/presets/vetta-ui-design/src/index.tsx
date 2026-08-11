import {
	type AgentMode,
	type CardDescriptor,
	definePlugin,
	type Disposable,
	type PluginPendingToolCall,
} from "@vetta-org/plugin-sdk";
import vetdIconUrl from "../icon.png";
import "./style.css";
import { DESIGN_SYSTEM_CARD_TYPE } from "./cards/design-system-card";
import { DesignSystemPickerCard } from "./cards/DesignSystemPickerCard";
import { ScreenshotCard } from "./cards/ScreenshotCard";
import { SCREENSHOT_CARD_TYPE, SCREENSHOT_TOOL_NAME, screenshotCardDescriptor } from "./cards/screenshot-card";
import { CanvasTab } from "./canvas/CanvasTab";
import {
	getCanvasController,
	notifyAgentToolEnd,
	notifyAgentToolStart,
	notifyFrameSettled,
	requestMockupExport,
	setPendingDesignPath,
} from "./canvas/design-runtime";
import { stopAllDesignServers } from "./engine/engine-manager";
import { SHARE_EXTENSION, SHARE_PREVIEW_EXTENSIONS } from "./export/share-format";
import { ExportMockupDialog } from "./mockup/ExportMockupDialog";
import { GalleryView } from "./gallery/GalleryView";
import { claimCanvasReveal } from "./gallery/open-project";
import { setPluginCtx } from "./plugin-context";
import { VetdPreview } from "./preview/VetdPreview";
import { CANVAS_TAB_ID, GALLERY_VIEW_ID } from "./tab-ids";
import { registerDesignTools } from "./tools";
import { claimCanvasAutoOpen } from "./vetd/auto-open";
import { isPureDesignProject, pickDesignPaths } from "./vetd/discover";

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

function VetdFileIcon() {
	return <img src={vetdIconUrl} alt="" className="h-3.5 w-3.5 object-contain" draggable={false} />;
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

		/**
		 * 设计画布是「工作」模式的能力（ADR-0046）。编程模式下把画布 Tab、导出用的
		 * 全局插槽、截图消息卡一起摘掉；tools 与 skill 各自声明 agent_mode 由宿主过滤。
		 * 唯一跨模式保留的是 .vetd 文件预览——编程模式里仍可能点开一份设计稿看看。
		 *
		 * 不用清单里的插件级 agent_mode：那是硬闸，会连预览带 bundle 一起藏掉。
		 */
		let workModeSlots: Disposable[] = [];
		const isWorkMode = (): boolean => ctx.getAgentMode() === "work";

		/** 最近一次 conversation-changed 的 cwd 与会话 id，用于丢弃过期的探测结果。 */
		let latestCwd: string | null = null;
		let latestSessionId: string | null = null;

		/**
		 * cwd 里有 .vetd 才把画布 Tab 上栏。切回工作模式时也要重跑一次。
		 *
		 * 纯设计项目（除设计稿和 README 之类外没有别的文件）额外自动展开画布：
		 * 这种目录打开就是为了看设计，先给面板。混合项目不抢；每次打开（切入）
		 * 会话都展开一次，同一会话内关掉后不再反复弹。
		 */
		const revealTabForCwd = (cwd: string | null, sessionId: string | null): void => {
			if (!cwd || !isWorkMode()) return;
			void ctx.fs
				.listFilesRecursive(cwd)
				.catch(() => [])
				.then((files) => {
					if (latestCwd !== cwd || latestSessionId !== sessionId || !isWorkMode()) return;
					// 还没迁移的旧格式也算数：Tab 先亮出来，真正的迁移在画布打开时发生。
					const { bundles, legacyFiles } = pickDesignPaths(files);
					const found = bundles.length + legacyFiles.length;
					ctx.ui.setActivityTabVisible(CANVAS_TAB_ID, found > 0);
					if (found === 0) return;
					// 从画廊点进来的这一次，用户已经说清楚要看设计了：混合项目也铺开，
					// 且不受「同一会话只弹一次」的去重影响（那是给自动判断兜底的）。
					if (claimCanvasReveal(cwd)) {
						ctx.ui.openActivityTab(CANVAS_TAB_ID, { width: "max" });
						return;
					}
					if (!isPureDesignProject(files)) return;
					if (!claimCanvasAutoOpen(sessionId)) return;
					ctx.ui.openActivityTab(CANVAS_TAB_ID, { width: "max" });
				});
		};

		const syncWorkModeSlots = (mode: AgentMode): void => {
			const wanted = mode === "work";
			if (wanted === workModeSlots.length > 0) return;
			if (wanted) {
				workModeSlots = [
					ctx.ui.registerActivityTab({
						id: CANVAS_TAB_ID,
						label: "%tab.label%",
						// 与 plugin.json#icon 同源（icon.png），活动栏与插件列表品牌一致。
						icon: <VetdFileIcon />,
						component: CanvasTab,
						scope_use: ["project", "conversation"],
						// 出现条件由插件驱动：cwd 里有 .vetd 才上栏；vetd_create / 预览「打开画布」也会拉起。
						initiallyVisible: false,
					}),
					// 导出渲染图的 dialog 走全局插槽：设计画布在活动面板里太窄，
					// 判断圆角/边框需要整窗口的预览面积。
					ctx.ui.registerGlobalSlot({ id: "export-mockup-dialog", component: ExportMockupDialog }),
					ctx.ui.registerCardRenderer({
						type: SCREENSHOT_CARD_TYPE,
						component: ScreenshotCard,
						title: "%card.screenshot.title%",
						icon: <ScreenshotIcon />,
						pendingFor: pendingScreenshotCard,
					}),
					// 设计体系选择卡（vetd_design_systems 的 present 用法）：候选预览 + 点选回灌。
					ctx.ui.registerCardRenderer({
						type: DESIGN_SYSTEM_CARD_TYPE,
						component: DesignSystemPickerCard,
						title: "%card.designSystems.title%",
						icon: <DesignIcon />,
					}),
					// 画廊：跨项目的设计注册中心，整页 surface + 侧边栏入口。与画布标签卡
					// 同属工作模式能力（ADR-0046），所以跟着这批插槽一起装卸。
					ctx.ui.registerWorkspaceView({
						id: GALLERY_VIEW_ID,
						label: "%gallery.nav.label%",
						icon: "icon-[solar--ruler-pen-linear]",
						description: "%gallery.nav.description%",
						component: GalleryView,
					}),
				];
				// 注册只是入池：切回工作模式时补跑一次探测，否则要等下次切会话才上栏。
				revealTabForCwd(latestCwd, latestSessionId);
				return;
			}
			for (const slot of workModeSlots) slot.dispose();
			workModeSlots = [];
			// Tab 卸载时 CanvasTab 自己会停引擎，但模式切走属于「这个插件不该再有存在感」，
			// 兜底收干净：别在编程模式里留一个 vite dev server 跑着。
			requestMockupExport(null);
			void stopAllDesignServers();
		};

		syncWorkModeSlots(ctx.getAgentMode());
		ctx.onAgentModeChanged(syncWorkModeSlots);

		ctx.conversation.on((event) => {
			if (event.type === "conversation-changed") {
				const { cwd, id } = event.conversation;
				if (!cwd) return;
				// 编程模式下也记住 cwd：切回工作模式时要靠它补跑探测。
				latestCwd = cwd;
				latestSessionId = id;
				revealTabForCwd(cwd, id);
				return;
			}
			if (event.type === "tool-call-start") {
				notifyAgentToolStart(event.toolCallId, event.toolName, event.args);
				return;
			}
			if (event.type === "tool-call-end") {
				notifyAgentToolEnd(event.toolCallId, event.isError);
				return;
			}
			if (event.type === "turn-end") {
				notifyFrameSettled(null);
			}
		});

		// 跨模式唯一保留的能力：编程模式里也可能点开一份设计看看。分享包（`.vetdz`，
		// 以及历史导出的 `.vetd` zip）是文件，走预览；设计本体是目录，走右键打开画布。
		ctx.ui.registerFilePreview({ extensions: [...SHARE_PREVIEW_EXTENSIONS], component: VetdPreview });
		ctx.fileExplorer.registerDecorationProvider({
			id: "vetd-file-icon",
			priority: 100,
			when: { extensions: ["vetd", SHARE_EXTENSION] },
			provideDecoration: () => ({ icon: <VetdFileIcon /> }),
		});
		ctx.fileExplorer.registerContextMenuAction({
			id: "vetd-open-canvas",
			label: "%fileExplorer.openCanvas%",
			icon: <DesignIcon />,
			when: { resourceType: "directory", extensions: ["vetd"] },
			run: ({ entry }) => {
				setPendingDesignPath(entry.path);
				ctx.ui.setActivityTabVisible(CANVAS_TAB_ID, true);
				ctx.ui.openActivityTab(CANVAS_TAB_ID, { width: "max" });
			},
		});

		registerDesignTools(ctx);
	},
	deactivate() {
		void stopAllDesignServers();
	},
});
