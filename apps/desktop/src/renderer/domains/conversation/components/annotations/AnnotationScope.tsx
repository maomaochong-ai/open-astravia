import { createContext, useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useSetAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { Button } from "@shared/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@shared/components/ui/popover";
import { RendererMarkdownContent } from "@shared/components/RendererMarkdownContent";
import { pendingScrollToEntryAtom } from "@shared/store/atoms";
import type { ActiveSession } from "@shared/store/atoms";
import { useShortcutScope } from "@shared/shortcuts";
import { AnnotationComposer, AnnotationHistoryView, AnnotationTurnView } from "@vetta-org/theme-ui/chat";
import { useAnnotationModel } from "./useAnnotationModel";
import type { MessageAnnotation } from "../../../../../shared/message-annotations";

interface AnnotationActions {
	notes: readonly MessageAnnotation[];
	ask(entryId: string, quote: string, origin: HTMLElement | null): void;
	show(id: string, origin: HTMLElement | null): void;
	history(origin: HTMLElement | null): void;
}
const AnnotationContext = createContext<AnnotationActions | null>(null);
export const useAnnotations = () => useContext(AnnotationContext);

/**
 * Annotations of `session` for the messages in `children`. The panel and its
 * state belong to one session and live beside the children, keyed by the
 * session: switching sessions resets them without remounting the message list.
 * Without a session the children see no annotation actions.
 */
export function AnnotationScope({
	session,
	sourceEntryIds,
	children,
}: {
	session: ActiveSession | null;
	sourceEntryIds: readonly string[];
	children: ReactNode;
}) {
	const [actions, setActions] = useState<AnnotationActions | null>(null);
	return (
		<AnnotationContext.Provider value={actions}>
			{children}
			{session ? (
				<AnnotationPanel
					key={session.sessionPath}
					session={session}
					sourceEntryIds={sourceEntryIds}
					onActions={setActions}
				/>
			) : null}
		</AnnotationContext.Provider>
	);
}

/** One session's annotation panel; it publishes stable actions for the message list. */
function AnnotationPanel({
	session,
	sourceEntryIds,
	onActions,
}: {
	session: ActiveSession;
	sourceEntryIds: readonly string[];
	onActions: (actions: AnnotationActions | null) => void;
}) {
	const model = useAnnotationModel(session);
	const { t } = useTranslation("chat");
	const setScroll = useSetAtom(pendingScrollToEntryAtom);
	const [query, setQuery] = useState("");
	const [point, setPoint] = useState({ x: 0, y: 0 });
	const originRef = useRef<HTMLElement | null>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const titleId = useId();
	const openAt = (origin: HTMLElement | null) => {
		originRef.current = origin;
		const rect = origin?.getBoundingClientRect();
		setPoint({
			x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
			y: rect ? Math.max(16, Math.min(rect.bottom, window.innerHeight - 80)) : 90,
		});
		model.setOpen(true);
	};
	const history = (origin: HTMLElement | null) => {
		model.setTarget(null);
		setQuery("");
		openAt(origin);
	};
	useShortcutScope({
		id: `annotations:${session.sessionPath}`,
		kind: "overlay",
		active: model.open,
		bindings: [{ key: "escape", run: () => model.setOpen(false) }],
	});
	const commands = useRef<Omit<AnnotationActions, "notes">>({ ask: () => {}, show: () => {}, history });
	commands.current = {
		ask: (entryId, quote, origin) => {
			if (model.note || model.target?.entryId !== entryId || model.target?.quote !== quote)
				model.setTarget({ id: crypto.randomUUID(), entryId, quote });
			openAt(origin);
		},
		show: (id, origin) => {
			const note = model.notes.find((item) => item.id === id);
			if (note) {
				model.setTarget(note);
				openAt(origin);
			}
		},
		history,
	};
	// Stable entry points: message rows re-render when the notes change, not on every panel render.
	const ask = useCallback<AnnotationActions["ask"]>((...args) => commands.current.ask(...args), []);
	const show = useCallback<AnnotationActions["show"]>((...args) => commands.current.show(...args), []);
	const openHistory = useCallback<AnnotationActions["history"]>((...args) => commands.current.history(...args), []);
	const actions = useMemo<AnnotationActions>(
		() => ({ notes: model.notes, ask, show, history: openHistory }),
		[model.notes, ask, show, openHistory],
	);
	useLayoutEffect(() => onActions(actions), [actions, onActions]);
	useLayoutEffect(() => () => onActions(null), [onActions]);
	const turns = model.note?.turns ?? [];
	const last = turns.at(-1);
	const sourceAvailable = model.target && sourceEntryIds.includes(model.target.entryId);
	return (
		<Popover open={model.open} onOpenChange={model.setOpen}>
				<PopoverAnchor asChild>
					<span
						aria-hidden="true"
						className="pointer-events-none fixed h-px w-px"
						style={{ left: point.x, top: point.y }}
					/>
				</PopoverAnchor>
				<PopoverContent
					ref={panelRef}
					aria-labelledby={titleId}
					side="bottom"
					align="center"
					collisionPadding={12}
					className="z-[1100] w-[440px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-32px)] gap-3 overflow-auto p-4 shadow-lg"
					onEscapeKeyDown={(event) => event.preventDefault()}
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						(panelRef.current?.querySelector<HTMLElement>("textarea, input") ?? panelRef.current)?.focus();
					}}
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						if (originRef.current?.isConnected) originRef.current.focus();
					}}
				>
					<div className="flex items-center justify-between gap-2">
						<h2 id={titleId} className="text-[14px] font-medium">
							{t("annotations.title")}
						</h2>
						<div className="flex items-center gap-1">
							{model.target ? (
								<Button
									variant="ghost"
									size="sm"
									onClick={() => {
										model.setTarget(null);
										setQuery("");
									}}
								>
									{t("annotations.history")}
								</Button>
							) : null}
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t("annotations.close")}
								onClick={() => model.setOpen(false)}
							>
								<span className="icon-[solar--close-circle-linear] h-4 w-4" />
							</Button>
						</div>
					</div>
					{model.error ? (
						<div role="alert" className="text-[12px] text-destructive">
							{t("annotations.error")}{" "}
							<Button variant="ghost" size="sm" onClick={() => void model.reload()}>
								{t("annotations.reload")}
							</Button>
						</div>
					) : null}
					{model.target ? (
						<>
							<p className="text-[11px] text-muted-foreground">{t("annotations.contextHint")}</p>
							<blockquote className="max-h-24 overflow-auto border-l border-border pl-3 text-[12px] text-muted-foreground whitespace-pre-wrap break-words">
								{model.target.quote}
							</blockquote>
							<Button
								variant="ghost"
								size="sm"
								className="self-start"
								disabled={!sourceAvailable}
								title={!sourceAvailable ? t("annotations.sourceUnavailable") : undefined}
								onClick={() => {
									if (model.target) setScroll({ entryId: model.target.entryId });
									model.setOpen(false);
								}}
							>
								{t("annotations.source")}
							</Button>
							<div className="max-h-[42vh] overflow-auto divide-y divide-border">
								{turns.map((turn, index) => (
									<AnnotationTurnView key={`${model.target?.id}:${index}`} question={turn.question}>
										{turn.answer ? (
											<RendererMarkdownContent
												text={turn.answer}
												isStreamingTail={turn.status === "pending"}
												className="text-[13px]"
											/>
										) : null}
										{turn.status !== "completed" && turn.status !== "pending" ? (
											<p role="status" className="text-[12px] text-muted-foreground">
												{t(`annotations.status.${turn.status}`)}
											</p>
										) : null}
										{turn.stopReason === "length" ? (
											<p className="text-[12px] text-muted-foreground">{t("annotations.length")}</p>
										) : null}
									</AnnotationTurnView>
								))}
							</div>
							{model.pending ? (
								<p role="status" className="text-[12px] text-muted-foreground">
									{t("annotations.answering")}
								</p>
							) : null}
							{last && last.status !== "completed" && !model.pending ? (
								<Button variant="ghost" size="sm" onClick={() => void model.send(true)}>
									{t("annotations.retry")}
								</Button>
							) : null}
							<AnnotationComposer
								value={model.draft}
								pending={model.pending}
								onChange={model.setDraft}
								onSend={() => void model.send()}
								onCancel={() => void model.cancel()}
								labels={{
									question: t("annotations.question"),
									send: t("annotations.send"),
									cancel: t("annotations.cancel"),
								}}
							/>
						</>
					) : model.loading ? (
						<p role="status" className="text-[13px] text-muted-foreground">
							{t("annotations.loading")}
						</p>
					) : (
						<AnnotationHistoryView
							query={query}
							onQueryChange={setQuery}
							items={model.notes
								.filter((note) =>
									`${note.quote} ${note.turns.map((turn) => `${turn.question} ${turn.answer}`).join(" ")}`
										.toLocaleLowerCase()
										.includes(query.toLocaleLowerCase()),
								)
								.map((note) => ({ id: note.id, title: note.turns[0]?.question ?? note.quote, quote: note.quote }))}
							labels={{ search: t("annotations.search"), empty: t("annotations.empty") }}
							onOpen={(id) => {
								const note = model.notes.find((item) => item.id === id);
								if (note) model.setTarget(note);
							}}
						/>
					)}
				</PopoverContent>
			</Popover>
	);
}
