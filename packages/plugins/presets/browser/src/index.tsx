import { definePlugin } from "@astravia-org/plugin-sdk";
import type { JSX } from "react";
import { BrowserConsole, type BrowserConsolePorts } from "./components/BrowserConsole";
import { BrowserRuntimeController } from "./runtime/runtime-controller";
import "./style.css";

/**
 * 浏览器操作：安装 vercel-labs/agent-browser，并向 Agent 提供按需 CLI Skill。
 *
 * Agent 直接调用 upstream CLI，使用宿主注入的 ASTRAVIA_AGENT_SESSION_ID；
 * 插件面板通过 ctx.browser API 读写运行时状态。两条调用面不共享活跃 session。
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
		if (!ctx.browser) throw new Error("Browser Foundation Capability is unavailable");

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
			// 不声明 icon：宿主回落到 plugin.json 里打包的彩色品牌 icon.png。
			iconTint: false,
			// 面板是安装/说明页，装完不常回来——不占侧边栏，从设置 → 更多选项进。
			sidebar: false,
			component: function BrowserWorkspaceView(): JSX.Element {
				return <BrowserConsole ports={ports} />;
			},
		});

		// 预热：用户点开时应该直接看到「已就绪」或「去安装」，而不是先闪一个检测中。
		void runtime.refresh();
	},
	async deactivate() {
		await controller?.dispose();
		controller = null;
	},
});
