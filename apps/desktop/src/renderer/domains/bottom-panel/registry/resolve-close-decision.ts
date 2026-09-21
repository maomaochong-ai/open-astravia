import type { BottomPanelCloseConfirm, BottomPanelCloseReason, BottomPanelWillClose } from "./types";

/** 贡献方超过这个时间还没给出裁决就按「需要确认」处理。 */
export const CLOSE_GUARD_TIMEOUT_MS = 3000;

export type CloseOutcome =
	| { readonly kind: "close" }
	| { readonly kind: "cancel" }
	| { readonly kind: "confirm"; readonly confirm: BottomPanelCloseConfirm };

export interface ResolveCloseDecisionInput {
	readonly guard: BottomPanelWillClose | undefined;
	readonly tabId: string;
	readonly reason: BottomPanelCloseReason;
	/** 超时/异常时使用的通用确认文案。 */
	readonly fallbackConfirm: BottomPanelCloseConfirm;
	readonly timeoutMs?: number;
	readonly delay?: (ms: number) => Promise<void>;
}

/**
 * 切会话与退出应用时**跳过**确认：那两条路径上挂一个能阻塞的对话框，
 * 会把用户卡在退不出去的状态里。钩子仍会被调用，让贡献方有机会收尾。
 */
function skipsConfirm(reason: BottomPanelCloseReason): boolean {
	return reason === "session-switch" || reason === "app-quit";
}

function defaultDelay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

export async function resolveCloseDecision({
	guard,
	tabId,
	reason,
	fallbackConfirm,
	timeoutMs = CLOSE_GUARD_TIMEOUT_MS,
	delay = defaultDelay,
}: ResolveCloseDecisionInput): Promise<CloseOutcome> {
	if (!guard) return { kind: "close" };

	const TIMED_OUT = "vetta:close-guard-timeout" as const;
	let decision: Awaited<ReturnType<BottomPanelWillClose>> | typeof TIMED_OUT;
	try {
		decision = await Promise.race<Awaited<ReturnType<BottomPanelWillClose>> | typeof TIMED_OUT>([
			Promise.resolve(guard({ tabId, reason })),
			delay(timeoutMs).then(() => TIMED_OUT),
		]);
	} catch {
		// 钩子自己抛了：同样按需要确认处理，不静默关掉。
		return skipsConfirm(reason) ? { kind: "close" } : { kind: "confirm", confirm: fallbackConfirm };
	}

	if (skipsConfirm(reason)) return { kind: "close" };
	if (decision === TIMED_OUT) return { kind: "confirm", confirm: fallbackConfirm };
	if (decision === true) return { kind: "close" };
	if (decision === false) return { kind: "cancel" };
	return { kind: "confirm", confirm: decision };
}
