import { CanvasAddon } from "@xterm/addon-canvas";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { pathBasename } from "@shared/lib/utils";
import { type JSX, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TerminalEventEnvelope } from "../../../../shared/terminal-ipc";
import { useBottomPanelInstance } from "../registry/instance-context";
import { detectWebgl2Support, selectTerminalRenderer } from "./select-terminal-renderer";
import { buildTerminalTheme, createDocumentCssVariableReader } from "./terminal-theme";

/** xterm 自己的回滚历史；主进程那份尾部缓冲只负责补断连期间的输出，不是历史。 */
const SCROLLBACK = 5000;

/** 快照写盘的防抖窗口。输出一停就存，不跟着每一帧走。 */
const SNAPSHOT_DEBOUNCE_MS = 2000;

/** 快照只留最近这么多行：再多也没人翻，只是让每次写盘更贵。 */
const SNAPSHOT_SCROLLBACK = 1000;

type Status = "starting" | "running" | "exited" | "unavailable";

/**
 * 终端面板的内容组件。
 *
 * 这里是整个功能里唯一持有 xterm 实例的地方，因此不拆「连接层 / 展示层」：
 * xterm 是命令式 DOM 对象，它的生命周期、尺寸测量和 IPC 接线是同一件事，
 * 拆开只会让「谁在什么时候 fit」这个真正易错的点散到两个文件里。
 */
