import { type CardDescriptor, definePlugin, type PluginPendingToolCall } from "@vetta-org/plugin-sdk";
import "./style.css";
import { ScreenshotCard } from "./cards/ScreenshotCard";
import { SCREENSHOT_CARD_TYPE, SCREENSHOT_TOOL_NAME, screenshotCardDescriptor } from "./cards/screenshot-card";
import { CanvasTab } from "./canvas/CanvasTab";
import {
	getCanvasController,
	notifyAgentToolArgs,
	notifyAgentToolEnd,
	notifyAgentToolStart,
	notifyFrameSettled,
	setPendingDesignPath,
} from "./canvas/design-runtime";
import { refreshDesignCatalog } from "./design-systems/index";
import { stopAllDesignServers } from "./engine/engine-manager";
import { SHARE_EXTENSION, SHARE_PREVIEW_EXTENSIONS } from "./export/share-format";
import { ExportMockupDialog } from "./mockup/ExportMockupDialog";
import { GalleryView } from "./gallery/GalleryView";
import { claimCanvasReveal } from "./gallery/open-project";
import { registerTurnHistory } from "./history/turn-history";
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

function VetdFileIcon({ src }: { src: string }) {
	return <img src={src} alt="" className="h-3.5 w-3.5 object-contain" draggable={false} />;
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
		// 设计体系清单：先用打包内置那份渲染，随后静默换成缓存/远端的最新版本。
		// 拉不到就一直用内置的，用户不感知「源」，所以这里不等待、不报错。
		void refreshDesignCatalog(ctx);
		// 品牌图由宿主从 plugin.json#icon 解析后注入；插件不拼宿主协议、不 import 包内 png。
		const packageIcon = ctx.plugin.iconUrl ? <VetdFileIcon src={ctx.plugin.iconUrl} /> : undefined;

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
			if (!cwd) return;
			void ctx.fs
				.listFilesRecursive(cwd)
				.catch(() => [])
				.then((files) => {
					if (latestCwd !== cwd || latestSessionId !== sessionId) return;
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

		/**
		 * 这批 UI 一律常驻，不按工作模式装卸（见 ADR-0046 修订：模式只做提示词软引导，
		 * 系统里不再有任何模式硬闸）。是否露出由「cwd 里有没有 .vetd」决定——那本来
		 * 就是比模式更准的条件：在代码仓库里写着写着要看设计稿，画布就该在。
		 */
		ctx.ui.registerActivityTab({
			id: CANVAS_TAB_ID,
			label: "%tab.label%",
			// icon 省略：宿主用 plugin.json#icon → ctx.plugin.iconUrl 填品牌图。
			component: CanvasTab,
			scope_use: ["project", "conversation"],
			// 出现条件由插件驱动：cwd 里有 .vetd 才上栏；vetd_create / 预览「打开画布」也会拉起。
			initiallyVisible: false,
		});
		// 导出渲染图的 dialog 走全局插槽：设计画布在活动面板里太窄，
		// 判断圆角/边框需要整窗口的预览面积。
		ctx.ui.registerGlobalSlot({ id: "export-mockup-dialog", component: ExportMockupDialog });
		ctx.ui.registerCardRenderer({
			type: SCREENSHOT_CARD_TYPE,
			component: ScreenshotCard,
			title: "%card.screenshot.title%",
			icon: <ScreenshotIcon />,
			pendingFor: pendingScreenshotCard,
		});
		// 画廊：跨项目的设计注册中心，整页 surface + 侧边栏入口。
		ctx.ui.registerWorkspaceView({
			id: GALLERY_VIEW_ID,
			label: "%gallery.nav.label%",
			icon: "icon-[solar--ruler-pen-linear]",
			description: "%gallery.nav.description%",
			component: GalleryView,
		});
		// 设计版本历史的自动提交（ADR-0069）。commitTurn 只遍历 cwd 下真实存在的
		// .vetd 目录，纯代码仓库里是空操作，所以无条件注册不会产生噪音提交。
		registerTurnHistory(ctx);

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
			// 生成阶段就点亮：edit/write 的时间几乎全花在生成参数上，等到执行事件
			// 才亮的话，浮层是在活干完之后才出现的。
			if (event.type === "tool-call-args") {
				notifyAgentToolArgs(event.toolCallId, event.toolName, event.args);
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
		if (packageIcon) {
			ctx.fileExplorer.registerDecorationProvider({
				id: "vetd-file-icon",
				priority: 100,
				when: { extensions: ["vetd", SHARE_EXTENSION] },
				provideDecoration: () => ({ icon: packageIcon }),
			});
		}
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
