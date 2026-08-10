import { appendError, nextId } from "@domains/chat/services/chat-service";
import { rememberOptimisticUserMessage } from "@domains/chat/services/optimistic-user-message-cache";
import { waitForPluginHostReady } from "@domains/plugins/runtime/plugin-events";
import { activeSessionAtom, type ChatMessage, chatMessagesAtom } from "@shared/store/atoms";
import { bumpQueuedDispatchSeq, dequeueHeadAtom } from "@shared/store/message-queue-atoms";
import { getDefaultStore } from "jotai";
import { useEffect } from "react";

/**
 * App 级全局消息队列调度器。挂在永不卸载的 App 上，订阅跨会话的 running-changed
 * 广播：当某个会话（active 或后台）自然结束（reason === "agent_end"）时，弹出该会话
 * 队首一条排队消息作为新一轮 prompt。aborted / error 不出队、保留队列。
 *
 * 仅 active 会话补乐观 user 气泡，避免污染当前视图。后台会话只发 prompt，待用户
 * 切回时由历史回放呈现。
 */
export function useMessageQueueDispatcher(): void {
	useEffect(() => {
		const unsubscribe = window.vetta.session.onRunningChanged((payload) => {
			const { running, sessionId, reason } = payload;
			if (running !== false) return;
			if (reason !== "agent_end") return;
			if (!sessionId) return;
			const store = getDefaultStore();
			const head = store.set(dequeueHeadAtom, sessionId);
			if (!head) return;
			// 标记发生了「跨到下一轮」的队列派发：本回合 agent_end 的过期整体重拉据此跳过，
			// 让下方乐观气泡不被冲掉，交由下一轮自己的 agent_end 安全重拉。
			bumpQueuedDispatchSeq(sessionId);
			if (store.get(activeSessionAtom)?.runtimeId === sessionId) {
				const msg: ChatMessage = {
					id: nextId("user"),
					role: "user",
					text: head.displayText,
					timestamp: Date.now(),
					promptRef: head.request.promptRef,
					attachments: head.request.attachments,
				};
				rememberOptimisticUserMessage(sessionId, msg, store.get(chatMessagesAtom));
				store.set(chatMessagesAtom, (prev) => [...prev, msg]);
			}
			void (async () => {
				try {
					await waitForPluginHostReady();
					await window.vetta.session.prompt(sessionId, head.request);
				} catch (err) {
					console.error("[useMessageQueueDispatcher] queued prompt failed", err);
					const message = err instanceof Error ? err.message : String(err);
					if (store.get(activeSessionAtom)?.runtimeId === sessionId) {
						store.set(chatMessagesAtom, (prev) => appendError(prev, message));
					}
				}
			})();
		});
		return unsubscribe;
	}, []);
}
