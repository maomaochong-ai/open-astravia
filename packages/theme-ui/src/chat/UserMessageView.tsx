import { motion } from "motion/react";
import type { Transition } from "motion/react";
import type { JSX, MouseEvent, ReactNode } from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { MessageLayout } from "./MessageLayoutView";
import { Message } from "./MessageView";
import { MessageVisual } from "./MessageVisualView";

const HIDDEN_VISUAL_STATE = { opacity: 0, scale: 0.82, x: 14, y: 12 };
const VISIBLE_VISUAL_STATE = { opacity: 1, scale: 1, x: 0, y: 0 };
const ENTRY_TRANSITION = {
	type: "spring",
	stiffness: 520,
	damping: 24,
	mass: 0.8,
} satisfies Transition;
const TEXT_INITIAL = { filter: "blur(6px)" };
const TEXT_VISIBLE = { filter: "blur(0px)" };
const TEXT_TRANSITION = {
	duration: 0.22,
	ease: [0.25, 0.1, 0.25, 1] as const,
} satisfies Transition;
const MESSAGE_STYLE = { originX: 1, originY: 1 };
const USER_MESSAGE_COLLAPSED_LINES = 10;
const USER_MESSAGE_COLLAPSED_MAX_HEIGHT = `${USER_MESSAGE_COLLAPSED_LINES * 1.6}em`;

export type UserMessageEntryState = "static" | "hidden" | "enter";

export interface UserMessageViewLabels {
	expand: string;
	edit: string;
	fork: string;
	skillBadge: string;
	sceneBadge: string;
	branchPrev: string;
	branchNext: string;
	branchPosition: string;
	pendingEdit: string;
}

export interface UserMessageViewProps {
	entryState: UserMessageEntryState;
	displayText: string;
	hasImages: boolean;
	hasSkillBadge: boolean;
	hasSettingsAssistBadge: boolean;
	hasFileBadges: boolean;
	hasAppshot: boolean;
	copyText: string;
	isLastUserMessage: boolean;
	/** Host-owned visibility policy; Runtime readiness should not affect it. */
	showEditAction?: boolean;
	/** A real permission or operation constraint, not a loading-state signal. */
	editActionDisabled?: boolean;
	/** @deprecated Use showEditAction and keep readiness coordination in the host. */
	canEdit?: boolean;
	canSwitchBranch: boolean;
	/** A real branch constraint, not a loading-state signal. */
	branchActionDisabled?: boolean;
	showForkAction?: boolean;
	/** A real permission or operation constraint, not a loading-state signal. */
	forkActionDisabled?: boolean;
	/** @deprecated Use showForkAction and keep readiness coordination in the host. */
	canFork?: boolean;
	isPendingEdit: boolean;
	branchIndex: number;
	branchTotal: number;
	actionsVisible: boolean;
	labels: UserMessageViewLabels;
	appshot: ReactNode;
	images: ReactNode;
	badges: ReactNode;
	fileBadges: ReactNode;
	/** Markdown text body. */
	textBody: ReactNode;
	relativeTime: ReactNode;
	copyButton: ReactNode;
	onEntryComplete?: () => void;
	onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
	onEdit: () => void;
	onFork: () => void;
	onBranchPrev: () => void;
	onBranchNext: () => void;
	onActionsVisibleChange: (visible: boolean) => void;
}

function UserMessageTextShell({
	contentKey,
	shouldAnimateIn,
	shouldHoldHidden,
	expandLabel,
	children,
}: {
	/** Stable identity of the message body; only this should reset expanded state. */
	contentKey: string;
	shouldAnimateIn: boolean;
	shouldHoldHidden: boolean;
	expandLabel: string;
	children: ReactNode;
}): JSX.Element {
	const contentRef = useRef<HTMLDivElement>(null);
	const [expanded, setExpanded] = useState(false);
	const [canExpand, setCanExpand] = useState(false);

	const measureOverflow = useCallback(() => {
		const content = contentRef.current;
		if (!content) return;
		const fontSize = Number.parseFloat(window.getComputedStyle(content).fontSize);
		const collapsedHeight = fontSize * 1.6 * USER_MESSAGE_COLLAPSED_LINES;
		setCanExpand(content.scrollHeight > collapsedHeight + 1);
	}, []);

	// Expand is sticky for the lifetime of this mount (session switch / refresh remounts).
	// Do not key off `children` — parent re-renders recreate that node (e.g. action hover).
	useLayoutEffect(() => {
		setExpanded(false);
	}, [contentKey]);

	useLayoutEffect(() => {
		measureOverflow();
		const content = contentRef.current;
		if (!content) return;
		const observer = new ResizeObserver(measureOverflow);
		observer.observe(content);
		return () => observer.disconnect();
	}, [measureOverflow, contentKey, children]);

	return (
		<div
			className="relative min-w-0 max-w-full overflow-hidden"
			style={{ maxHeight: expanded ? undefined : USER_MESSAGE_COLLAPSED_MAX_HEIGHT }}
		>
			{/* 静态态不挂 motion：历史消息与发送后常驻的气泡占绝大多数，
			    给每条都套一层动画组件只是白付出订阅与逐帧调度的开销。 */}
			{shouldAnimateIn || shouldHoldHidden ? (
				<motion.div
					ref={contentRef}
					className="min-w-0 max-w-full"
					initial={shouldAnimateIn ? TEXT_INITIAL : false}
					animate={shouldHoldHidden ? TEXT_INITIAL : TEXT_VISIBLE}
					transition={TEXT_TRANSITION}
				>
					{children}
				</motion.div>
			) : (
				<div ref={contentRef} className="min-w-0 max-w-full">
					{children}
				</div>
			)}
			{canExpand && !expanded && (
				<div className="absolute inset-x-0 bottom-0 flex h-20 items-end justify-center bg-gradient-to-t from-secondary via-secondary/80 to-secondary/0 pb-1.5">
					<button
						type="button"
						onClick={() => setExpanded(true)}
						className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-[12px] font-medium text-muted-foreground backdrop-blur-sm transition-colors hover:bg-background hover:text-foreground"
					>
						<span className="icon-[solar--alt-arrow-down-linear] h-3.5 w-3.5" />
						<span>{expandLabel}</span>
					</button>
				</div>
			)}
		</div>
	);
}

