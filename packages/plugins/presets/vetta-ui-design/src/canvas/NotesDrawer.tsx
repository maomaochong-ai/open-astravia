import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useMemo, useState } from "react";
import { useNotesHandoff } from "../notes/handoff";
import type { NotesStore } from "../notes/notes-store";
import { type DesignNote, pendingNotes, resolvedNotes } from "../notes/types";
import type { DesignSession } from "../vetd/design-session";

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
		<div className="absolute inset-y-0 right-0 z-40 flex w-72 flex-col border-l border-border bg-card/95 shadow-lg backdrop-blur-md">
			<div className="flex items-center justify-between border-b border-border px-3 py-2">
				<span className="text-xs font-medium text-foreground">{t("notes.drawer.title")}</span>
				<button
					type="button"
					title={t("notes.close")}
					aria-label={t("notes.close")}
					onClick={onClose}
					className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					<svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
						<path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
					</svg>
				</button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				{store.notes.length === 0 ? (
					<p className="px-1 py-6 text-center text-xs text-muted-foreground">{t("notes.drawer.empty")}</p>
				) : null}

				{pending.length > 0 ? (
					<>
						<div className="flex items-center justify-between px-1 pb-1.5 pt-1">
							<span className="text-[11px] font-medium text-muted-foreground">
								{t("notes.drawer.pending", { count: pending.length })}
							</span>
							<button
								type="button"
								disabled={handoff.blockedReason !== null}
								title={handoff.blockedReason ?? undefined}
								onClick={() => handoff.sendAll(pending.length)}
								className="rounded-md bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
							>
								{t("notes.handle.all")}
							</button>
						</div>
						{handoff.blockedReason !== null ? (
							<p className="px-1 pb-1.5 text-[10px] text-muted-foreground">{handoff.blockedReason}</p>
						) : null}
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
						<div className="flex items-center justify-between px-1 pb-1.5 pt-3">
							<span className="text-[11px] font-medium text-muted-foreground">
								{t("notes.drawer.resolved", { count: resolved.length })}
							</span>
							<button
								type="button"
								onClick={() => store.clearResolved()}
								className="rounded-md px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
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

	return (
		<div className="group mb-1 rounded-lg border border-transparent px-1.5 py-1.5 hover:border-border hover:bg-accent/40">
			<button type="button" onClick={onLocate} className="flex w-full items-start gap-1.5 text-left">
				{number !== null ? (
					<span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full rounded-bl-[2px] bg-[var(--vetd-accent,#6366f1)] text-[9px] font-semibold text-white">
						{number}
					</span>
				) : (
					<span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
						<svg viewBox="0 0 24 24" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
							<path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					</span>
				)}
				<span className="min-w-0 flex-1">
					<span className="block truncate text-xs text-foreground">{excerpt}</span>
					{lastAgent ? (
						<span className="block truncate text-[10px] text-muted-foreground">Vetta: {lastAgent.text}</span>
					) : null}
					<span className="block truncate text-[10px] text-muted-foreground">{location}</span>
				</span>
			</button>
			<div className="mt-1 hidden items-center justify-end gap-1 group-hover:flex">
				{onHandle ? (
					<button
						type="button"
						onClick={onHandle}
						className="rounded px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/10"
					>
						{t("notes.handle.one")}
					</button>
				) : null}
				<button
					type="button"
					onClick={onDelete}
					className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
				>
					{t("notes.delete")}
				</button>
			</div>
		</div>
	);
}
