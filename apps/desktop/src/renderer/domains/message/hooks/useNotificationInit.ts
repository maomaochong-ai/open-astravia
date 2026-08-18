import { useSSEEvent } from "@shared/hooks/useSSEEvent";
import { fetchNotifications, fetchNotificationUnread, type NotificationVO } from "@shared/lib/api";
import { authTokenAtom, notificationsAtom, notificationUnreadAtom } from "@shared/store/atoms";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect } from "react";

/**
 * 站内信初始化：登录后拉取列表与未读数，并监听 SSE "notification:new" 实时插入（ADR-0018）。
 */
export function useNotificationInit(): void {
	const token = useAtomValue(authTokenAtom);
	const setList = useSetAtom(notificationsAtom);
	const setUnread = useSetAtom(notificationUnreadAtom);

	useSSEEvent(
		"notification:new",
		useCallback(
			(data: unknown) => {
				const payload = data as { notification?: NotificationVO; unread?: number };
				if (payload.notification) {
					setList((prev) => [payload.notification as NotificationVO, ...prev]);
				}
				if (typeof payload.unread === "number") {
					setUnread(payload.unread);
				} else {
					setUnread((prev) => prev + 1);
				}
			},
			[setList, setUnread],
		),
	);

	useEffect(() => {
		if (!token) {
			setList([]);
			setUnread(0);
			return;
		}
		void fetchNotifications(token, { page: 1, page_size: 50 })
			.then((res) => setList(res.list ?? []))
			.catch(console.error);
		void fetchNotificationUnread(token).then(setUnread).catch(console.error);
	}, [token, setList, setUnread]);
}
