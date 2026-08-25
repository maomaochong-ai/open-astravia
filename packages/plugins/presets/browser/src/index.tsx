import { definePlugin } from "@vetta-org/plugin-sdk";
import type { JSX } from "react";
import { BrowserConsole, type BrowserConsolePorts } from "./components/BrowserConsole";
import { syncSettingsSnapshot } from "./config/store";
import { BrowserRuntimeController } from "./runtime/runtime-controller";
import "./style.css";

/**
 * 浏览器操作：把 vercel-labs/agent-browser 内聚成一个系统插件。
 *
 * 能力面走 Skill + CLI（`agent.skillPaths` → `agent/skills/browser-use`），模型经由 bash 调用
 * 插件自带的 shim；域名白名单、危险动作与浏览器来源都由 shim 在自己的 argv 上判定。
 * 本文件只负责两件宿主侧的事：把设置物化成 shim 能读到的策略快照、注册工作区视图。
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
