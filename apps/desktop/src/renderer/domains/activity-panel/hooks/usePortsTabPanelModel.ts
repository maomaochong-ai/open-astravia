import type { PortForward } from "@preload/api-types/ssh";
import { openUrlInActivityWorkspaceAtom } from "@shared/store/atoms";
import type { RemoteListeningPort } from "@vetta/ssh-transport";
import type {
	PortCandidateViewItem,
	PortForwardViewItem,
	PortScanState,
	PortsTabPanelViewLabels,
	PortsTabPanelViewProps,
} from "@vetta-org/theme-ui/activity";
import { useSetAtom } from "jotai";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useActivityWorkspace } from "../registry/context";
import { useRemoteProjectHostId, useSshPortForwards } from "./useSshPortForwards";

/** 「已复制」的提示留多久。 */
const COPIED_FEEDBACK_MS = 1_500;

/** 转发到本机之后，用户要打开的那个地址。 */
export function formatForwardedUrl(localPort: number): string {
	return `http://localhost:${localPort}`;
}

function toForwardViewItem(forward: PortForward): PortForwardViewItem {
	return {
		remotePort: forward.remotePort,
		localPort: forward.localPort,
		localAddress: `localhost:${forward.localPort}`,
		processName: forward.label,
		status: forward.status,
		error: forward.error,
	};
}

function toCandidateViewItem(port: RemoteListeningPort): PortCandidateViewItem {
	return { port: port.port, processName: port.processName, origin: "scan" };
}

/**
 * 活动面板端口页。
 *
 * 面板做的事只有一件：把远端跑着的服务变成一个本机能打开的地址。因此已转发的地址排在最前，
 * 「远端还有哪些端口在听」是次要的候选，手动输入端口号放在最后——多数时候用户并不需要记住
 * 那个号。
 */
