import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useMemo, useState } from "react";
import { useNotesHandoff } from "../notes/handoff";
import type { NotesStore } from "../notes/notes-store";
import { type DesignNote, pendingNotes, resolvedNotes } from "../notes/types";
import type { DesignSession } from "../vetd/design-session";
import { NoteAvatar } from "./NoteAvatar";

interface NotesDrawerProps {
	store: NotesStore;
	session: DesignSession;
	cwd: string | null;
	/** 点条目：视口居中到气泡并打开 thread（重开也走这条路——在 thread 里补一句）。 */
	onLocate(noteId: string): void;
	onClose(): void;
}

/**
 * 右侧备注抽屉：待处理/已处理两段、让 Vetta 处理（全部/单条）、清空已处理。
 * 宽度限死不推挤画布（画布本来就吃宽度），关掉即恢复。
 */
export function NotesDrawer({ store, session, cwd, onLocate, onClose }: NotesDrawerProps) {
	const { t } = useTranslation();
	const handoff = useNotesHandoff(cwd);
	const [, setVersion] = useState(0);
	useEffect(() => {
		const handle = store.on(() => setVersion((value) => value + 1));
		return () => handle.dispose();
	}, [store]);
	// frame 标题跟着 manifest 变（重命名、删除）。
	const [, setManifestVersion] = useState(0);
	useEffect(() => {
		const handle = session.on((change) => {
			if (change === "frames") setManifestVersion((value) => value + 1);
		});
		return () => handle.dispose();
	}, [session]);

	const pending = pendingNotes(store.notes);
	const resolved = resolvedNotes(store.notes);

	const frameTitleOf = useMemo(() => {
		const map = new Map(session.manifest.frames.map((frame) => [frame.id, frame.title || frame.id]));
		return (note: DesignNote): string => {
			if (note.anchor.kind === "free") {
				return note.anchor.detachedFrom ? t("notes.drawer.detached") : t("notes.drawer.freeNote");
			}
			return map.get(note.anchor.frameId) ?? note.anchor.frameId;
		};
	}, [session.manifest.frames, t]);

	return (
		// 悬浮而非贴边：画布是无限的，抽屉贴死右边缘会读成「面板被截断了」。
		<div className="vetd-note vetd-note-drawer-enter pointer-events-auto absolute inset-y-3 right-3 z-40 flex w-72 flex-col overflow-hidden rounded-2xl border border-border/70 bg-popover/95 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl">
			<header className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
				<span className="text-xs font-semibold text-foreground">{t("notes.drawer.title")}</span>
				{pending.length > 0 ? (
					<span
						className="rounded-full px-1.5 py-px text-[10px] font-semibold leading-4 text-white"
						style={{ background: "var(--vetd-note-pending, #2563eb)" }}
					>
						{pending.length}
					</span>
				) : null}
				<button
					type="button"
					title={t("notes.close")}
					aria-label={t("notes.close")}
					onClick={onClose}
					className="ml-auto flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					<svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
						<path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
					</svg>
				</button>
			</header>

			{pending.length > 0 ? (
				<div className="border-b border-border/60 px-2.5 py-2">
					<button
						type="button"
						disabled={handoff.blockedReason !== null}
						title={handoff.blockedReason ?? undefined}
						onClick={() => handoff.sendAll(pending.length)}
						className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-45"
					>
						<svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
							<path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
						{t("notes.handle.all")}
					</button>
					{handoff.blockedReason !== null ? (
						<p className="pt-1.5 text-center text-[10px] text-muted-foreground">{handoff.blockedReason}</p>
					) : null}
				</div>
			) : null}

			<div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
				{store.notes.length === 0 ? (
					<div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
						<svg
							viewBox="0 0 24 24"
							className="size-7 text-muted-foreground opacity-40"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							aria-hidden
						>
							<path
								d="M21 11.5a8.5 8.5 0 01-8.5 8.5H4l1.6-3.2A8.5 8.5 0 1121 11.5z"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
						<p className="text-xs leading-relaxed text-muted-foreground">{t("notes.drawer.empty")}</p>
					</div>
				) : null}

				{pending.length > 0 ? (
					<>
						<SectionLabel text={t("notes.drawer.pending", { count: pending.length })} />
						{pending.map((note, index) => (
							<NoteRow
								key={note.id}
								note={note}
								number={index + 1}
								location={frameTitleOf(note)}
								onLocate={() => onLocate(note.id)}
								onHandle={handoff.blockedReason === null ? () => handoff.sendOne(note.id) : null}
								onDelete={() => store.deleteNote(note.id)}
							/>
						))}
					</>
				) : null}

				{resolved.length > 0 ? (
					<>
						<div className="flex items-center justify-between px-1 pb-1 pt-3">
							<SectionLabel text={t("notes.drawer.resolved", { count: resolved.length })} bare />
							<button
								type="button"
								onClick={() => store.clearResolved()}
								className="rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							>
								{t("notes.drawer.clearResolved")}
							</button>
						</div>
						{resolved.map((note) => (
							<NoteRow
								key={note.id}
								note={note}
								number={null}
								location={frameTitleOf(note)}
								onLocate={() => onLocate(note.id)}
								onHandle={null}
								onDelete={() => store.deleteNote(note.id)}
							/>
						))}
					</>
				) : null}
			</div>
		</div>
	);
}

