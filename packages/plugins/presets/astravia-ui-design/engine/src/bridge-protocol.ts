/**
 * 宿主与设计引擎之间 iframe 消息的唯一信封定义。
 *
 * 两个方向都要求 `{ astraviaDesign: true }`。这个键名曾经在一次批量品牌化改写里
 * 被替换成 `data.astravia-design`（即 `data.astravia - design`），三个接收点于是
 * 每来一条消息就抛一次 ReferenceError 并把它整条丢弃：ready / rendered / captured
 * 全收不到，截图 8 秒超时、缩略图空白、预览切帧无反应，画面本身却照常渲染，极难
 * 从表象反推。键名现在只在这里出现一次，收发两端都从这里取。
 */
export const BRIDGE_MARKER = "astraviaDesign" as const;

/** 带信封标记的消息；收发两端共用的载荷类型。 */
export type BridgeMessage = Record<string, unknown> & { readonly [BRIDGE_MARKER]: true };

/** 判定一条 `MessageEvent.data` 是不是本协议的消息。 */
export function isBridgeMessage(data: unknown): data is Record<string, unknown> {
	return typeof data === "object" && data !== null && (data as Record<string, unknown>)[BRIDGE_MARKER] === true;
}

/** 给载荷套上信封标记，之后再 postMessage。 */
export function withBridgeMarker<T extends Record<string, unknown>>(message: T): BridgeMessage & T {
	return { [BRIDGE_MARKER]: true, ...message } as BridgeMessage & T;
}