export function usePortsTabPanelModel(): PortsTabPanelViewProps {
	const { t } = useTranslation("chat");
	const workspace = useActivityWorkspace();
	const hostId = useRemoteProjectHostId(workspace.cwd);
	const forwards = useSshPortForwards(hostId);
	const openUrlInWorkspace = useSetAtom(openUrlInActivityWorkspaceAtom);

	const [listeners, setListeners] = useState<readonly RemoteListeningPort[]>([]);
	const [scanState, setScanState] = useState<PortScanState>("loading");
	const [scanError, setScanError] = useState<string | undefined>(undefined);
	const [draftPort, setDraftPort] = useState("");
	const [addError, setAddError] = useState<string | undefined>(undefined);
	const [copiedPort, setCopiedPort] = useState<number | undefined>(undefined);
	const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const scanGeneration = useRef(0);

	// 扫描要走一次 SSH 往返，所以只在进入面板和用户点刷新时做，不做轮询。换主机或连点刷新时
	// 用代次丢弃迟到的那一次结果——否则先发起的慢请求会覆盖后发起的。
	const runScan = useCallback(async () => {
		if (!hostId) {
			setListeners([]);
			setScanState("ready");
			return;
		}
		const generation = ++scanGeneration.current;
		setScanState("loading");
		try {
			const scan = await window.vetta.ssh.listListeningPorts(hostId);
			if (generation !== scanGeneration.current) return;
			setListeners(scan.ports);
			setScanState(scan.tool === "none" ? "unsupported" : "ready");
			setScanError(undefined);
		} catch (error) {
			if (generation !== scanGeneration.current) return;
			setListeners([]);
			setScanState("failed");
			setScanError(error instanceof Error ? error.message : String(error));
		}
	}, [hostId]);

	useEffect(() => void runScan(), [runScan]);

	useEffect(() => () => clearTimeout(copiedTimer.current), []);

	const forwardPort = useCallback(
		async (remotePort: number, label?: string, source: "manual" | "detected" = "manual") => {
			if (!hostId) return;
			setAddError(undefined);
			try {
				await window.vetta.ssh.openPortForward({ hostId, remotePort, label, source });
			} catch (error) {
				setAddError(error instanceof Error ? error.message : String(error));
			}
		},
		[hostId],
	);

	const onAddDraftPort = useCallback(
		(event: FormEvent) => {
			event.preventDefault();
			const port = Number.parseInt(draftPort.trim(), 10);
			if (!Number.isInteger(port) || port <= 0 || port > 65535) {
				setAddError(t("activityPanel.ports.invalidPort"));
				return;
			}
			setDraftPort("");
			void forwardPort(port);
		},
		[draftPort, forwardPort, t],
	);

	const findForward = useCallback(
		(remotePort: number) => forwards.find((forward) => forward.remotePort === remotePort),
		[forwards],
	);

	const onPreview = useCallback(
		(remotePort: number) => {
			const forward = findForward(remotePort);
			if (!forward) return;
			// 内置浏览器就在同一个面板里：远端跑的页面不必离开应用就能看。
			openUrlInWorkspace({ workspaceId: workspace.id, url: formatForwardedUrl(forward.localPort) });
		},
		[findForward, openUrlInWorkspace, workspace.id],
	);

	const onOpenExternal = useCallback(
		(remotePort: number) => {
			const forward = findForward(remotePort);
			if (forward) void window.vetta.auth.openExternal(formatForwardedUrl(forward.localPort));
		},
		[findForward],
	);

	const onCopyAddress = useCallback(
		(remotePort: number) => {
			const forward = findForward(remotePort);
			if (!forward) return;
			void navigator.clipboard.writeText(formatForwardedUrl(forward.localPort));
			setCopiedPort(remotePort);
			clearTimeout(copiedTimer.current);
			copiedTimer.current = setTimeout(() => setCopiedPort(undefined), COPIED_FEEDBACK_MS);
		},
		[findForward],
	);

	const onStop = useCallback(
		(remotePort: number) => {
			if (hostId) void window.vetta.ssh.closePortForward({ hostId, remotePort });
		},
		[hostId],
	);

	const labels = useMemo(
		(): PortsTabPanelViewLabels => ({
			forwardedHeading: t("activityPanel.ports.forwardedHeading"),
			candidatesHeading: t("activityPanel.ports.candidatesHeading"),
			empty: t("activityPanel.ports.empty"),
			emptyHint: t("activityPanel.ports.emptyHint"),
			addPlaceholder: t("activityPanel.ports.addPlaceholder"),
			add: t("activityPanel.ports.add"),
			forward: t("activityPanel.ports.forward"),
			preview: t("activityPanel.ports.preview"),
			openExternal: t("activityPanel.ports.openExternal"),
			copyAddress: t("activityPanel.ports.copyAddress"),
			copied: t("activityPanel.ports.copied"),
			stop: t("activityPanel.ports.stop"),
			retry: t("activityPanel.ports.retry"),
			refresh: t("activityPanel.ports.refresh"),
			statusReconnecting: t("activityPanel.ports.statusReconnecting"),
			statusFailed: t("activityPanel.ports.statusFailed"),
			scanning: t("activityPanel.ports.scanning"),
			scanUnsupported: t("activityPanel.ports.scanUnsupported"),
			scanFailed: t("activityPanel.ports.scanFailed"),
			fromOutput: t("activityPanel.ports.fromOutput"),
			portChanged: (remotePort, localPort) => t("activityPanel.ports.portChanged", { remotePort, localPort }),
		}),
		[t],
	);

	const candidates = useMemo(() => {
		const forwarded = new Set(forwards.map((forward) => forward.remotePort));
		return listeners.filter((port) => !forwarded.has(port.port)).map(toCandidateViewItem);
	}, [forwards, listeners]);

	return {
		forwards: forwards.map(toForwardViewItem),
		candidates,
		scanState,
		scanError,
		labels,
		draftPort,
		addError,
		copiedPort,
		onDraftPortChange: setDraftPort,
		onAddDraftPort,
		onForwardCandidate: (port) => {
			const listener = listeners.find((candidate) => candidate.port === port);
			void forwardPort(port, listener?.processName, "detected");
		},
		onPreview,
		onOpenExternal,
		onCopyAddress,
		onStop,
		onRetry: (remotePort) => void forwardPort(remotePort, findForward(remotePort)?.label),
		onRefresh: () => void runScan(),
	};
}
