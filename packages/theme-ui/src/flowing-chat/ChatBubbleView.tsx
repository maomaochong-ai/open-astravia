import { cn } from "@vetta-org/ui";
import { motion } from "motion/react";
import type { JSX, ReactNode } from "react";

export interface ChatBubbleReplySnapshot {
	senderName: string;
	deleted: boolean;
	preview: string;
}

export interface ChatBubbleViewLabels {
	recalledMine: string;
	recalledOther: (name: string) => string;
	reply: string;
	recall: string;
	recalledSuffix: string;
	mentionTitle: (name: string, isMine: boolean) => string;
}

export interface ChatBubbleViewProps {
	isMine: boolean;
	compact: boolean;
	type: "text" | "image" | "file" | "system";
	content: string;
	senderName: string;
	senderAvatar: string;
	deleted: boolean;
	canRecall: boolean;
	timeLabel: string;
	replySnapshot: ChatBubbleReplySnapshot | null;
	labels: ChatBubbleViewLabels;
	/** Pre-built image / file attachment body. */
	mediaContent: ReactNode;
	onReply: () => void;
	onRecall: () => void;
	onMentionSender: () => void;
}

/**
 * Flowing-chat message bubble presentation.
 */
export function ChatBubbleView({
	isMine,
	compact,
	type,
	content,
	senderName,
	senderAvatar,
	deleted,
	canRecall,
	timeLabel,
	replySnapshot,
	labels,
	mediaContent,
	onReply,
	onRecall,
	onMentionSender,
}: ChatBubbleViewProps): JSX.Element {
	if (type === "system") {
		return (
			<motion.div
				initial={{ opacity: 0, y: 4 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.18 }}
				className="my-2 flex justify-center"
			>
				<div className="rounded-full bg-muted/60 px-3 py-1 text-[10.5px] tracking-wide text-muted-foreground/70 backdrop-blur-sm">
					{content}
				</div>
			</motion.div>
		);
	}

	if (deleted) {
		return (
			<motion.div
				initial={{ opacity: 0, y: 4 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.18 }}
				className={cn("flex gap-2.5", isMine ? "flex-row-reverse" : "flex-row")}
			>
				<div className="w-8 flex-shrink-0" />
				<div className="rounded-full bg-muted/60 px-3 py-1 text-[10.5px] italic text-muted-foreground/70">
					{isMine ? labels.recalledMine : labels.recalledOther(senderName)}
				</div>
			</motion.div>
		);
	}

	return (
		<motion.div
			initial={{ opacity: 0, y: 6 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
			className={cn("group flex gap-2.5", isMine ? "flex-row-reverse" : "flex-row")}
		>
			<div className="w-8 flex-shrink-0">
				{!compact && (
					<button
						type="button"
						onContextMenu={(e) => {
							e.preventDefault();
							if (isMine) return;
							onMentionSender();
						}}
						title={labels.mentionTitle(senderName, isMine)}
						className="block rounded-full transition-transform hover:scale-105"
					>
						<Avatar name={senderName} url={senderAvatar} />
					</button>
				)}
			</div>
			<div className={cn("flex max-w-[78%] flex-col", isMine ? "items-end" : "items-start")}>
				{!compact && (
					<div className="mb-1 px-1 text-[10.5px] font-medium text-muted-foreground/70">{senderName}</div>
				)}

				{type === "text" && (
					<div
						className={cn(
							"relative rounded-2xl px-3.5 py-2 text-[12.5px] leading-[18px] whitespace-pre-wrap break-words",
							"shadow-[0_1px_2px_rgba(15,23,42,0.04),0_2px_8px_-2px_rgba(15,23,42,0.05)]",
							"transition-shadow duration-200 hover:shadow-[0_2px_4px_rgba(15,23,42,0.06),0_4px_12px_-2px_rgba(15,23,42,0.08)]",
							isMine
								? "rounded-br-md bg-blue-50 text-foreground dark:bg-indigo-500/15"
								: "rounded-bl-md border border-border/40 bg-card text-foreground",
						)}
					>
						{renderTextWithMentions(content, isMine)}
					</div>
				)}

				{(type === "image" || type === "file") && mediaContent}

				{replySnapshot && (
					<div
						className={cn(
							"mt-1 max-w-full truncate rounded-xl bg-muted/70 px-3 py-1.5 text-[11px] text-muted-foreground",
							"shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
						)}
					>
						<span className="font-medium text-foreground/70">
							{replySnapshot.senderName}
							{replySnapshot.deleted && ` · ${labels.recalledSuffix}`}：
						</span>
						<span>{replySnapshot.preview}</span>
					</div>
				)}

				<div
					className={cn(
						"mt-1 flex items-center gap-2 px-1 text-[9.5px] text-muted-foreground/50",
						isMine ? "flex-row-reverse" : "flex-row",
					)}
				>
					<span>{timeLabel}</span>
					<div
						className={cn(
							"flex items-center gap-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100",
						)}
					>
						<button type="button" onClick={onReply} className="hover:text-foreground">
							{labels.reply}
						</button>
						{canRecall && (
							<button type="button" onClick={onRecall} className="hover:text-destructive">
								{labels.recall}
							</button>
						)}
					</div>
				</div>
			</div>
		</motion.div>
	);
}

function renderTextWithMentions(content: string, isMine: boolean): JSX.Element {
	const parts = content.split(/(@\S+)/g);
	return (
		<span>
			{parts.map((p, i) => {
				if (p.startsWith("@") && p.length > 1) {
					return (
						<span
							key={i}
							className={cn(
								"font-medium",
								isMine ? "text-indigo-600 dark:text-indigo-300" : "text-primary",
							)}
						>
							{p}
						</span>
					);
				}
				return <span key={i}>{p}</span>;
			})}
		</span>
	);
}

function Avatar({ name, url }: { name: string; url: string }): JSX.Element {
	if (url) {
		return (
			<div className="relative">
				<img
					src={url}
					alt={name}
					className="h-8 w-8 rounded-full object-cover ring-2 ring-background"
				/>
			</div>
		);
	}
	const ch = name?.[0]?.toUpperCase() ?? "?";
	return (
		<div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-muted to-muted-foreground/20 text-[12px] font-medium text-muted-foreground ring-2 ring-background">
			{ch}
		</div>
	);
}
