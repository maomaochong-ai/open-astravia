import { confirmDialogAtom, type SessionInfo } from "@shared/store/atoms";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { KnowledgeHistoryPanelViewLabels, KnowledgeHistorySessionItem } from "@vetta/theme-ui/activity";
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/** 列表默认展示条数，点「加载全部」后展开全部记录。 */
const DEFAULT_VISIBLE = 10;

export interface KnowledgeHistoryPanelModel {
	loading: boolean;
	sessions: KnowledgeHistorySessionItem[];
	hasMore: boolean;
	clearing: boolean;
	labels: KnowledgeHistoryPanelViewLabels;
	onOpen: (path: string) => void;
	onClearRequest: () => void;
	onExpand: () => void;
}

export function useKnowledgeHistoryPanelModel(cwd: string | null): KnowledgeHistoryPanelModel {
	const { t } = useTranslation("settings");
	const navigate = useNavigate();
	const confirm = useSetAtom(confirmDialogAtom);
	const params = useParams({ strict: false }) as { path?: string };
	const currentPath = typeof params.path === "string" ? decodeURIComponent(params.path) : "";
	const [sessions, setSessions] = useState<SessionInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [expanded, setExpanded] = useState(false);
	const [clearing, setClearing] = useState(false);

	const reload = useCallback(async () => {
		if (!cwd) {
			setSessions([]);
			return;
		}
		const list = (await window.vetta.session.listSessions(cwd)) as SessionInfo[];
		setSessions(list);
	}, [cwd]);

	useEffect(() => {
		let cancelled = false;
		setExpanded(false);
		void (async () => {
			try {
				if (!cwd) {
					if (!cancelled) setSessions([]);
					return;
				}
				const list = (await window.vetta.session.listSessions(cwd)) as SessionInfo[];
				if (!cancelled) setSessions(list);
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [cwd]);

	const onOpen = useCallback(
		(path: string) => {
			void navigate({ to: "/viewer/$path", params: { path: encodeURIComponent(path) } });
		},
		[navigate],
	);

	const onClearRequest = useCallback(() => {
		confirm({
			title: t("kbHistoryClearTitle"),
			message: t("kbHistoryClearMsg"),
			variant: "danger",
			confirmLabel: t("kbHistoryClearConfirm"),
			onConfirm: () => {
				void (async () => {
					setClearing(true);
					try {
						await window.vetta.knowledge.clearRecords();
						setExpanded(false);
						await reload();
					} finally {
						setClearing(false);
					}
				})();
			},
		});
	}, [confirm, t, reload]);

	const onExpand = useCallback(() => setExpanded(true), []);

	const hasMore = !expanded && sessions.length > DEFAULT_VISIBLE;
	const visible = expanded ? sessions : sessions.slice(0, DEFAULT_VISIBLE);

	const viewSessions = useMemo<KnowledgeHistorySessionItem[]>(
		() =>
			visible.map((s) => ({
				path: s.path,
				label: new Date(s.modifiedAt).toLocaleString(),
				active: s.path === currentPath,
			})),
		[visible, currentPath],
	);

	const labels = useMemo<KnowledgeHistoryPanelViewLabels>(
		() => ({
			loading: t("kbHistoryLoading"),
			empty: t("kbHistoryEmpty"),
			clear: t("kbHistoryClear"),
			loadAll: t("kbHistoryLoadAll", { count: sessions.length }),
		}),
		[t, sessions.length],
	);

	return {
		loading,
		sessions: viewSessions,
		hasMore,
		clearing,
		labels,
		onOpen,
		onClearRequest,
		onExpand,
	};
}
