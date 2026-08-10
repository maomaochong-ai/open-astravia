/**
 * 选框右上角的追问徽标与它的 popover。
 *
 * 选中画框或画框里的元素之后，指令就在选框边上写完发出去——不必再把视线和焦点挪
 * 到画布外的 AI 输入框。
 *
 * 两种提交都落成画布备注，区别只在于「什么时候把 agent 叫过来」：
 * - ask：立刻发一条消息，附件里带上这条备注的 id，agent 做完 resolve 它。
 * - note：只落盘，等 agent 自己收尾自检时来取。用在它正忙（或没有可用会话）的时候
 *   ——备注的被动特性于是成了「延迟指令」，不打断它这一轮。
 *
 * 统一落成备注还有一个好处：agent 的回复通过 vetd_notes 落回气泡 thread，追问的结果
 * 显示在它被提出的那个位置，而不是只躺在聊天记录里。
 */

import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NotesStore } from "../notes/notes-store";
import { getPluginCtx, notify } from "../plugin-context";
import type { DesignSession } from "../vetd/design-session";
import type { VetdFrameEntry } from "../vetd/manifest-types";
import type { CanvasSelection } from "./DesignCanvas";
import { INVERSE_SCALE, NoteComposer, NotePanel, stopAll } from "./NoteSurface";
import {
	type AskMode,
	type AskTarget,
	askBadgePlacement,
	askBadgePoint,
	askNoteAnchor,
	askPopoverPoint,
	askTarget,
	resolveAskMode,
} from "./selection-ask";
import { createDesignSelectionPromptAttachment } from "./selection-prompt-context";

/**
 * 点发送时截图还没落盘就最多等这么久。超时照发不误——附件里的 instructions 已经
 * 交代了 agent 可以自己 `vetd_screenshot`，为一张锦上添花的图卡住发送不划算。
 */
const SCREENSHOT_WAIT_MS = 2_000;

interface SelectionAskBadgeProps {
	session: DesignSession;
	notes: NotesStore;
	selection: CanvasSelection;
	frames: readonly VetdFrameEntry[];
	/** 抗噪条件由画布算好（拖动/缩放/平移/预览期间收起），这里只管画。 */
	visible: boolean;
	/** null = 可以发送；否则是禁用原因（已本地化），徽标据此降级为备注入口。 */
	blockedReason: string | null;
	capture(frameId: string, options?: { keepHighlight?: boolean }): Promise<string>;
	open: boolean;
	onOpenChange(open: boolean): void;
	/** 提交完成（两种提交都落了备注）。画布据此收起选中。 */
	onSubmitted(): void;
}

