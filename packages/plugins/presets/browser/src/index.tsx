import { definePlugin } from "@vetta-org/plugin-sdk";
import type { JSX } from "react";
import { BrowserSessionBroker } from "./agent/browser-session-broker";
import { registerBrowserTool } from "./agent/browser-tool";
import { BrowserConsole, type BrowserConsolePorts } from "./components/BrowserConsole";
import { BrowserRuntimeController } from "./runtime/runtime-controller";
import "./style.css";

/**
 * 浏览器操作：把 vercel-labs/agent-browser 内聚成一个系统插件。
 *
 * Skill 负责低上下文的使用指导，结构化工具负责调用宿主浏览器能力。插件不执行外部命令，
 * profile、进程、策略和审计统一由 Desktop 主进程拥有。
 */

const VIEW_ID = "console";

/**
 * 模块级持有跨激活的资源。`deactivate()` 拿不到 ctx，而 controller 持有轮询中的子进程
 * 句柄与订阅集合，不显式释放会在热重载后叠加。
 */
let controller: BrowserRuntimeController | null = null;
let broker: BrowserSessionBroker | null = null;

export default definePlugin({
	activate(ctx) {
		void controller?.dispose();
		void broker?.closeAll();
		if (!ctx.browser) throw new Error("Browser capability is unavailable");

		const runtime = new BrowserRuntimeController({
			browser: ctx.browser,
		});
		controller = runtime;
		const sessions = new BrowserSessionBroker(ctx.browser);
		broker = sessions;
		registerBrowserTool(ctx, sessions);

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
	async deactivate() {
		await broker?.closeAll();
		broker = null;
		await controller?.dispose();
		controller = null;
	},
});
