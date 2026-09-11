/**
 * 「用户选了哪套风格，等这一轮发送后落盘」。
 *
 * 挑风格时只挂附件不写文件：挑挑拣拣是常态，没发就落盘会在项目里留下一堆没用上的参考
 * 资料。真正的落盘挂在 `turn-start` 上——那是宿主唯一会广播「用户确实发出去了」的时刻。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import type { DesignSystem } from "../design-systems/types";
import { installSystemResources } from "../gallery/start-from-system";

let pending: DesignSystem | null = null;

export function rememberPickedSystem(system: DesignSystem): void {
	pending = system;
}

/**
 * 订阅会话事件：一轮开始就把待落盘的风格资料写进当前工作目录。
 *
 * 只认有 cwd 的会话——没有工作目录就没有「当前项目」，资料无处可落，这时静默跳过并把
 * 待办清掉，免得它跟着用户漂到下一个会话里。
 */
export function watchPickedSystem(ctx: PluginContext): void {
	let cwd: string | null = null;
	ctx.conversation.on((event) => {
		if (event.type === "conversation-changed") {
			cwd = event.conversation?.cwd ?? null;
			return;
		}
		if (event.type !== "turn-start") return;
		const system = pending;
		pending = null;
		if (!system || !cwd) return;
		void installSystemResources(system, cwd).catch(() => {
			// 参考资料没落下来不该打断这一轮对话：用户要的是设计，不是这堆文件。
		});
	});
}
