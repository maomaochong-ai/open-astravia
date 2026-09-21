/**
 * 终端渲染器选择。
 *
 * WebGL 最快，但浏览器同时能持有的 WebGL 上下文只有十几个，多开几个终端就会互相踢掉
 * （被踢的那个直接黑屏）。所以只有**当前活动格**用 WebGL，其它格退到 canvas；
 * 关掉硬件加速或拿不到 webgl2 时全部退到 canvas。
 */
export type TerminalRendererKind = "webgl" | "canvas";

export interface SelectTerminalRendererInput {
	readonly hasWebgl2: boolean;
	readonly hardwareAccelerated: boolean;
	readonly isActiveLeaf: boolean;
	/** WebGL 上下文丢失过一次就不再重试：多半是驱动问题，重试只会再黑一次。 */
	readonly contextLost?: boolean;
}

export function selectTerminalRenderer(input: SelectTerminalRendererInput): TerminalRendererKind {
	if (input.contextLost) return "canvas";
	if (!input.hasWebgl2 || !input.hardwareAccelerated) return "canvas";
	return input.isActiveLeaf ? "webgl" : "canvas";
}

export function detectWebgl2Support(create: () => HTMLCanvasElement = () => document.createElement("canvas")): boolean {
	try {
		return create().getContext("webgl2") !== null;
	} catch {
		return false;
	}
}
