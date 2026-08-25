import { definePlugin, type PluginContext } from "@vetta-org/plugin-sdk";
import type { JSX } from "react";
import { BrowserActivityLog } from "./activity/log";
import { BrowserConsole, type BrowserConsolePorts } from "./components/BrowserConsole";
import { readSettings, syncSettingsSnapshot } from "./config/store";
import { parseAllowedDomains } from "./config/settings";
import { registerBrowserGuard } from "./guard/register";
import { activateTab, clearSignInState, deleteCredential, listCredentials, listSessions, listTabs } from "./runtime/cli";
import { BrowserRuntimeController } from "./runtime/runtime-controller";
import "./style.css";

/**
 * 浏览器操作：把 vercel-labs/agent-browser 内聚成一个系统插件。
 *
 * 工具面走清单式 MCP（`agent.mcpServers` → `scripts/start-browser-mcp.mjs`），本文件只负责
 * 三件宿主侧的事：物化设置快照、注册控制台工作区视图、装上危险动作的 PreToolUse 门禁。
 */

const VIEW_ID = "console";

/**
 * 模块级持有跨激活的资源。`deactivate()` 拿不到 ctx，而这些对象各自持有轮询中的子进程
 * 句柄或订阅集合，不显式释放会在热重载后叠加。
 */
let controller: BrowserRuntimeController | null = null;
let activity: BrowserActivityLog | null = null;
let disposeSettingsSync: (() => void) | null = null;

function createPorts(ctx: PluginContext, runtime: BrowserRuntimeController, log: BrowserActivityLog): BrowserConsolePorts {
	return {
		runtime,
		activity: log,
		readSettings: () => readSettings(ctx),
		onSettingsChange: (listener) => {
			const subscription = ctx.settings.onChange(() => listener(readSettings(ctx)));
			return () => subscription.dispose();
		},
		loadSessions: async () => {
			const sessionResult = await listSessions(ctx.command);
			if (!sessionResult.ok) return { sessions: [], error: sessionResult.error };
			const sessions = await Promise.all(
				sessionResult.value.map(async (session) => ({
					session,
					tabs: (await listTabs(ctx.command, session.id)).value,
				})),
			);
			return { sessions };
		},
		loadCredentials: async () => {
			const result = await listCredentials(ctx.command);
			return { credentials: result.value, error: result.ok ? undefined : result.error };
		},
		deleteCredential: async (name) => {
			const result = await deleteCredential(ctx.command, name);
			if (!result.ok) ctx.ui.notify({ message: `删除凭据失败：${result.error ?? ""}`, variant: "error" });
		},
		activateTab: async (sessionId, ref) => {
			const result = await activateTab(ctx.command, sessionId, ref);
			if (!result.ok) ctx.ui.notify({ message: `切换标签页失败：${result.error ?? ""}`, variant: "error" });
		},
		clearSignInState: async (sessionId) => {
			const result = await clearSignInState(ctx.command, sessionId);
			ctx.ui.notify(
				result.ok
					? { message: "已清除该浏览器的 Cookie 与本地存储", variant: "success" }
					: { message: `清除登录状态失败：${result.error ?? ""}`, variant: "error" },
			);
		},
	};
}

export default definePlugin({
	activate(ctx) {
		disposeSettingsSync?.();
		void controller?.dispose();
		activity?.dispose();

		const runtime = new BrowserRuntimeController({
			command: ctx.command,
			wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		});
		const log = new BrowserActivityLog();
		controller = runtime;
		activity = log;

		disposeSettingsSync = syncSettingsSnapshot(ctx);
		registerBrowserGuard(ctx, log, () => {
			const settings = readSettings(ctx);
			return {
				allowedDomains: parseAllowedDomains(settings.allowedDomains),
				denyEval: settings.denyEval,
				denyDownload: settings.denyDownload,
				denyUpload: settings.denyUpload,
			};
		});

		const ports = createPorts(ctx, runtime, log);
		ctx.ui.registerWorkspaceView({
			id: VIEW_ID,
			label: "%view.console.label%",
			description: "%view.console.description%",
			// 不声明 icon：宿主会回落到 plugin.json 里打包的 icon.png。
			// iconTint: false 保留原色——这是一枚彩色品牌图标，被主题前景色蒙版成
			// 单色剪影就只剩一个圆形，认不出来了。橙紫配色在深浅两种侧边栏上都够亮。
			iconTint: false,
			component: function BrowserWorkspaceView(): JSX.Element {
				return <BrowserConsole ports={ports} />;
			},
		});

		// 预热：用户点开侧边栏时应该直接看到「已就绪」或「去安装」，而不是先闪一个检测中。
		void runtime.refresh();
	},
	deactivate() {
		disposeSettingsSync?.();
		disposeSettingsSync = null;
		void controller?.dispose();
		controller = null;
		activity?.dispose();
		activity = null;
	},
});
