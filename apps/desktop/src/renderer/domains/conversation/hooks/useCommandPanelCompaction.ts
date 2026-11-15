import { activeSessionAtom, contextCompactionEligibilityAtom } from "@shared/store/atoms";
import { getQueueForSession, messageQueueBySessionAtom } from "@shared/store/message-queue-atoms";
import { showToast } from "@shared/store/toast-atoms";
import { useAtomValue } from "jotai";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CommandPanelOperationItem } from "../components/command-panel/types";
import { focusInputEditor, removeInputTrigger } from "../components/input-bar/editor/inputEditorHandle";
import { formatUsagePercent } from "../services/context-ring-details";
import { useDefaultContextRingModel } from "./useContextRingModel";

/** 压缩上下文那一行在键盘索引里占第 0 位，与改造前一致。 */
export const COMPACTION_OPERATION_KEY = "__operation__";

/**
 * 面板顶部那一行「压缩上下文」。
 *
 * 单独成 hook：它自己持有排队状态、读三个 atom、发 IPC、弹错误提示——和面板的
 * 分类 / 搜索 / 键盘完全无关。留在 `useCommandPanelModel` 里会让那个 hook 同时为
 * 「面板怎么排版」和「会话怎么压缩」两件不相干的事改变。
 */
export function useCommandPanelCompaction({
	onClose,
	enabled,
	filter,
}: {
	readonly onClose: () => void;
	/** 会话已绑定 Runtime 且宿主允许压缩。 */
	readonly enabled: boolean;
	/** 归一化后的触发词（不含 `/`）。 */
	readonly filter: string;
}): CommandPanelOperationItem | undefined {
	const { t } = useTranslation("chat");
	const activeSession = useAtomValue(activeSessionAtom);
	const eligibility = useAtomValue(contextCompactionEligibilityAtom);
	const queueMap = useAtomValue(messageQueueBySessionAtom);
	const contextRing = useDefaultContextRingModel(false);
	const [queueing, setQueueing] = useState(false);
	const queued = activeSession
		? getQueueForSession(queueMap, activeSession.runtimeId).some((item) => item.kind === "context_compaction")
		: false;
	const matches =
		filter.length === 0 ||
		["compact", "compaction", "context", "压缩", "上下文"].some((term) => term.includes(filter.toLocaleLowerCase()));

	const select = useCallback(() => {
		if (!activeSession || queueing || queued || contextRing?.isCompacting) return;
		setQueueing(true);
		removeInputTrigger();
		onClose();
		focusInputEditor();
		void window.astravia.session
			.queueContextCompaction(activeSession.runtimeId)
			.catch((error) => {
				console.warn("[useCommandPanelCompaction] queue context compaction failed", error);
				showToast({
					variant: "error",
					title: t("slashPanel.compaction.errorTitle"),
					message: error instanceof Error ? error.message : t("slashPanel.compaction.errorMessage"),
				});
			})
			.finally(() => setQueueing(false));
	}, [activeSession, contextRing?.isCompacting, onClose, queued, queueing, t]);

	return useMemo<CommandPanelOperationItem | undefined>(() => {
		if (!enabled || !activeSession || !matches || eligibility.status === "ineligible") return undefined;
		// `contextRing.percent` 已经是 0–100 的进度口径；取整走与压缩环提示相同的格式化，
		// 否则同一份用量会在两个地方显示成不同数字。
		const percent = contextRing ? formatUsagePercent(contextRing.percent) : null;
		const description = contextRing?.isCompacting
			? t("slashPanel.compaction.compacting")
			: queued || queueing
				? t("slashPanel.compaction.queued")
				: percent === null
					? t("slashPanel.compaction.descriptionUnknown")
					: t("slashPanel.compaction.description", { percent });
		return {
			id: COMPACTION_OPERATION_KEY,
			label: t("slashPanel.compaction.label"),
			description,
			contextRing: contextRing
				? {
						percent: contextRing.percent,
						offset: contextRing.offset,
						color: contextRing.color,
						isCompacting: contextRing.isCompacting,
						tooltip: contextRing.tooltip,
					}
				: null,
			disabled: queued || queueing || Boolean(contextRing?.isCompacting),
			onSelect: select,
		};
	}, [activeSession, contextRing, eligibility.status, enabled, matches, queued, queueing, select, t]);
}