export function TerminalSurface(): JSX.Element {
	const { t } = useTranslation("chat");
	const handle = useBottomPanelInstance();
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [status, setStatus] = useState<Status>("starting");
	const [message, setMessage] = useState<string | null>(null);
	const [degradedNoResize, setDegradedNoResize] = useState(false);

	const { cwd, tabId, active } = handle;
	// effect 里要用到最新的 handle 方法，但不希望它们变化就重建终端。
	const handleRef = useRef(handle);
	handleRef.current = handle;
	const activeRef = useRef(active);
	activeRef.current = active;
	/** 由建终端的 effect 填上；折叠期间跳过的尺寸变化靠它在展开后补一次。 */
	const refitRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container || !cwd) return;

		let disposed = false;
		let terminalId: string | null = null;
		let contextLost = false;
		const cleanups: Array<() => void> = [];

		const terminal = new Terminal({
			allowProposedApi: true,
			cursorBlink: true,
			fontSize: 12,
			fontFamily: getComputedStyle(container).getPropertyValue("--font-mono") || "monospace",
			lineHeight: 1.2,
			macOptionIsMeta: true,
			scrollback: SCROLLBACK,
			theme: buildTerminalTheme(createDocumentCssVariableReader(document.documentElement)),
		});
		const fit = new FitAddon();
		terminal.loadAddon(fit);
		const serialize = new SerializeAddon();
		terminal.loadAddon(serialize);
		terminal.loadAddon(new WebLinksAddon());
		const unicode = new Unicode11Addon();
		terminal.loadAddon(unicode);
		// 不开 unicode11 的话 CJK 宽度按 1 算，中文一多光标位置就全错。
		terminal.unicode.activeVersion = "11";
		terminal.open(container);

		const renderer = selectTerminalRenderer({
			hasWebgl2: detectWebgl2Support(),
			hardwareAccelerated: true,
			isActiveLeaf: activeRef.current,
			contextLost,
		});
		if (renderer === "webgl") {
			const webgl = new WebglAddon();
			// 丢上下文不处理的话整个终端永久黑屏，必须当场降级。
			webgl.onContextLoss(() => {
				contextLost = true;
				webgl.dispose();
				if (!disposed) terminal.loadAddon(new CanvasAddon());
			});
			terminal.loadAddon(webgl);
		} else {
			terminal.loadAddon(new CanvasAddon());
		}

		/** 只有容器有真实尺寸时才 fit：折叠时容器高度是 0，fit 会算出 0 行并抛。 */
		const fitIfMeasurable = (): { cols: number; rows: number } | null => {
			const rect = container.getBoundingClientRect();
			if (rect.width < 8 || rect.height < 8) return null;
			fit.fit();
			return { cols: terminal.cols, rows: terminal.rows };
		};

		const themeObserver = new MutationObserver(() => {
			terminal.options.theme = buildTerminalTheme(createDocumentCssVariableReader(document.documentElement));
		});
		themeObserver.observe(document.documentElement, { attributeFilter: ["data-mode", "data-theme"] });
		cleanups.push(() => themeObserver.disconnect());

		let snapshotTimer: number | undefined;
		const flushSnapshot = (): void => {
			if (snapshotTimer !== undefined) {
				window.clearTimeout(snapshotTimer);
				snapshotTimer = undefined;
			}
			try {
				void window.vetta.terminal.saveSnapshot(tabId, serialize.serialize({ scrollback: SNAPSHOT_SCROLLBACK }));
			} catch {
				// 快照是尽力而为的：存不上只是下次回来终端是空的，不该影响使用。
			}
		};
		const scheduleSnapshot = (): void => {
			if (snapshotTimer !== undefined) window.clearTimeout(snapshotTimer);
			snapshotTimer = window.setTimeout(flushSnapshot, SNAPSHOT_DEBOUNCE_MS);
		};
		// 卸载与页面关闭都要补一次：防抖窗口内卸载会把最后一段输出丢掉。
		window.addEventListener("beforeunload", flushSnapshot);
		cleanups.push(() => {
			window.removeEventListener("beforeunload", flushSnapshot);
			flushSnapshot();
		});

		void (async () => {
			try {
				// 先回放上次的输出，再接新进程：顺序反了用户会以为回放内容是活的。
				const snapshot = await window.vetta.terminal.loadSnapshot(tabId);
				if (disposed) return;
				if (snapshot) {
					terminal.write(snapshot);
					terminal.writeln(`\r\n${t("bottomPanel.terminal.previousOutput")}`);
				}
				const size = fitIfMeasurable() ?? { cols: terminal.cols, rows: terminal.rows };
				const result = await window.vetta.terminal.open({ cwd, cols: size.cols, rows: size.rows });
				if (disposed) {
					void window.vetta.terminal.close(result.terminalId);
					return;
				}
				terminalId = result.terminalId;
				if (result.replayTruncated) terminal.writeln(t("bottomPanel.terminal.replayTruncated"));
				if (result.replay) terminal.write(result.replay);
				if (result.degraded?.noResize) setDegradedNoResize(true);
				setStatus("running");

				cleanups.push(
					window.vetta.terminal.onEvent((envelope: TerminalEventEnvelope) => {
						if (envelope.terminalId !== terminalId) return;
						const event = envelope.event;
						if (event.kind === "data") {
							terminal.write(event.data);
							scheduleSnapshot();
							return;
						}
						if (event.kind === "state") {
							handleRef.current.setMeta({ status: event.busy ? "active" : "idle" });
							return;
						}
						if (event.kind === "exit") {
							setStatus("exited");
							handleRef.current.setMeta({ status: "idle" });
							handleRef.current.setCloseGuard(null);
							terminal.writeln(`\r\n${t("bottomPanel.terminal.exited", { code: event.exitCode ?? 0 })}`);
							flushSnapshot();
							return;
						}
						setMessage(event.message);
					}),
				);

				const inputSubscription = terminal.onData((data) => {
					if (terminalId) void window.vetta.terminal.write(terminalId, data);
				});
				cleanups.push(() => inputSubscription.dispose());

				// 有活进程时关闭要先确认；空闲时把守卫撤掉，免得每次关都问一遍。
				handleRef.current.setCloseGuard(async () => {
					if (!terminalId) return true;
					const foreground = await window.vetta.terminal.foregroundProcess(terminalId);
					if (!foreground) return true;
					return {
						title: t("bottomPanel.terminal.closeConfirm.title"),
						message: t("bottomPanel.terminal.closeConfirm.message", { process: foreground }),
						confirmLabel: t("bottomPanel.terminal.closeConfirm.confirm"),
						destructive: true,
					};
				});
			} catch (error) {
				if (disposed) return;
				setStatus("unavailable");
				setMessage(error instanceof Error ? error.message : String(error));
			}
		})();

		const applyFit = (): void => {
			const size = fitIfMeasurable();
			if (size && terminalId) void window.vetta.terminal.resize(terminalId, size.cols, size.rows);
		};
		refitRef.current = applyFit;
		cleanups.push(() => {
			if (refitRef.current === applyFit) refitRef.current = null;
		});

		const observer = new ResizeObserver(applyFit);
		observer.observe(container);
		cleanups.push(() => observer.disconnect());

		return () => {
			disposed = true;
			for (const cleanup of cleanups) cleanup();
			if (terminalId) void window.vetta.terminal.close(terminalId);
			terminal.dispose();
		};
	}, [cwd, tabId, t]);

	// 名字随 cwd 走：同一会话里开多个终端时，按目录区分比都叫「终端」有用。
	useEffect(() => {
		const label = cwd ? pathBasename(cwd) : "";
		handleRef.current.setMeta({ label: label || t("bottomPanel.terminal.title") });
	}, [cwd, tabId, t]);

	// 重新成为活动格时补一次 fit：折叠期间容器高度是 0，那段时间的尺寸变化都被跳过了。
	useEffect(() => {
		if (!active) return;
		const frame = requestAnimationFrame(() => refitRef.current?.());
		return () => cancelAnimationFrame(frame);
	}, [active]);

	return (
		<div className="relative flex min-h-0 flex-1 flex-col">
			{/* 内边距放在终端容器自己身上，而不是外面包一层留白：xterm 按容器尺寸算行列，
			    外边距会让面板底色在终端四周露出一圈，看着像终端没铺满。 */}
			<div ref={containerRef} className="min-h-0 flex-1 px-2 py-1.5" data-terminal-surface={tabId} />
			{status === "unavailable" ? (
				<p className="px-3 pb-2 text-[12px] text-destructive">
					{message ?? t("bottomPanel.terminal.unavailable")}
				</p>
			) : null}
			{degradedNoResize ? (
				<p className="px-3 pb-2 text-[11px] text-muted-foreground">{t("bottomPanel.terminal.noResize")}</p>
			) : null}
		</div>
	);
}
