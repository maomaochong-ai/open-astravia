import { useTranslation } from "@vetta-org/plugin-sdk";
import {
	type FormEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useNotesHandoff } from "../notes/handoff";
import type { NotesStore } from "../notes/notes-store";
import { type DesignNote, noteStatus, noteWorldPosition, pendingNotes } from "../notes/types";
import type { VetdFrameEntry } from "../vetd/manifest-types";
import type { SelectedElementPayload } from "./bridge-client";

/** 拖动阈值（屏幕像素）：低于它算点击（开 thread），高于它算拖动气泡。 */
const DRAG_THRESHOLD_PX = 3;

/** 备注放置的草稿：点了画布、还没提交。hit 是后台 hit-test，提交时不等它。 */
export interface NoteDraft {
	world: { x: number; y: number };
	/** 落点命中的 frame；null = 自由备注。 */
	frameId: string | null;
	fx: number;
	fy: number;
	hit: Promise<SelectedElementPayload | null> | null;
}

interface NotesLayerProps {
	store: NotesStore;
	frames: readonly VetdFrameEntry[];
	/** select/note 工具下气泡可点；托手/空格/frame 工具下整层不吃指针。 */
	interactive: boolean;
	cwd: string | null;
	draft: NoteDraft | null;
	onDraftClose(): void;
	openNoteId: string | null;
	onOpenNote(id: string | null): void;
	/** 指针位移换算成世界位移用（与 FrameView 同型，不把 zoom 当 prop）。 */
	getZoom(): number;
}

const INVERSE_SCALE = "var(--vetd-lscale, 1)";

function stopAll(event: ReactPointerEvent): void {
	event.stopPropagation();
}

/**
 * 画布层的备注：气泡、放置草稿的输入框、点开后的 thread 弹层。挂在 world 变换里
 * （跟着画布平移缩放），自身按 `--vetd-lscale` 反向缩放保持恒定视觉大小——与
 * frame 标题栏、整理工具条同一套办法。截图截不到这一层（它不在 iframe 文档里），
 * 这正是「例行截图保持干净」的实现方式；标注图由 notes/annotate.ts 二次合成。
 */
