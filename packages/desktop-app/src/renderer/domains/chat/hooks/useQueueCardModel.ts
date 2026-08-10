import { markQueueEntrySelfRemoved } from "@domains/chat/services/queue-mirror";
import {
	getQueueForSession,
	isQueuePausedForSession,
	messageQueueBySessionAtom,
	messageQueuePausedBySessionAtom,
	setQueueForSessionAtom,
} from "@shared/store/message-queue-atoms";
import type { QueueCardItem, QueueCardPausedBanner, QueueCardViewLabels } from "@vetta/theme-ui/chat";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

export interface QueueCardModel {
	items: QueueCardItem[];
	labels: QueueCardViewLabels;
	onReorder: (orderedIds: readonly string[]) => void;
	onRemove: (id: string) => void;
	paused: QueueCardPausedBanner | undefined;
}

/**
 * 队列抽屉数据模型。队列属主在主进程 kernel（ADR-0060）：本地 atom 只是镜像，
 * 增删排序全部走 IPC；镜像同时做乐观更新，等 queue.changed 回流校正。
 */
export function useQueueCardModel(runtimeId: string): QueueCardModel {
	const { t } = useTranslation("chat");
	const queueMap = useAtomValue(messageQueueBySessionAtom);
	const setQueue = useSetAtom(setQueueForSessionAtom);
	const fullItems = getQueueForSession(queueMap, runtimeId);

	const items = useMemo<QueueCardItem[]>(
		() => fullItems.map((item) => ({ id: item.id, displayText: item.displayText })),
		[fullItems],
	);

	const onReorder = useCallback(
		(orderedIds: readonly string[]) => {
			const byId = new Map(fullItems.map((item) => [item.id, item]));
			const next = orderedIds.map((id) => byId.get(id)).filter((item) => item !== undefined);
			setQueue({ runtimeId, items: next });
			void window.vetta.session.reorderQueuedMessages(runtimeId, [...orderedIds]).catch((err) => {
				console.warn("[useQueueCardModel] reorder failed", err);
			});
		},
		[fullItems, runtimeId, setQueue],
	);

	const onRemove = useCallback(
		(id: string) => {
			// 先记账再发 IPC：queue.changed 可能先于 invoke 返回到达，
			// 记账保证该条目不被误判为「已消费」而补出用户气泡。
			markQueueEntrySelfRemoved(id);
			setQueue({ runtimeId, items: fullItems.filter((item) => item.id !== id) });
			void window.vetta.session.removeQueuedMessage(runtimeId, id).catch((err) => {
				console.warn("[useQueueCardModel] remove failed", err);
			});
		},
		[fullItems, runtimeId, setQueue],
	);

	const labels = useMemo<QueueCardViewLabels>(
		() => ({
			empty: t("inputBar.drawer.queueEmpty"),
			sendNow: t("inputBar.drawer.queueSendNow"),
			delete: t("inputBar.drawer.queueDelete"),
		}),
		[t],
	);

	const pausedMap = useAtomValue(messageQueuePausedBySessionAtom);
	const isPaused = isQueuePausedForSession(pausedMap, runtimeId);
	const paused = useMemo<QueueCardPausedBanner | undefined>(
		() =>
			isPaused
				? {
						label: t("inputBar.drawer.queuePaused"),
						resumeLabel: t("inputBar.drawer.queueResume"),
						onResume: () => {
							void window.vetta.session.resumeQueue(runtimeId).catch((err) => {
								console.warn("[useQueueCardModel] resumeQueue failed", err);
							});
						},
					}
				: undefined,
		[isPaused, runtimeId, t],
	);

	return { items, labels, onReorder, onRemove, paused };
}
