import type { QueueCardItem, QueueCardPausedBanner, QueueCardViewLabels } from "@astravia-org/theme-ui/chat";
import { isCompactingAtom } from "@shared/store/atoms";
import {
	getQueueForSession,
	isQueuePausedForSession,
	messageQueueBySessionAtom,
	messageQueuePausedBySessionAtom,
	removeQueueItemForSessionAtom,
	setQueueForSessionAtom,
} from "@shared/store/message-queue-atoms";
import { appendToSessionInputDraft } from "@shared/store/session-input-draft";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { focusInputEditor } from "../components/input-bar/editor/inputEditorHandle";

export interface QueueCardModel {
	items: QueueCardItem[];
	labels: QueueCardViewLabels;
	onReorder: (orderedIds: readonly string[]) => void;
	onRemove: (id: string) => void;
	/** 撤回输入框：条目出队 + 文本回到草稿，可再次编辑后重发。 */
	onRecall: (id: string) => void;
	/** 引导：条目出队后立即作为 steer 注入当前回合，不打断正在跑的回答。 */
	onGuide: (id: string) => void;
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
	const removeQueueItem = useSetAtom(removeQueueItemForSessionAtom);
	const fullItems = getQueueForSession(queueMap, runtimeId);
	const isCompacting = useAtomValue(isCompactingAtom);

	const items = useMemo<QueueCardItem[]>(() => {
		const compactionIndex = fullItems.findIndex((item) => item.kind === "context_compaction");
		return fullItems.map((item, index) => ({
			id: item.id,
			kind: item.kind,
			displayText: item.kind === "context_compaction" ? t("inputBar.drawer.contextCompaction") : item.displayText,
			canSendNow: item.kind === "message" && !isCompacting && (compactionIndex < 0 || index < compactionIndex),
		}));
	}, [fullItems, isCompacting, t]);

	const onReorder = useCallback(
		(orderedIds: readonly string[]) => {
			const byId = new Map(fullItems.map((item) => [item.id, item]));
			const next = orderedIds.map((id) => byId.get(id)).filter((item) => item !== undefined);
			setQueue({ runtimeId, items: next });
			void window.astravia.session.reorderQueuedMessages(runtimeId, [...orderedIds]).catch((err) => {
				console.warn("[useQueueCardModel] reorder failed", err);
			});
		},
		[fullItems, runtimeId, setQueue],
	);

	const onRemove = useCallback(
		(id: string) => {
			setQueue({ runtimeId, items: fullItems.filter((item) => item.id !== id) });
			void window.astravia.session.removeQueuedMessage(runtimeId, id).catch((err) => {
				console.warn("[useQueueCardModel] remove failed", err);
			});
		},
		[fullItems, runtimeId, setQueue],
	);

	const onRecall = useCallback(
		(id: string) => {
			const target = fullItems.find((item) => item.id === id);
			// 压缩屏障不是用户写的文本，撤回没东西可编辑，直接当删除处理。
			if (!target || target.kind === "context_compaction") return;
			setQueue({ runtimeId, items: fullItems.filter((item) => item.id !== id) });
			void window.astravia.session.removeQueuedMessage(runtimeId, id).then(
				() => {
					// 只有出队真的成功才写草稿，否则同一句话会同时留在队列与输入框里。
					appendToSessionInputDraft(target.displayText);
					// 撤回的目的是继续改，落字后直接把焦点送回编辑器，省掉一次点击。
					focusInputEditor();
				},
				(error: unknown) => {
					// 出队失败就把乐观移除退回去，别让这条消息在界面上凭空消失、却仍留在队列里。
					console.warn("[useQueueCardModel] recall failed", error);
					setQueue({ runtimeId, items: fullItems });
				},
			);
		},
		[fullItems, runtimeId, setQueue],
	);

	const onGuide = useCallback(
		(id: string) => {
			// 压缩屏障不是用户写的话，没有可引导的内容（按钮也不渲染，这是模型层的防御）。
			const target = fullItems.find((item) => item.id === id);
			if (!target || target.kind === "context_compaction") return;
			void window.astravia.session.guideQueuedMessage(runtimeId, id).then(
				(status) => {
					// 条目原样进 steering（空闲时直接开回合），没有出队再重发，附图与上下文不会丢。
					// missing 表示条目已被本回合消费或正在取消：不做乐观移除，等 queue.changed 回流校正。
					if (status === "missing") return;
					// 按 id 从镜像里摘：等回执期间新入队的条目不能被这份渲染快照覆盖掉。
					removeQueueItem({ runtimeId, id });
				},
				(error: unknown) => {
					console.warn("[useQueueCardModel] guide failed", error);
				},
			);
		},
		[fullItems, removeQueueItem, runtimeId],
	);

	const labels = useMemo<QueueCardViewLabels>(
		() => ({
			empty: t("inputBar.drawer.queueEmpty"),
			sendNow: t("inputBar.drawer.queueSendNow"),
			delete: t("inputBar.drawer.queueDelete"),
			recall: t("inputBar.drawer.queueRecall"),
			guide: t("inputBar.drawer.queueGuide"),
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
							void window.astravia.session.resumeQueue(runtimeId).catch((err) => {
								console.warn("[useQueueCardModel] resumeQueue failed", err);
							});
						},
					}
				: undefined,
		[isPaused, runtimeId, t],
	);

	return { items, labels, onGuide, onRecall, onReorder, onRemove, paused };
}
