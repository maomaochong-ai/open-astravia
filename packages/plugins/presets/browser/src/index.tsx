import { definePlugin } from "@vetta-org/plugin-sdk";
import type { JSX } from "react";
import { BrowserConsole, type BrowserConsolePorts } from "./components/BrowserConsole";
import { parseAllowedDomains } from "./config/settings";
import { readSettings, syncSettingsSnapshot } from "./config/store";
import { registerBrowserGuard } from "./guard/register";
import { BrowserRuntimeController } from "./runtime/runtime-controller";
import "./style.css";

/**
 * 浏览器操作：把 vercel-labs/agent-browser 内聚成一个系统插件。
 *
 * 工具面走清单式 MCP（`agent.mcpServers` → `scripts/start-browser-mcp.mjs`），本文件只负责
 * 三件宿主侧的事：物化设置快照、注册工作区视图、装上危险动作的 PreToolUse 门禁。
 */

const VIEW_ID = "console";

/**
 * 模块级持有跨激活的资源。`deactivate()` 拿不到 ctx，而 controller 持有轮询中的子进程
 * 句柄与订阅集合，不显式释放会在热重载后叠加。
 */
let controller: BrowserRuntimeController | null = null;
let disposeSettingsSync: (() => void) | null = null;

export default definePlugin({
	activate(ctx) {
		disposeSettingsSync?.();
		void controller?.dispose();

		const runtime = new BrowserRuntimeController({
			command: ctx.command,
			wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		});
		controller = runtime;

		disposeSettingsSync = syncSettingsSnapshot(ctx);
		registerBrowserGuard(ctx, () => {
			const settings = readSettings(ctx);
			return {
				allowedDomains: parseAllowedDomains(settings.allowedDomains),
				denyEval: settings.denyEval,
				denyDownload: settings.denyDownload,
				denyUpload: settings.denyUpload,
			};
		});

		const ports: BrowserConsolePorts = {
			runtime,
			openExternal: (url) => {
				void ctx.ui.openExternal(url).catch((error: unknown) => {
					ctx.ui.notify({ message: "打开链接失败", error, variant: "error" });
				});
			},
		};
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
	},
});