function SectionLabel({ text, bare }: { text: string; bare?: boolean }) {
	return (
		<span
			className={`block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ${
				bare ? "" : "px-1 pb-1 pt-1"
			}`}
		>
			{text}
		</span>
	);
}

function NoteRow({
	note,
	number,
	location,
	onLocate,
	onHandle,
	onDelete,
}: {
	note: DesignNote;
	/** 待处理的编号（与气泡一致）；已处理为 null。 */
	number: number | null;
	location: string;
	onLocate(): void;
	onHandle: (() => void) | null;
	onDelete(): void;
}) {
	const { t } = useTranslation();
	const excerpt = note.messages[0]?.text ?? "";
	const lastAgent = [...note.messages].reverse().find((message) => message.author === "agent");
	const resolved = number === null;

	return (
		<div
			className={`group relative mb-1.5 overflow-hidden rounded-xl border transition-colors ${
				resolved
					? "border-border/40 bg-muted/20 hover:border-border/70 hover:bg-muted/40"
					: "border-border/60 bg-card/60 hover:border-border hover:bg-accent/40"
			}`}
		>
			{/* 左侧状态色条：不占布局宽度，扫一眼就能分出两段。 */}
			<span
				className="absolute inset-y-0 left-0 w-[3px]"
				style={{
					background: resolved ? "var(--vetd-note-resolved, #10b981)" : "var(--vetd-note-pending, #2563eb)",
					opacity: resolved ? 0.5 : 1,
				}}
				aria-hidden
			/>
			<button type="button" onClick={onLocate} className="flex w-full items-start gap-2 px-2.5 py-2 text-left">
				<span className="relative mt-0.5 shrink-0">
					<NoteAvatar author={resolved ? "agent" : "user"} size={20} />
					{!resolved ? (
						<span
							className="absolute -right-1 -top-1 flex min-w-[13px] items-center justify-center rounded-full px-[3px] text-[9px] font-semibold leading-[13px] text-white"
							style={{ background: "var(--vetd-note-pending, #2563eb)" }}
						>
							{number}
						</span>
					) : null}
				</span>
				<span className="min-w-0 flex-1">
					<span className={`block text-xs leading-snug ${resolved ? "text-muted-foreground" : "text-foreground"} line-clamp-2`}>
						{excerpt}
					</span>
					{lastAgent ? (
						<span className="mt-1 flex items-start gap-1 text-[10px] leading-snug text-muted-foreground">
							<span className="shrink-0 font-medium">Vetta</span>
							<span className="min-w-0 flex-1 truncate">{lastAgent.text}</span>
						</span>
					) : null}
					<span className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground/80">
						<svg viewBox="0 0 24 24" className="size-2.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
							<path d="M6 2v20M18 2v20M2 6h20M2 18h20" strokeLinecap="round" />
						</svg>
						<span className="truncate">{location}</span>
					</span>
				</span>
			</button>
			{/* 行内动作：hover 才出，平时不与内容抢注意力。 */}
			<div className="absolute bottom-1.5 right-1.5 hidden items-center gap-0.5 rounded-lg border border-border/60 bg-popover/95 p-0.5 shadow-sm backdrop-blur group-hover:flex">
				{onHandle ? (
					<button
						type="button"
						title={t("notes.handle.one")}
						onClick={onHandle}
						className="rounded-md px-1.5 py-0.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/10"
					>
						{t("notes.handle.one")}
					</button>
				) : null}
				<button
					type="button"
					title={t("notes.delete")}
					aria-label={t("notes.delete")}
					onClick={onDelete}
					className="flex size-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
				>
					<svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
						<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</button>
			</div>
		</div>
	);
}
