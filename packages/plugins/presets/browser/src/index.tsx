import { definePlugin } from "@vetta-org/plugin-sdk";
import type { JSX } from "react";
import { BrowserConsole, type BrowserConsolePorts } from "./components/BrowserConsole";
import { BrowserRuntimeController } from "./runtime/runtime-controller";
import "./style.css";

/**
 * 浏览器操作：安装 vercel-labs/agent-browser，并向 Agent 提供按需 CLI Skill。
 *
 * Agent 直接调用 upstream CLI，使用自己的 session；插件代码仍可通过 ctx.browser API 使用
 * 宿主浏览器能力，两条调用面不共享活跃 session。
 */

const VIEW_ID = "console";

/**
 * 模块级持有跨激活的资源。`deactivate()` 拿不到 ctx，而 controller 持有轮询中的子进程
 * 句柄与订阅集合，不显式释放会在热重载后叠加。
 */
let controller: BrowserRuntimeController | null = null;

export default definePlugin({
	activate(ctx) {
		void controller?.dispose();
		if (!ctx.browser) throw new Error("Browser capability is unavailable");

		const runtime = new BrowserRuntimeController({
			browser: ctx.browser,
		});
		controller = runtime;

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
		await controller?.dispose();
		controller = null;
	},
});
