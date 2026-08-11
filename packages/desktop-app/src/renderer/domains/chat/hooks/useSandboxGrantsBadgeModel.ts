import { activeSessionAtom } from "@shared/store/atoms";
import type { RuntimeSandboxGrantInfo } from "@vetta/runtime-core";
import type { SandboxGrantsBadgeViewLabels, SandboxGrantViewItem } from "@vetta/theme-ui/chat";
import type { TFunction } from "i18next";
import { useAtomValue } from "jotai";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const REFRESH_INTERVAL_MS = 4000;

function formatRelative(timestamp: number, now: number): string {
	const deltaSec = Math.max(0, Math.round((now - timestamp) / 1000));
	if (deltaSec < 60) return `${deltaSec} 秒前`;
	const min = Math.floor(deltaSec / 60);
	if (min < 60) return `${min} 分钟前`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr} 小时前`;
	const day = Math.floor(hr / 24);
	return `${day} 天前`;
}

function formatAbsolute(timestamp: number): string {
	return new Date(timestamp).toLocaleString();
}

function capabilityLabel(cap: RuntimeSandboxGrantInfo["capability"], t: TFunction<"chat">): string {
	switch (cap) {
		case "file.read":
			return t("capability.read");
		case "file.write":
			return t("capability.write");
		case "network":
			return t("capability.network");
		default:
			return cap;
	}
}

export interface SandboxGrantsBadgeModel {
	count: number;
	open: boolean;
	grants: SandboxGrantViewItem[];
	labels: SandboxGrantsBadgeViewLabels;
	containerRef: RefObject<HTMLDivElement | null>;
	onToggle: () => void;
	onRevokeAll: () => void;
	onRevoke: (grantId: string) => void;
}

export function useSandboxGrantsBadgeModel(): SandboxGrantsBadgeModel | null {
	const { t } = useTranslation("chat");
	const activeSession = useAtomValue(activeSessionAtom);
	const sessionId = activeSession?.runtimeId;
	const [grants, setGrants] = useState<RuntimeSandboxGrantInfo[]>([]);
	const [open, setOpen] = useState(false);
	const [now, setNow] = useState(() => Date.now());
	const containerRef = useRef<HTMLDivElement>(null);

	const refresh = useCallback(async () => {
		if (!sessionId) {
			setGrants([]);
			return;
		}
		try {
			const result = await window.vetta.session.listSandboxGrants(sessionId);
			setGrants(result);
		} catch {
			// Ignore — IPC may be torn down during navigation.
		}
	}, [sessionId]);

	useEffect(() => {
		void refresh();
		const id = window.setInterval(() => {
			setNow(Date.now());
			void refresh();
		}, REFRESH_INTERVAL_MS);
		return () => window.clearInterval(id);
	}, [refresh]);

	useEffect(() => {
		if (!open) return;
		void refresh();
		const handler = (e: MouseEvent) => {
			if (!containerRef.current) return;
			if (containerRef.current.contains(e.target as Node)) return;
			setOpen(false);
		};
		window.addEventListener("mousedown", handler);
		return () => window.removeEventListener("mousedown", handler);
	}, [open, refresh]);

	const handleRevoke = useCallback(
		async (grantId: string) => {
			if (!sessionId) return;
			await window.vetta.session.revokeSandboxGrant(sessionId, grantId);
			await refresh();
		},
		[sessionId, refresh],
	);

	const handleRevokeAll = useCallback(async () => {
		if (!sessionId) return;
		await window.vetta.session.revokeAllSandboxGrants(sessionId);
		await refresh();
	}, [sessionId, refresh]);

	const sortedGrants = useMemo(
		(): SandboxGrantViewItem[] =>
			grants
				.slice()
				.sort((a, b) => b.createdAt - a.createdAt)
				.map((grant) => ({
					id: grant.id,
					capabilityLabel: capabilityLabel(grant.capability, t),
					toolName: grant.toolName,
					grantRoot: grant.grantRoot,
					relativeTime: formatRelative(grant.createdAt, now),
					absoluteTime: formatAbsolute(grant.createdAt),
				})),
		[grants, now, t],
	);

	const labels = useMemo(
		(): SandboxGrantsBadgeViewLabels => ({
			tooltip: t("sandboxGrantsBadge.tooltip"),
			title: t("sandboxGrantsBadge.title"),
			revokeAll: t("sandboxGrantsBadge.revokeAll"),
			revoke: t("sandboxGrantsBadge.revoke"),
		}),
		[t],
	);

	if (!sessionId || grants.length === 0) return null;

	return {
		count: grants.length,
		open,
		grants: sortedGrants,
		labels,
		containerRef,
		onToggle: () => setOpen((v) => !v),
		onRevokeAll: () => void handleRevokeAll(),
		onRevoke: (grantId) => void handleRevoke(grantId),
	};
}
