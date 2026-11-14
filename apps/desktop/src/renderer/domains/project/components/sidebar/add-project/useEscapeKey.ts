import { useEffect, useRef } from "react";

/** 按 Esc 时调用 handler。输入法组合中的 Esc 是取消候选词，不算。 */
export function useEscapeKey(handler: () => void): void {
	const handlerRef = useRef(handler);
	handlerRef.current = handler;
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== "Escape" || event.isComposing) return;
			handlerRef.current();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);
}