export function SelectionAskBadge({
	session,
	notes,
	selection,
	frames,
	visible,
	blockedReason,
	capture,
	open,
	onOpenChange,
	onSubmitted,
}: SelectionAskBadgeProps) {
	const { t } = useTranslation();
	const target = useMemo(() => askTarget(selection, frames), [selection, frames]);

	/**
	 * 下面这些都用 ref 读。popover 开着的时候画布还在动（agent 改代码、用户平移），
	 * 把它们放进 effect 依赖会让「打开那一刻冻结」的截图与身份被反复重算。
	 */
	const targetRef = useRef(target);
	targetRef.current = target;
	const selectionRef = useRef(selection);
	selectionRef.current = selection;
	const framesRef = useRef(frames);
	framesRef.current = frames;
	const blockedRef = useRef(blockedReason);
	blockedRef.current = blockedReason;
	const captureRef = useRef(capture);
	captureRef.current = capture;
	const sessionRef = useRef(session);
	sessionRef.current = session;

	/** popover 弹出那一刻定下的身份与禁用原因，全程不随 streaming 翻转。 */
	const [mode, setMode] = useState<AskMode>("ask");
	const [frozenReason, setFrozenReason] = useState<string | null>(null);
	/** 本次打开的截图（路径，失败为 null）。发送时等它，取消时删它。 */
	const screenshotRef = useRef<Promise<string | null> | null>(null);
	const sentRef = useRef(false);

	useEffect(() => {
		if (!open) return;
		const opened = targetRef.current;
		if (!opened) return;
		const reason = blockedRef.current;
		const openedMode = resolveAskMode(reason);
		setMode(openedMode);
		setFrozenReason(reason);
		sentRef.current = false;
		// 备注不带截图：agent 读备注时 vetd_notes 会现截一张带编号标注的。
		if (openedMode !== "ask") return;

		const pending = (async (): Promise<string | null> => {
			try {
				const dataUrl = await captureRef.current(opened.frameId, { keepHighlight: opened.kind === "element" });
				const base64 = dataUrl.split(",")[1] ?? "";
				const path = `${sessionRef.current.dirPath}/.snapshots/ask-${opened.frameId}-${Date.now()}.png`;
				await getPluginCtx().fs.writeFile(path, base64, "base64");
				return path;
			} catch (error) {
				// 截图只是给附件加料，失败了照发（agent 还能自己 vetd_screenshot），
				// 所以不打扰用户，只留一条诊断。
				console.warn("[plugin:vetta-ui-design] ask screenshot failed", error);
				return null;
			}
		})();
		screenshotRef.current = pending;

		return () => {
			screenshotRef.current = null;
			// 点开又关掉的截图是孤儿，删掉；真发出去的必须留着——agent 随时会去 Read
			// 那个路径。
			void pending.then((path) => {
				if (!path || sentRef.current) return;
				void getPluginCtx().fs.delete(path).catch(() => {});
			});
		};
		// biome-ignore lint/correctness/useExhaustiveDependencies: 依赖只能是 open。
		// 「打开那一刻冻结」必须名副其实：capture / session 的引用一变就重跑的话，
		// 用户正在写备注时 agent 收了工，身份会被悄悄掀翻成发送，一个回车就打断了它。
	}, [open]);

	/** 输入框上方那行凭证，也是附件的 label。 */
	const describe = (current: AskTarget): { label: string; labels: string[] } => {
		const frame = framesRef.current.find((candidate) => candidate.id === current.frameId);
		const name = frame?.title || current.frameId;
		const element = selectionRef.current?.kind === "dom" ? selectionRef.current.payload : null;
		if (element) {
			return { label: t("canvas.attach.element", { tag: element.tag, name }), labels: [name, `<${element.tag}>`] };
		}
		return { label: name, labels: [name] };
	};

	const sendAsk = (text: string, current: AskTarget, noteId: string): void => {
		sentRef.current = true;
		const pending = screenshotRef.current;
		void (async () => {
			const path = await Promise.race([
				pending ?? Promise.resolve(null),
				new Promise<null>((resolve) => {
					window.setTimeout(() => resolve(null), SCREENSHOT_WAIT_MS);
				}),
			]);
			const frame = framesRef.current.find((candidate) => candidate.id === current.frameId);
			if (!frame) return;
			const selected = selectionRef.current;
			const { label, labels } = describe(current);
			const attachment = createDesignSelectionPromptAttachment({
				noteId,
				vetdPath: session.vetdPath,
				dirPath: session.dirPath,
				frames: [frame],
				element: selected?.kind === "dom" ? { frameId: selected.frameId, payload: selected.payload } : null,
				screenshot: path ? { frameId: current.frameId, path } : null,
				label,
				labels,
			});
			if (!attachment) return;
			// 宿主的发送路径同步读 promptAttachment，所以挂载必须紧贴 sendPrompt 之前；
			// 附件是一次性的，发完宿主自己清掉。
			getPluginCtx().ui.setPromptAttachment(attachment);
			// sendPrompt 要整轮跑完才 resolve，不 await；发送失败单独报（与备注交接同型）。
			getPluginCtx()
				.conversation.sendPrompt(text)
				.catch((error: unknown) => notify({ message: t("canvas.ask.failed"), error }));
		})();
	};

	const submit = (text: string): void => {
		const current = targetRef.current;
		if (!current) return;
		/**
		 * 两条路都落成备注：画布上的每一条指令都留下痕迹，agent 的回复也就有地方回来
		 * ——追问的结果显示在它被提出的那个位置，而不是只躺在聊天记录里。ask 与 note
		 * 的唯一区别是前者立刻发一条消息把 agent 叫过来，后者等它自己收尾时来取。
		 */
		const note = notes.addNote(askNoteAnchor(selectionRef.current, current), text);
		if (mode === "ask") {
			// 这条已经亲手交出去了，向 store 报备，免得自动派活器等下又派一次。
			notes.markDispatched([note]);
			sendAsk(text, current, note.id);
		}
		onSubmitted();
	};

	if (!target) return null;
	const point = askBadgePoint(target);
	const popover = askPopoverPoint(target);
	// 徽标未打开时跟着实时闸口走（agent 一开跑就变成备注入口）；打开后由冻结的 mode 接管。
	const badgeMode = open ? mode : resolveAskMode(blockedReason);
	/**
	 * 钉点是选框右上角。transformOrigin 归零、位移写在 scale 右边：这样 translate
	 * 落在缩放后的坐标系里，徽标在任何画布缩放下都严丝合缝贴着选框角。
	 */
	const badgeTransform =
		askBadgePlacement(target) === "above"
			? `scale(${INVERSE_SCALE}) translate(-100%, calc(-100% - 4px))`
			: `scale(${INVERSE_SCALE}) translate(calc(-100% - 4px), 4px)`;

	return (
		<>
			{visible ? (
				<button
					type="button"
					className="pointer-events-auto absolute z-30 flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-full bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground shadow-lg ring-1 ring-black/10 transition-opacity hover:opacity-90"
					style={{ left: point.x, top: point.y, transform: badgeTransform, transformOrigin: "0 0" }}
					onPointerDown={stopAll}
					onPointerMove={stopAll}
					onPointerUp={stopAll}
					onClick={() => onOpenChange(!open)}
				>
					<BadgeIcon mode={badgeMode} />
					{t(badgeMode === "ask" ? "canvas.ask.badge" : "canvas.ask.badge.note")}
				</button>
			) : null}

			{open ? (
				<NotePanel x={popover.x} y={popover.y}>
					<header className="flex items-center gap-1.5 border-b border-border/60 px-2.5 py-2">
						<BadgeIcon mode={mode} />
						<span className="truncate text-[11px] font-medium text-foreground">{describe(target).label}</span>
					</header>
					{/* 降级成备注是有原因的（agent 在跑 / 没有会话 / 不在这个 workspace），
					    不说一声用户只会觉得发送按钮无端变了样。 */}
					{mode === "note" && frozenReason ? (
						<p className="border-b border-border/60 px-2.5 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
							{frozenReason} · {t("canvas.ask.note.hint")}
						</p>
					) : null}
					<div className="p-1.5">
						<NoteComposer
							placeholder={t(mode === "ask" ? "canvas.ask.placeholder" : "canvas.ask.note.placeholder")}
							submitLabel={t(mode === "ask" ? "canvas.ask.submit" : "canvas.ask.note.submit")}
							onCancel={() => onOpenChange(false)}
							onSubmit={submit}
						/>
					</div>
				</NotePanel>
			) : null}
		</>
	);
}

function BadgeIcon({ mode }: { mode: AskMode }) {
	return (
		<svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			{mode === "ask" ? (
				<path d="M5 3v4M3 5h4M6 17v4m-2-2h4M13 3l2.5 6.5L22 12l-6.5 2.5L13 21l-2.5-6.5L4 12l6.5-2.5L13 3z" strokeLinecap="round" strokeLinejoin="round" />
			) : (
				<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round" />
			)}
		</svg>
	);
}
