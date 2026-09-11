/**
 * 「用户选了哪套风格，等这一轮发送后落盘」。
 *
 * 挑风格时只挂附件不写文件：挑挑拣拣是常态，没发就落盘会在项目里留下一堆没用上的参考
 * 资料。真正的落盘要等两个条件同时成立：用户确实发出去了（`turn-start`），以及知道往哪
 * 落（会话的 cwd）。
 *
 * 两个条件谁先到都有可能，所以不写成「turn-start 时读 cwd」：团队会话是先发送、再创建
 * 会话、最后才有工作目录，按那种写法发出去的第一轮永远落不了盘。这里改成两边各自记账，
 * 齐了就落。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import type { DesignSystem } from "../design-systems/types";
import { installSystemResources } from "../gallery/start-from-system";

let pending: DesignSystem | null = null;
/** 用户已经把这一轮发出去了；在此之前 cwd 再明确也不落盘。 */
let armed = false;
let cwd: string | null = null;

export function rememberPickedSystem(system: DesignSystem): void {
	pending = system;
	// 换一套风格重新计时：上一轮的发送不该把这一套顺手带下去。
	armed = false;
}

function installWhenReady(): void {
	if (!pending || !armed || !cwd) return;
	const system = pending;
	pending = null;
	armed = false;
	void installSystemResources(system, cwd).catch(() => {
		// 参考资料没落下来不该打断这一轮对话：用户要的是设计，不是这堆文件。
	});
}

/**
 * 订阅会话事件：发送过、且知道工作目录，就把风格资料写进去。
 *
 * 没有工作目录的会话不会落盘，但待办留着——团队会话的工作目录要等会话建出来才知道，
 * 这时丢掉就等于永远不落。
 */
export function watchPickedSystem(ctx: PluginContext): void {
	ctx.conversation.on((event) => {
		if (event.type === "conversation-changed") {
			cwd = event.conversation?.cwd ?? null;
			installWhenReady();
			return;
		}
		if (event.type !== "turn-start") return;
		armed = true;
		installWhenReady();
	});
}
