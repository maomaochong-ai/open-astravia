// uiohook 宿主 worker 线程 ↔ 主线程的消息合同。
// worker（uiohook-worker.ts）经 parentPort 单向上报；主线程不下发控制消息，
// 生命周期通过 spawn/terminate 管理（见 uiohook-supervisor.ts）。

export type UiohookHostMessage =
	| { type: "started" }
	| { type: "start-failed"; message: string }
	| { type: "keydown"; keycode: number }
	| { type: "keyup"; keycode: number };

/** 线程边界收窄：只放行结构合法的宿主消息，其余丢弃。 */
export function isUiohookHostMessage(value: unknown): value is UiohookHostMessage {
	if (typeof value !== "object" || value === null) return false;
	const message = value as Record<string, unknown>;
	switch (message.type) {
		case "started":
			return true;
		case "start-failed":
			return typeof message.message === "string";
		case "keydown":
		case "keyup":
			return typeof message.keycode === "number";
		default:
			return false;
	}
}
