import type { PortForward } from "@preload/api-types/ssh";
import {
	backgroundTasksBySessionAtom,
	getBackgroundTasksForSession,
	openUrlInActivityWorkspaceAtom,
} from "@shared/store/atoms";
import type { RemoteListeningPort } from "@vetta/ssh-transport";
import { parseProjectLocation } from "@vetta/ssh-transport/project-uri";
import type {
	PortCandidateViewItem,
	PortForwardViewItem,
	PortScanState,
	PortsTabPanelViewLabels,
	PortsTabPanelViewProps,
} from "@vetta-org/theme-ui/activity";
import { useAtomValue, useSetAtom } from "jotai";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useActivityRuntimeIds, useActivityWorkspace } from "../registry/context";
import { detectPortsInOutput } from "../services/detect-ports-in-output";
import { collectRuntimeItems } from "../services/runtime-scope";
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
	const { t } = useTranslation(["chat", "common"]);
	const workspace = useActivityWorkspace();
	const hostId = useRemoteProjectHostId(workspace.cwd);
	const forwards = useSshPortForwards(hostId);
	const runtimeIds = useActivityRuntimeIds();
	const backgroundTasksMap = useAtomValue(backgroundTasksBySessionAtom);
	const openUrlInWorkspace = useSetAtom(openUrlInActivityWorkspaceAtom);

	const [listeners, setListeners] = useState<readonly RemoteListeningPort[]>([]);
	const [scanState, setScanState] = useState<PortScanState>("loading");
	const [scanError, setScanError] = useState<string | undefined>(undefined);
	const [draftRemotePort, setDraftRemotePort] = useState("");
	const [draftLocalPort, setDraftLocalPort] = useState("");
	const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
	const [copiedPort, setCopiedPort] = useState<number | undefined>(undefined);
	const [editingRemotePort, setEditingRemotePort] = useState<number | undefined>(undefined);
	const [editingLocalPort, setEditingLocalPort] = useState("");
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
		async (
			remotePort: number,
			options: { label?: string; localPort?: number; source?: "manual" | "detected" } = {},
		) => {
			if (!hostId) return;
			setErrorMessage(undefined);
			try {
				await window.vetta.ssh.openPortForward({
					hostId,
					remotePort,
					localPort: options.localPort,
					label: options.label,
					source: options.source ?? "manual",
				});
			} catch (error) {
				setErrorMessage(error instanceof Error ? error.message : String(error));
			}
		},
		[hostId],
	);

	/** 端口号在界面上一律先当字符串收，由这里判一次：空串、字母和越界都在这里挡掉。 */
	const parsePort = useCallback(
		(raw: string): number | undefined => {
			const port = Number.parseInt(raw.trim(), 10);
			if (!Number.isInteger(port) || port <= 0 || port > 65535) {
				setErrorMessage(t("activityPanel.ports.invalidPort"));
				return undefined;
			}
			return port;
		},
		[t],
	);

	const onAddDraftPort = useCallback(
		(event: FormEvent) => {
			event.preventDefault();
			const remotePort = parsePort(draftRemotePort);
			if (remotePort === undefined) return;
			// 本机端口留空就是「跟远端同号，被占用了再换」；填了就按填的来。
			const wantsLocalPort = draftLocalPort.trim() !== "";
			const localPort = wantsLocalPort ? parsePort(draftLocalPort) : undefined;
			if (wantsLocalPort && localPort === undefined) return;
			setDraftRemotePort("");
			setDraftLocalPort("");
			void forwardPort(remotePort, { localPort });
		},
		[draftLocalPort, draftRemotePort, forwardPort, parsePort],
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

	const onStartEditLocalPort = useCallback(
		(remotePort: number) => {
			setErrorMessage(undefined);
			setEditingRemotePort(remotePort);
			setEditingLocalPort(String(findForward(remotePort)?.localPort ?? remotePort));
		},
		[findForward],
	);

	const onSubmitLocalPort = useCallback(
		(event: FormEvent) => {
			event.preventDefault();
			if (editingRemotePort === undefined) return;
			const localPort = parsePort(editingLocalPort);
			if (localPort === undefined) return;
			setEditingRemotePort(undefined);
			// 主进程先接通新号再撤旧的，所以换号失败时用户手上那条仍然好用。
			void forwardPort(editingRemotePort, { localPort, label: findForward(editingRemotePort)?.label });
		},
		[editingLocalPort, editingRemotePort, findForward, forwardPort, parsePort],
	);

	const onStop = useCallback(
		(remotePort: number) => {
			if (hostId) void window.vetta.ssh.closePortForward({ hostId, remotePort });
		},
		[hostId],
	);

	const labels = useMemo(
		(): PortsTabPanelViewLabels => ({
			heading: t("activityPanel.ports.heading"),
			candidatesHeading: t("activityPanel.ports.candidatesHeading"),
			empty: t("activityPanel.ports.empty"),
			emptyHint: t("activityPanel.ports.emptyHint"),
			remotePortPlaceholder: t("activityPanel.ports.remotePortPlaceholder"),
			localPortPlaceholder: t("activityPanel.ports.localPortPlaceholder"),
			localPortPrefix: t("activityPanel.ports.localPortPrefix"),
			add: t("activityPanel.ports.add"),
			forward: t("activityPanel.ports.forward"),
			preview: t("activityPanel.ports.preview"),
			openExternal: t("activityPanel.ports.openExternal"),
			copyAddress: t("activityPanel.ports.copyAddress"),
			copied: t("activityPanel.ports.copied"),
			changeLocalPort: t("activityPanel.ports.changeLocalPort"),
			save: t("common:actions.save"),
			cancel: t("common:actions.cancel"),
			stop: t("activityPanel.ports.stop"),
			retry: t("activityPanel.ports.retry"),
			refresh: t("activityPanel.ports.refresh"),
			statusActive: t("activityPanel.ports.statusActive"),
			statusReconnecting: t("activityPanel.ports.statusReconnecting"),
			statusFailed: t("activityPanel.ports.statusFailed"),
			scanning: t("activityPanel.ports.scanning"),
			scanUnsupported: t("activityPanel.ports.scanUnsupported"),
			scanFailed: t("activityPanel.ports.scanFailed"),
			fromOutput: t("activityPanel.ports.fromOutput"),
		}),
		[t],
	);

	/**
	 * 后台任务（dev server 就跑在那里）自己打出来的地址。
	 *
	 * 它比扫描更早也更准：任务刚起来时端口已经在输出里，而扫描要等用户点刷新；远端没有扫描
	 * 工具时这还是唯一的线索。只认归属这台主机的任务——同一个会话里可能还有本机的任务。
	 */
	const detectedPorts = useMemo(() => {
		if (!hostId) return [];
		const tasks = collectRuntimeItems(runtimeIds, (runtimeId) =>
			getBackgroundTasksForSession(backgroundTasksMap, runtimeId),
		);
		const ports: number[] = [];
		for (const task of tasks) {
			const location = parseProjectLocation(task.cwd);
			if (location.kind !== "ssh" || location.hostId !== hostId) continue;
			for (const port of detectPortsInOutput(task.tail)) if (!ports.includes(port)) ports.push(port);
		}
		return ports;
	}, [backgroundTasksMap, hostId, runtimeIds]);

	const candidates = useMemo((): PortCandidateViewItem[] => {
		const forwarded = new Set(forwards.map((forward) => forward.remotePort));
		const scanned = listeners.filter((port) => !forwarded.has(port.port));
		const scannedByPort = new Map(scanned.map((port) => [port.port, port]));
		// 从输出认出来的排在前面：那是用户刚刚起的那个服务，也是他此刻想看的。
		const fromOutput = detectedPorts
			.filter((port) => !forwarded.has(port))
			.map((port) => ({
				port,
				processName: scannedByPort.get(port)?.processName,
				origin: "output" as const,
			}));
		const shown = new Set(fromOutput.map((candidate) => candidate.port));
		return [...fromOutput, ...scanned.filter((port) => !shown.has(port.port)).map(toCandidateViewItem)];
	}, [detectedPorts, forwards, listeners]);

	return {
		forwards: forwards.map(toForwardViewItem),
		candidates,
		scanState,
		scanError,
		labels,
		draftRemotePort,
		draftLocalPort,
		errorMessage,
		copiedPort,
		editingRemotePort,
		editingLocalPort,
		onDraftRemotePortChange: setDraftRemotePort,
		onDraftLocalPortChange: setDraftLocalPort,
		onAddDraftPort,
		onForwardCandidate: (port) => {
			const listener = listeners.find((candidate) => candidate.port === port);
			void forwardPort(port, { label: listener?.processName, source: "detected" });
		},
		onPreview,
		onOpenExternal,
		onCopyAddress,
		onStartEditLocalPort,
		onEditingLocalPortChange: setEditingLocalPort,
		onSubmitLocalPort,
		onCancelEditLocalPort: () => setEditingRemotePort(undefined),
		onStop,
		onRetry: (remotePort) => void forwardPort(remotePort, { label: findForward(remotePort)?.label }),
		onRefresh: () => void runScan(),
	};
}