export function NotesLayer({
	store,
	frames,
	interactive,
	cwd,
	draft,
	onDraftClose,
	openNoteId,
	onOpenNote,
	getZoom,
}: NotesLayerProps) {
	const { t } = useTranslation();
	const handoff = useNotesHandoff(cwd);
	const [version, setVersion] = useState(0);
	useEffect(() => {
		const handle = store.on(() => setVersion((value) => value + 1));
		return () => handle.dispose();
	}, [store]);

	const frameOf = useMemo(() => {
		const map = new Map(frames.map((frame) => [frame.id, frame]));
		return (frameId: string) => map.get(frameId);
	}, [frames]);

	/**
	 * frame 消失（删除/重命名）→ 锚在它上面的备注降级为自由备注。lastRects 记住
	 * 每个 frame 最后一次已知的位置，降级时用它换算回世界坐标。
	 */
	const lastRectsRef = useRef(new Map<string, { x: number; y: number }>());
	// version 在 deps 里：store 异步 load 完成后才发现的悬空备注也要走这一遭。
	useEffect(() => {
		const alive = new Set(frames.map((frame) => frame.id));
		const dangling = new Set<string>();
		for (const note of store.notes) {
			if (note.anchor.kind !== "free" && !alive.has(note.anchor.frameId)) dangling.add(note.anchor.frameId);
		}
		for (const frameId of dangling) store.demoteFrame(frameId, lastRectsRef.current.get(frameId) ?? null);
		for (const frame of frames) lastRectsRef.current.set(frame.id, { x: frame.x, y: frame.y });
	}, [frames, store, version]);

	const pending = pendingNotes(store.notes);
	const numberOf = useMemo(() => new Map(pending.map((note, index) => [note.id, index + 1])), [pending]);

	/** 拖动中的气泡：id + 世界位移（提交前只改本地渲染）。 */
	const [dragDelta, setDragDelta] = useState<{ id: string; dx: number; dy: number } | null>(null);

	const beginBubbleDrag = (note: DesignNote, event: ReactPointerEvent<HTMLButtonElement>): void => {
		if (event.button !== 0) return;
		event.stopPropagation();
		const target = event.currentTarget;
		target.setPointerCapture(event.pointerId);
		const start = { x: event.clientX, y: event.clientY };
		let moved = false;

		const onMove = (move: PointerEvent): void => {
			const dx = move.clientX - start.x;
			const dy = move.clientY - start.y;
			if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
			moved = true;
			const zoom = getZoom();
			setDragDelta({ id: note.id, dx: dx / zoom, dy: dy / zoom });
		};
		const onUp = (up: PointerEvent): void => {
			target.removeEventListener("pointermove", onMove);
			target.removeEventListener("pointerup", onUp);
			target.removeEventListener("pointercancel", onUp);
			if (!moved) {
				onOpenNote(openNoteId === note.id ? null : note.id);
				return;
			}
			const zoom = getZoom();
			const dx = (up.clientX - start.x) / zoom;
			const dy = (up.clientY - start.y) / zoom;
			setDragDelta(null);
			if (note.anchor.kind === "free") {
				store.moveNote(note.id, { x: note.anchor.x + dx, y: note.anchor.y + dy });
			} else {
				store.moveNote(note.id, { x: note.anchor.fx + dx, y: note.anchor.fy + dy });
			}
		};
		target.addEventListener("pointermove", onMove);
		target.addEventListener("pointerup", onUp);
		target.addEventListener("pointercancel", onUp);
	};

	const openNote = openNoteId ? store.noteById(openNoteId) : undefined;

	return (
		<div className={interactive ? "contents" : "pointer-events-none contents"}>
			{store.notes.map((note) => {
				const base = noteWorldPosition(note, frameOf);
				const delta = dragDelta?.id === note.id ? dragDelta : null;
				const pos = delta ? { x: base.x + delta.dx, y: base.y + delta.dy } : base;
				const resolved = noteStatus(note) === "resolved";
				const detached = note.anchor.kind === "free" && note.anchor.detachedFrom;
				const number = numberOf.get(note.id);
				return (
					<button
						key={note.id}
						type="button"
						title={detached ? t("notes.bubble.detached") : (note.messages[0]?.text ?? "")}
						aria-label={t("notes.bubble.label")}
						onPointerDown={(event) => beginBubbleDrag(note, event)}
						onPointerMove={stopAll}
						onPointerUp={stopAll}
						// 气泡尖角钉在锚点上：整体上移一个自身高，origin 定在左下。
						className={`absolute z-30 flex items-center justify-center rounded-full rounded-bl-[3px] border shadow-md transition-opacity ${
							interactive ? "pointer-events-auto" : "pointer-events-none"
						} ${
							resolved
								? "size-5 border-border bg-muted text-muted-foreground opacity-60 hover:opacity-90"
								: "size-7 border-white/70 bg-[var(--vetd-accent,#6366f1)] text-white"
						}`}
						style={{
							left: pos.x,
							top: pos.y,
							transform: `translateY(-100%) scale(${INVERSE_SCALE})`,
							transformOrigin: "left bottom",
						}}
					>
						{resolved ? (
							<svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
								<path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
						) : (
							<span className="text-[11px] font-semibold tabular-nums">{number}</span>
						)}
					</button>
				);
			})}

			{draft ? (
				<NotePanel x={draft.world.x} y={draft.world.y}>
					<NoteComposer
						placeholder={t("notes.composer.placeholder")}
						submitLabel={t("notes.composer.submit")}
						onCancel={onDraftClose}
						onSubmit={(text) => {
							const anchor =
								draft.frameId !== null
									? ({ kind: "frame", frameId: draft.frameId, fx: draft.fx, fy: draft.fy } as const)
									: ({ kind: "free", x: draft.world.x, y: draft.world.y } as const);
							const created = store.addNote(anchor, text);
							// 后台 hit-test 落地就升级成元素锚；没命中/超时保持 frame 锚。
							void draft.hit?.then((payload) => {
								if (!payload) return;
								store.upgradeAnchor(created.id, {
									domPath: payload.domPath,
									tag: payload.tag,
									text: payload.text,
									classes: payload.classes,
									source: payload.source,
								});
							});
							onDraftClose();
						}}
					/>
				</NotePanel>
			) : null}

			{openNote ? (
				<NotePanel
					x={noteWorldPosition(openNote, frameOf).x + 20}
					y={noteWorldPosition(openNote, frameOf).y}
				>
					<NoteThread
						note={openNote}
						blockedReason={handoff.blockedReason}
						onHandle={() => handoff.sendOne(openNote.id)}
						onReply={(text) => store.appendMessage(openNote.id, "user", text)}
						onDelete={() => {
							onOpenNote(null);
							store.deleteNote(openNote.id);
						}}
						onClose={() => onOpenNote(null)}
					/>
				</NotePanel>
			) : null}
		</div>
	);
}