export function SkillBadgeView({
	name,
	type = "skill",
	skillLabel,
	sceneLabel,
}: {
	name: string;
	type?: "skill" | "scene";
	skillLabel: string;
	sceneLabel: string;
}): JSX.Element {
	const icon =
		type === "scene" ? "icon-[solar--clapperboard-open-linear]" : "icon-[solar--magic-stick-linear]";
	const label = type === "scene" ? sceneLabel : skillLabel;
	return (
		<span className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-0.5 text-[12px] font-medium text-primary">
			<span className={`${icon} h-3 w-3`} />
			<span className="text-primary/75">{label}</span>
			{name}
		</span>
	);
}

export function SettingsAssistBadgeView({ label }: { label: string }): JSX.Element {
	return (
		<span className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-0.5 text-[12px] font-medium text-primary">
			<span className="icon-[solar--settings-linear] h-3 w-3" />
			{label}
		</span>
	);
}

const actionBtnClass =
	"inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground/45 transition-colors hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-30";

export function UserMessageView({
	entryState,
	displayText,
	hasImages,
	hasSkillBadge,
	hasSettingsAssistBadge,
	hasFileBadges,
	hasAppshot,
	copyText,
	showEditAction,
	editActionDisabled,
	canEdit,
	canSwitchBranch,
	branchActionDisabled,
	showForkAction,
	forkActionDisabled,
	canFork,
	isPendingEdit,
	branchIndex,
	branchTotal,
	actionsVisible,
	labels,
	appshot,
	images,
	badges,
	fileBadges,
	textBody,
	relativeTime,
	copyButton,
	onEntryComplete,
	onContextMenu,
	onEdit,
	onFork,
	onBranchPrev,
	onBranchNext,
	onActionsVisibleChange,
}: UserMessageViewProps): JSX.Element {
	const shouldAnimateIn = entryState === "enter";
	const shouldHoldHidden = entryState === "hidden";
	const empty =
		!displayText &&
		!hasSkillBadge &&
		!hasSettingsAssistBadge &&
		!hasFileBadges &&
		!hasImages &&
		!hasAppshot;
	const editActionVisible = showEditAction ?? canEdit ?? false;
	const forkActionVisible = showForkAction ?? canFork ?? false;
	const showPrimaryActions = Boolean(copyText) || editActionVisible || forkActionVisible;
	const showMetaRow = canSwitchBranch || Boolean(relativeTime);
	const showActions = showPrimaryActions || showMetaRow;

	return (
		<UserMessageFrame
			shouldAnimateIn={shouldAnimateIn}
			shouldHoldHidden={shouldHoldHidden}
			onEntryComplete={onEntryComplete}
			onContextMenu={onContextMenu}
			onActionsVisibleChange={onActionsVisibleChange}
		>
			<MessageLayout.OutgoingContent>
				{hasAppshot && <div className="mb-1.5 flex justify-end">{appshot}</div>}
				{hasImages && <div className="mb-1.5 flex justify-end">{images}</div>}
				{(hasSkillBadge || hasSettingsAssistBadge) && (
					<div className="mb-1 flex flex-wrap justify-end gap-1">{badges}</div>
				)}
				{displayText && (
					<MessageVisual.OutgoingBubble
						className={`cursor-text ${
							isPendingEdit ? "ring-1 ring-primary/40" : ""
						}`}
						style={{ wordBreak: "break-word" }}
					>
						<UserMessageTextShell
							contentKey={displayText}
							shouldAnimateIn={shouldAnimateIn}
							shouldHoldHidden={shouldHoldHidden}
							expandLabel={labels.expand}
						>
							{textBody}
						</UserMessageTextShell>
					</MessageVisual.OutgoingBubble>
				)}
				{empty && (
					<MessageVisual.OutgoingBubble
						className="cursor-text"
						style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
					>
						{"\u2026"}
					</MessageVisual.OutgoingBubble>
				)}
				{hasFileBadges && (
					<div className="mt-1 flex flex-wrap justify-end gap-1">{fileBadges}</div>
				)}
				{showActions && (
					<MessageLayout.Footer asChild>
						<Message.Actions
							className={`flex-col items-end gap-0.5 transition-opacity duration-150 ${
							actionsVisible || isPendingEdit || canSwitchBranch
								? "pointer-events-auto opacity-100"
								: "pointer-events-none opacity-0"
							}`}
						>
						{/* Row 1: edit / fork / copy */}
						{showPrimaryActions && (
							<div className="flex h-6 items-center justify-end gap-1 whitespace-nowrap">
								{editActionVisible && (
									<button
										type="button"
										onClick={onEdit}
										disabled={editActionDisabled}
										title={isPendingEdit ? labels.pendingEdit : labels.edit}
										aria-label={labels.edit}
										className={`${actionBtnClass} ${isPendingEdit ? "text-primary" : ""}`}
									>
										<span className="icon-[solar--pen-2-linear] h-3.5 w-3.5" />
									</button>
								)}
								{forkActionVisible && (
									<button
										type="button"
										onClick={onFork}
										disabled={forkActionDisabled}
										title={labels.fork}
										aria-label={labels.fork}
										className={actionBtnClass}
									>
										<span className="icon-[solar--branching-paths-up-linear] h-3.5 w-3.5" />
									</button>
								)}
								{copyText || hasImages || hasAppshot ? copyButton : null}
							</div>
						)}
						{/* Row 2: branch switcher then time */}
						{showMetaRow && (
							<div className="flex h-6 items-center justify-end gap-1 whitespace-nowrap">
								{canSwitchBranch && (
									<span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground/70">
										<button
											type="button"
											onClick={onBranchPrev}
											disabled={branchActionDisabled || branchIndex <= 0}
											title={labels.branchPrev}
											aria-label={labels.branchPrev}
											className={actionBtnClass}
										>
											<span className="icon-[solar--alt-arrow-left-linear] h-3.5 w-3.5" />
										</button>
										<span
											className="min-w-[2.5rem] text-center tabular-nums"
											title={labels.branchPosition}
										>
											{branchIndex + 1}/{branchTotal}
										</span>
										<button
											type="button"
											onClick={onBranchNext}
											disabled={branchActionDisabled || branchIndex >= branchTotal - 1}
											title={labels.branchNext}
											aria-label={labels.branchNext}
											className={actionBtnClass}
										>
											<span className="icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5" />
										</button>
									</span>
								)}
								{relativeTime}
							</div>
						)}
						</Message.Actions>
					</MessageLayout.Footer>
				)}
			</MessageLayout.OutgoingContent>
		</UserMessageFrame>
	);
}

