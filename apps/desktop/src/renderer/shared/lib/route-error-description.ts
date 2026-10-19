/**
 * 把 React 抛出的错误归类成人能读懂的一类。
 *
 * 生产构建里 React 只留 `Minified React error #185; visit ...` 这样的编号，用户看不懂，我们
 * 也拿不到更多上下文；唯一能确定的是「哪一类失败」。按类给出不同的处置建议（#185 重试无效、
 * 必须重新加载窗口）比把原始编号当主文案有用得多。
 */
export type RouteErrorKind = "updateDepth" | "hooksOrder" | "unknown";

export interface RouteErrorDescription {
	readonly kind: RouteErrorKind;
	/** React 压缩版错误编号；不是 React 错误时为 null。 */
	readonly code: number | null;
}

const REACT_MINIFIED_CODE = /Minified React error #(\d+)/;

/** React #310：Rendered more/fewer hooks than expected，通常来自条件分支里的 Hooks。 */
const HOOKS_ORDER_CODE = 310;

export function describeRouteError(message: string): RouteErrorDescription {
	const matched = REACT_MINIFIED_CODE.exec(message);
	if (!matched) return { code: null, kind: "unknown" };
	const code = Number(matched[1]);
	if (code === 185) return { code, kind: "updateDepth" };
	if (code === HOOKS_ORDER_CODE) return { code, kind: "hooksOrder" };
	return { code, kind: "unknown" };
}
