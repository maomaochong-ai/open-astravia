import { sseClientAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useEffect } from "react";

/**
 * 监听指定 SSE 事件类型，当收到事件时调用 handler。
 * handler 变更时自动重新注册。
 */
export function useSSEEvent(eventType: string, handler: (data: unknown) => void): void {
	const sseClient = useAtomValue(sseClientAtom);

	useEffect(() => {
		return sseClient.on(eventType, handler);
	}, [sseClient, eventType, handler]);
}