/**
 * 气泡外框。
 *
 * 只有「正在入场 / 入场前挂起」的那一条才需要 motion；其余（历史消息、发送完成
 * 后的常驻气泡）走普通 div。列表里静态气泡是绝大多数，让它们各自挂一个动画组件
 * 会在每次列表重渲时付出订阅与逐帧调度成本，而屏幕上并没有任何东西在动。
 */
function UserMessageFrame({
	shouldAnimateIn,
	shouldHoldHidden,
	onEntryComplete,
	onContextMenu,
	onActionsVisibleChange,
	children,
}: {
	shouldAnimateIn: boolean;
	shouldHoldHidden: boolean;
	onEntryComplete?: () => void;
	onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
	onActionsVisibleChange: (visible: boolean) => void;
	children: ReactNode;
}): JSX.Element {
	const handlers = {
		onContextMenu,
		onMouseEnter: () => onActionsVisibleChange(true),
		onMouseLeave: () => onActionsVisibleChange(false),
	};
	if (!shouldAnimateIn && !shouldHoldHidden) {
		return (
			<Message.Root>
				<MessageLayout.Outgoing {...handlers}>{children}</MessageLayout.Outgoing>
			</Message.Root>
		);
	}
	return (
		<Message.Root>
			<MessageLayout.Outgoing asChild>
				<motion.div
					initial={shouldAnimateIn ? HIDDEN_VISUAL_STATE : false}
					animate={shouldHoldHidden ? HIDDEN_VISUAL_STATE : VISIBLE_VISUAL_STATE}
					transition={ENTRY_TRANSITION}
					onAnimationComplete={shouldAnimateIn ? onEntryComplete : undefined}
					style={MESSAGE_STYLE}
					{...handlers}
				>
					{children}
				</motion.div>
			</MessageLayout.Outgoing>
		</Message.Root>
	);
}
