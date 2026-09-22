import { type RefObject, useEffect, useState } from "react";

/**
 * 面板 width 过渡是 0.2s（见 theme-ui ActivityPanelDesktop）；过渡被跳过或
 * 元素不在（窄屏抽屉）时 transitionend 不会来，用这个兜底让内容一定挂上。
 */
export const DOCKED_CONTENT_FALLBACK_MS = 260;

/**
 * 停靠内容是否可以挂载：面板已打开且滑出过渡已结束。
 *
 * 首次渲染就处于打开态时没有过渡可等，直接就绪；关闭时立刻回到未就绪，
 * 下次打开重新等一遍。
 */
export function useDockedContentReady(isOpen: boolean, panelRef: RefObject<HTMLElement | null>): boolean {
	const [ready, setReady] = useState(isOpen);
	useEffect(() => {
		if (!isOpen) {
			setReady(false);
			return;
		}
		if (ready) return;
		const panel = panelRef.current;
		const settle = (): void => setReady(true);
		const onTransitionEnd = (event: TransitionEvent): void => {
			if (event.target === panel && event.propertyName === "width") settle();
		};
		panel?.addEventListener("transitionend", onTransitionEnd);
		const timer = window.setTimeout(settle, DOCKED_CONTENT_FALLBACK_MS);
		return () => {
			panel?.removeEventListener("transitionend", onTransitionEnd);
			window.clearTimeout(timer);
		};
	}, [isOpen, ready, panelRef]);
	return isOpen && ready;
}
