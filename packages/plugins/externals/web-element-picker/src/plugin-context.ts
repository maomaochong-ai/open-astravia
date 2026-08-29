import type { PluginContext } from "@astravia-org/plugin-sdk";

// activate 时持有 ctx，供面板组件调用 conversation / storage API
// （活动 tab 组件零 props，ctx 只在 activate 入参出现）。
let pluginCtx: PluginContext | null = null;

export function setPluginCtx(ctx: PluginContext): void {
	pluginCtx = ctx;
}

export function getPluginCtx(): PluginContext | null {
	return pluginCtx;
}

// ─── 输入栏 toggle 意图通道 ───
// 输入栏 Action 与活动 Tab 面板是同一 MF 模块实例的不同插槽，用模块级状态传递意图：
// 面板未挂载时暂存，挂载/激活时消费；面板已挂载时直接派发。
export type PickerIntent = "start-select" | "stop-select";

let pendingIntent: PickerIntent | null = null;
let intentListener: ((intent: PickerIntent) => void) | null = null;

export function pushPickerIntent(intent: PickerIntent): void {
	if (intentListener) {
		intentListener(intent);
	} else {
		pendingIntent = intent;
	}
}

/** 面板挂载时消费暂存的意图（一次性）。 */
export function consumePickerIntent(): PickerIntent | null {
	const intent = pendingIntent;
	pendingIntent = null;
	return intent;
}

/** 面板运行中订阅新意图。返回取消订阅函数。 */
export function onPickerIntent(listener: (intent: PickerIntent) => void): () => void {
	intentListener = listener;
	return () => {
		if (intentListener === listener) intentListener = null;
	};
}
