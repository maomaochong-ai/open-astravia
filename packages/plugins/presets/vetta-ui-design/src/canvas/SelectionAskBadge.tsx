/**
 * 选框右上角的追问徽标与它的 popover。
 *
 * 选中画框或画框里的元素之后，指令就在选框边上写完发出去——不必再把视线和焦点挪
 * 到画布外的 AI 输入框。
 *
 * 提交只做一件事：落一条画布备注。要不要立刻把 agent 叫过来，由自动派活器按会话
 * 闲忙决定，这里不自己发消息。于是画布上的每一条指令走的都是同一条路（备注 →
 * vetd_notes → resolve 回写），agent 拿到的永远是带锚点和标注截图的备注，回复也
 * 永远回到气泡 thread 里——就在被追问的那个元素旁边。
 *
 * 徽标上的两种文案因此只是预期管理：空闲时说「让 Vetta 去做」（落下就会被派出去），
 * 忙时说「留个备注」（要等它这一轮收尾自检时才来取）。
 */

import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NotesStore } from "../notes/notes-store";
import type { VetdFrameEntry } from "../vetd/manifest-types";
import type { CanvasSelection } from "./DesignCanvas";
import {
	INVERSE_SCALE,
	NoteComposer,
	NoteIntentIcon,
	NotePanel,
	NotePanelHeader,
	NotePanelHint,
	stopAll,
} from "./NoteSurface";
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

interface SelectionAskBadgeProps {
	notes: NotesStore;
	selection: CanvasSelection;
	frames: readonly VetdFrameEntry[];
	/** 抗噪条件由画布算好（拖动/缩放/平移/预览期间收起），这里只管画。 */
	visible: boolean;
	/** null = agent 空闲，落下就会被派出去；否则是等待原因（已本地化）。 */
	blockedReason: string | null;
	open: boolean;
	onOpenChange(open: boolean): void;
	/** 提交完成（备注已落盘）。画布据此收起选中。 */
	onSubmitted(): void;
}

export function SelectionAskBadge({
	notes,
	selection,
	frames,
	visible,
	blockedReason,
	open,
	onOpenChange,
	onSubmitted,
}: SelectionAskBadgeProps) {
	const { t } = useTranslation();
	const target = useMemo(() => askTarget(selection, frames), [selection, frames]);

	/**
	 * 下面这些都用 ref 读。popover 开着的时候画布还在动（agent 改代码、用户平移），
	 * 把它们放进 effect 依赖会让「打开那一刻冻结」的文案被反复重算。
	 */
	const targetRef = useRef(target);
	targetRef.current = target;
	const selectionRef = useRef(selection);
	selectionRef.current = selection;
	const framesRef = useRef(frames);
	framesRef.current = frames;
	const blockedRef = useRef(blockedReason);
	blockedRef.current = blockedReason;

	/** popover 弹出那一刻定下的文案与等待原因，全程不随 streaming 翻转。 */
	const [mode, setMode] = useState<AskMode>("ask");
	const [frozenReason, setFrozenReason] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		const reason = blockedRef.current;
		setMode(resolveAskMode(reason));
		setFrozenReason(reason);
		// 依赖只能是 open：agent 中途收工时按钮不该当着用户的面改口。
	}, [open]);

	/** 输入框上方那行凭证。 */
	const describe = (current: AskTarget): string => {
		const frame = framesRef.current.find((candidate) => candidate.id === current.frameId);
		const name = frame?.title || current.frameId;
		const element = selectionRef.current?.kind === "dom" ? selectionRef.current.payload : null;
		return element ? t("canvas.attach.element", { tag: element.tag, name }) : name;
	};

	const submit = (text: string): void => {
		const current = targetRef.current;
		if (!current) return;
		// 只落备注。派活交给 useNotesAutoDispatch：空闲就把它交出去，忙就等 agent
		// 收尾自检时自己来取。
		notes.addNote(askNoteAnchor(selectionRef.current, current), text);
		onSubmitted();
	};

	if (!target) return null;
	const point = askBadgePoint(target);
	const popover = askPopoverPoint(target);
	// 徽标未打开时跟着实时闸口走（agent 一开跑就变成备注入口）；打开后由冻结的文案接管。
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
					<NoteIntentIcon intent={badgeMode} />
					{t(badgeMode === "ask" ? "canvas.ask.badge" : "canvas.ask.badge.note")}
				</button>
			) : null}

			{open ? (
				<NotePanel x={popover.x} y={popover.y}>
					<NotePanelHeader intent={mode} label={describe(target)} />
					{/* agent 不空闲时说明一声，否则用户只会觉得按钮无端变了样。 */}
					{mode === "note" && frozenReason ? (
						<NotePanelHint text={`${frozenReason} · ${t("canvas.ask.note.hint")}`} />
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