/** 世界坐标定位、反向缩放的浮层外壳（草稿输入框与 thread 弹层共用）。 */
function NotePanel({ x, y, children }: { x: number; y: number; children: ReactNode }) {
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: swallow canvas gestures under the panel
		<div
			className="pointer-events-auto absolute z-40"
			style={{ left: x, top: y, transform: `scale(${INVERSE_SCALE})`, transformOrigin: "left top" }}
			onPointerDown={stopAll}
			onPointerMove={stopAll}
			onPointerUp={stopAll}
			onKeyDown={(event) => event.stopPropagation()}
			onKeyUp={(event) => event.stopPropagation()}
		>
			<div className="w-64 rounded-xl border border-border bg-card/95 p-2 shadow-lg backdrop-blur-md">{children}</div>
		</div>
	);
}

function NoteComposer({
	placeholder,
	submitLabel,
	onSubmit,
	onCancel,
}: {
	placeholder: string;
	submitLabel: string;
	onSubmit(text: string): void;
	onCancel(): void;
}) {
	const [text, setText] = useState("");

	const submit = (event?: FormEvent): void => {
		event?.preventDefault();
		const trimmed = text.trim();
		// 空内容不落盘：直接当取消。
		if (!trimmed) {
			onCancel();
			return;
		}
		onSubmit(trimmed);
		setText("");
	};

	const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
		if (event.key === "Escape") {
			event.preventDefault();
			onCancel();
			return;
		}
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			submit();
		}
	};

	return (
		<form onSubmit={submit} className="flex flex-col gap-1.5">
			<textarea
				// biome-ignore lint/a11y/noAutofocus: 放置备注的下一步就是打字，焦点必须直达
				autoFocus
				value={text}
				onChange={(event) => setText(event.target.value)}
				onKeyDown={onKeyDown}
				placeholder={placeholder}
				rows={2}
				className="w-full resize-none rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
			/>
			<div className="flex justify-end">
				<button
					type="submit"
					className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
				>
					{submitLabel}
				</button>
			</div>
		</form>
	);
}

function NoteThread({
	note,
	blockedReason,
	onHandle,
	onReply,
	onDelete,
	onClose,
}: {
	note: DesignNote;
	blockedReason: string | null;
	onHandle(): void;
	onReply(text: string): void;
	onDelete(): void;
	onClose(): void;
}) {
	const { t } = useTranslation();
	const pending = noteStatus(note) === "pending";
	const detachedFrom = note.anchor.kind === "free" ? note.anchor.detachedFrom : undefined;

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center justify-between">
				<span className="text-[11px] font-medium text-muted-foreground">
					{pending ? t("notes.status.pending") : t("notes.status.resolved")}
					{detachedFrom ? ` · ${t("notes.bubble.detached")}` : ""}
				</span>
				<div className="flex items-center gap-0.5">
					<button
						type="button"
						title={t("notes.delete")}
						aria-label={t("notes.delete")}
						onClick={onDelete}
						className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
					>
						<svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
							<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					</button>
					<button
						type="button"
						title={t("notes.close")}
						aria-label={t("notes.close")}
						onClick={onClose}
						className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
					>
						<svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
							<path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
						</svg>
					</button>
				</div>
			</div>
			<div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
				{note.messages.map((message, index) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: 消息只追加不重排
						key={index}
						className={`rounded-lg px-2 py-1 text-xs whitespace-pre-wrap ${
							message.author === "agent" ? "bg-primary/10 text-foreground" : "bg-muted text-foreground"
						}`}
					>
						<span className="mr-1 text-[10px] font-medium text-muted-foreground">
							{message.author === "agent" ? "Vetta" : t("notes.author.user")}
						</span>
						{message.text}
					</div>
				))}
			</div>
			{pending ? (
				<button
					type="button"
					disabled={blockedReason !== null}
					title={blockedReason ?? undefined}
					onClick={onHandle}
					className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
				>
					{t("notes.handle.one")}
				</button>
			) : null}
			{blockedReason !== null && pending ? (
				<p className="text-[10px] text-muted-foreground">{blockedReason}</p>
			) : null}
			<NoteComposer
				placeholder={pending ? t("notes.reply.placeholder") : t("notes.reopen.placeholder")}
				submitLabel={pending ? t("notes.reply.submit") : t("notes.reopen.submit")}
				onCancel={onClose}
				onSubmit={onReply}
			/>
		</div>
	);
}
