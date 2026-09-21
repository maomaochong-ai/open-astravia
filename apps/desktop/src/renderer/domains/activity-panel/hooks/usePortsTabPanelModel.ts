import type { PortForward } from "@preload/api-types/ssh";
import {
	backgroundTasksBySessionAtom,
	getBackgroundTasksForSession,
	openUrlInActivityWorkspaceAtom,
} from "@shared/store/atoms";
import type { RemoteListeningPort } from "@vetta/ssh-transport";
import { parseProjectLocation } from "@vetta/ssh-transport/project-uri";
import type {
	PortRowViewItem,
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

/** 「3 分钟前」多久刷新一次：精度只到分钟，更勤只是白白重渲染。 */
const RELATIVE_TIME_TICK_MS = 30_000;

/**
 * 临时端口的起点（Linux 默认 ip_local_port_range 的下界）。
 *
 * 这个区间里在听的基本都是内核派给连接的临时端口，不是任何人想转发的服务——远端随便
 * 一台机器就能扫出几十个，混在一起时用户要找的 3000 会被它们淹掉。所以默认折叠起来，
 * 但仍然给出数量和展开入口：判断依据只是端口号，总有例外。
 */
const EPHEMERAL_PORT_FLOOR = 32768;

/** 绑在这些地址上，远端网络里的其他机器也能连到它。 */
const PUBLIC_BIND_ADDRESSES = new Set(["*", "0.0.0.0", "::", "[::]"]);

/** 转发到本机之后，用户要打开的那个地址。 */
export function formatForwardedUrl(localPort: number): string {
	return `http://localhost:${localPort}`;
}

/** 「刚刚 / 3 分钟前 / 2 小时前 / 3 天前」。 */
function formatStartedAgo(startedAt: number, now: number, locale: string | undefined, justNow: string): string {
	const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
	if (seconds < 60) return justNow;
	const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" });
	if (seconds < 3600) return format.format(-Math.floor(seconds / 60), "minute");
	if (seconds < 86_400) return format.format(-Math.floor(seconds / 3600), "hour");
	return format.format(-Math.floor(seconds / 86_400), "day");
}

/**
 * 显示用的进程名。
 *
 * Linux 的进程名（comm）被内核截在 15 个字符，`sglang::scheduler_TP1` 只剩 `sglang::schedul`。
 * 命令行第一段的文件名以它开头时说明是同一个名字的完整版，换成它。
 */
export function displayProcessName(processName: string | undefined, command: string | undefined): string | undefined {
	const program = command?.trim().split(/\s+/)[0]?.split("/").pop();
	if (processName && program && program.length > processName.length && program.startsWith(processName)) return program;
	return processName;
}

interface RowDraft {
	readonly port: number;
	listener?: RemoteListeningPort;
	/** 从任务输出认出它的那个任务的启动时间。 */
	outputStartedAt?: number;
	forward?: PortForward;
}

/**
 * 排序键：进程启动时间；没有扫描信息时退回任务启动时间，再退回映射建立的时间。
 * 三者都描述「这个服务是什么时候出现在用户面前的」，所以可以放在同一条时间线上比。
 */
function sortTime(row: RowDraft): number | undefined {
	return row.listener?.startedAt ?? row.outputStartedAt ?? row.forward?.createdAt;
}

/**
 * 活动面板端口页。
 *
 * 面板回答两件事：远端跑着哪些服务，哪些已经映射到本机能打开。两者合成一张按启动时间
 * 排序的列表，映射只是某一行的状态；手动输入端口号收在「+」后面——多数时候用户并不需要
 * 记住那个号。
 */
export function usePortsTabPanelModel(): PortsTabPanelViewProps {
	const { t, i18n } = useTranslation(["chat", "common"]);
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
	const [terminatingPort, setTerminatingPort] = useState<number | undefined>(undefined);
	/** SIGTERM 没收掉的进程：下一次终止改发 SIGKILL。 */
	const [stubbornPids, setStubbornPids] = useState<ReadonlySet<number>>(() => new Set());
	const [now, setNow] = useState(() => Date.now());
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

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), RELATIVE_TIME_TICK_MS);
		return () => clearInterval(timer);
	}, []);

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

	/**
	 * 终止占着这个端口的远端进程。
	 *
	 * 进程退了就顺手撤掉它的映射——留着只是一条指向空处的转发——再重扫一遍让列表如实反映。
	 * SIGTERM 没收掉时不假装成功：记下这个 pid，下一次同一个按钮改发 SIGKILL。
	 */
	const onTerminate = useCallback(
		async (port: number) => {
			const listener = listeners.find((candidate) => candidate.port === port);
			const pid = listener?.pid;
			if (!hostId || pid === undefined) return;
			setErrorMessage(undefined);
			setTerminatingPort(port);
			const name = listener?.processName ?? String(port);
			try {
				const result = await window.vetta.ssh.terminateRemoteProcess({
					hostId,
					pid,
					force: stubbornPids.has(pid),
				});
				if (!result.exited) {
					setStubbornPids((previous) => new Set(previous).add(pid));
					setErrorMessage(t("activityPanel.ports.terminateStubborn", { name }));
					return;
				}
				if (findForward(port)) await window.vetta.ssh.closePortForward({ hostId, remotePort: port });
				await runScan();
			} catch (error) {
				setErrorMessage(
					t("activityPanel.ports.terminateFailed", {
						name,
						reason: error instanceof Error ? error.message : String(error),
					}),
				);
			} finally {
				setTerminatingPort(undefined);
			}
		},
		[findForward, hostId, listeners, runScan, stubbornPids, t],
	);

	const labels = useMemo(
		(): PortsTabPanelViewLabels => ({
			heading: t("activityPanel.ports.heading"),
			runningStat: (count: number) => t("activityPanel.ports.runningStat", { count }),
			forwardedStat: (count: number) => t("activityPanel.ports.forwardedStat", { count }),
			sectionForwarded: t("activityPanel.ports.sectionForwarded"),
			sectionRunning: t("activityPanel.ports.sectionRunning"),
			manualTitle: t("activityPanel.ports.manualTitle"),
			remotePortLabel: t("activityPanel.ports.remotePortLabel"),
			localPortLabel: t("activityPanel.ports.localPortLabel"),
			empty: t("activityPanel.ports.empty"),
			emptyHint: t("activityPanel.ports.emptyHint"),
			remotePortPlaceholder: t("activityPanel.ports.remotePortPlaceholder"),
			localPortPlaceholder: t("activityPanel.ports.localPortPlaceholder"),
			localPortPrefix: t("activityPanel.ports.localPortPrefix"),
			add: t("activityPanel.ports.add"),
			addManual: t("activityPanel.ports.addManual"),
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
			scanUnsupported: t("activityPanel.ports.scanUnsupported"),
			scanFailed: t("activityPanel.ports.scanFailed"),
			fromOutput: t("activityPanel.ports.fromOutput"),
			notListening: t("activityPanel.ports.notListening"),
			publicBind: t("activityPanel.ports.publicBind"),
			terminate: t("activityPanel.ports.terminate"),
			forceTerminate: t("activityPanel.ports.forceTerminate"),
			terminateConfirm: (name: string) => t("activityPanel.ports.terminateConfirm", { name }),
			sensitiveToggle: (count: number) => t("activityPanel.ports.sensitiveToggle", { count }),
			sensitiveHint: t("activityPanel.ports.sensitiveHint"),
			unnamedToggle: (count: number) => t("activityPanel.ports.unnamedToggle", { count }),
			unnamedHint: t("activityPanel.ports.unnamedHint"),
			ephemeralToggle: (count: number) => t("activityPanel.ports.ephemeralToggle", { count }),
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
		const ports = new Map<number, number>();
		for (const task of tasks) {
			const location = parseProjectLocation(task.cwd);
			if (location.kind !== "ssh" || location.hostId !== hostId) continue;
			for (const port of detectPortsInOutput(task.tail)) if (!ports.has(port)) ports.set(port, task.startedAt);
		}
		return ports;
	}, [backgroundTasksMap, hostId, runtimeIds]);

	/**
	 * 在跑的服务、任务输出里认出的地址、已建立的映射，三路按端口合成一行。
	 *
	 * 顺序是启动时间从新到旧：刚起的 dev server 是用户此刻最想找的，它总在最上面；
	 * 说不出时间的（远端 ps 不可用）排在最后，彼此按端口号。
	 */
	const rows = useMemo((): PortRowViewItem[] => {
		const drafts = new Map<number, RowDraft>();
		const draftFor = (port: number): RowDraft => {
			const existing = drafts.get(port);
			if (existing) return existing;
			const created: RowDraft = { port };
			drafts.set(port, created);
			return created;
		};
		for (const listener of listeners) draftFor(listener.port).listener = listener;
		for (const [port, startedAt] of detectedPorts) draftFor(port).outputStartedAt = startedAt;
		for (const forward of forwards) draftFor(forward.remotePort).forward = forward;

		// 只有扫描确实跑通过，「扫描里没有它」才说明远端没人在听；扫描工具缺失或失败时不下这个结论。
		const scanKnown = scanState === "ready";
		const sorted = [...drafts.values()].sort((left, right) => {
			const leftTime = sortTime(left);
			const rightTime = sortTime(right);
			if (leftTime !== undefined && rightTime !== undefined && leftTime !== rightTime) return rightTime - leftTime;
			if (leftTime !== undefined && rightTime === undefined) return -1;
			if (leftTime === undefined && rightTime !== undefined) return 1;
			return left.port - right.port;
		});
		return sorted.map((draft): PortRowViewItem => {
			const { listener, forward } = draft;
			const fromOutput = draft.outputStartedAt !== undefined;
			const sensitive = listener?.sensitive === true;
			const pid = listener?.pid;
			const name = displayProcessName(listener?.processName, listener?.command) ?? forward?.label;
			return {
				port: draft.port,
				processName: name,
				// 命令行就是名字本身（进程改写过自己的标题）时不再重复一行。
				command: listener?.command === name ? undefined : listener?.command,
				pid,
				startedLabel:
					listener?.startedAt === undefined
						? undefined
						: formatStartedAgo(listener.startedAt, now, i18n?.language, t("activityPanel.ports.justNow")),
				startedTitle:
					listener?.startedAt === undefined
						? undefined
						: new Date(listener.startedAt).toLocaleString(i18n?.language),
				publicBind: listener !== undefined && PUBLIC_BIND_ADDRESSES.has(listener.address),
				fromOutput,
				sensitive,
				ephemeral: !fromOutput && draft.port >= EPHEMERAL_PORT_FLOOR,
				listening: listener ? true : fromOutput ? undefined : scanKnown ? false : undefined,
				forward: forward
					? {
							localPort: forward.localPort,
							localAddress: `localhost:${forward.localPort}`,
							status: forward.status,
							error: forward.error,
						}
					: undefined,
				killable: pid !== undefined && !sensitive,
				needsForceKill: pid !== undefined && stubbornPids.has(pid),
			};
		});
	}, [detectedPorts, forwards, i18n?.language, listeners, now, scanState, stubbornPids, t]);

	return {
		rows,
		scanState,
		scanError,
		labels,
		draftRemotePort,
		draftLocalPort,
		errorMessage,
		copiedPort,
		editingRemotePort,
		editingLocalPort,
		terminatingPort,
		onDraftRemotePortChange: setDraftRemotePort,
		onDraftLocalPortChange: setDraftLocalPort,
		onAddDraftPort,
		onForward: (port) => {
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
		onTerminate: (port) => void onTerminate(port),
		onRefresh: () => void runScan(),
	};
}
