import type { JSX } from "react";

function cn(...parts: Array<string | false | null | undefined>): string {
	return parts.filter(Boolean).join(" ");
}

export interface ChatMembersBarMember {
	readonly id: number;
	readonly username: string;
	readonly avatar: string;
}

export interface ChatMembersBarViewLabels {
	readonly empty: string;
	readonly meSuffix: string;
	readonly mentionHintSuffix: string;
}

export interface ChatMembersBarViewProps {
	readonly members: readonly ChatMembersBarMember[];
	readonly currentUserId: number;
	readonly labels: ChatMembersBarViewLabels;
	readonly onMention: (member: ChatMembersBarMember) => void;
}

/**
 * 聊天面板顶部固定的成员头像栏。
 * 右键单个头像即触发 @ 提及。
 */
export function ChatMembersBarView({
	members,
	currentUserId,
	labels,
	onMention,
}: ChatMembersBarViewProps): JSX.Element {
	if (members.length === 0) {
		return (
			<div className="flex h-12 items-center justify-center px-4 text-[11px] text-muted-foreground/50">
				{labels.empty}
			</div>
		);
	}
	return (
		<div className="flex h-12 shrink-0 items-center gap-3 overflow-hidden border-b border-border/40 bg-background/60 px-4 backdrop-blur-sm">
			<div className="flex shrink-0 items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-muted-foreground/60">
				<span className="icon-[mdi--account-group-outline] h-3 w-3" />
				<span>{members.length}</span>
			</div>
			<div className="no-scrollbar flex min-w-0 flex-1 items-center -space-x-1.5 overflow-x-auto overflow-y-hidden py-1">
				{members.map((m) => (
					<button
						key={m.id}
						type="button"
						onContextMenu={(e) => {
							e.preventDefault();
							if (m.id === currentUserId) return;
							onMention(m);
						}}
						title={`${m.username}${m.id === currentUserId ? labels.meSuffix : labels.mentionHintSuffix}`}
						className="relative shrink-0 rounded-full transition-[filter] duration-200 hover:brightness-110"
					>
						<MemberAvatar name={m.username} url={m.avatar} isMe={m.id === currentUserId} />
					</button>
				))}
			</div>
		</div>
	);
}

function MemberAvatar({ name, url, isMe }: { name: string; url: string; isMe: boolean }): JSX.Element {
	const ringClass = isMe ? "ring-2 ring-indigo-400/70" : "ring-2 ring-background";
	if (url) {
		return <img src={url} alt={name} className={cn("h-7 w-7 rounded-full object-cover", ringClass)} />;
	}
	const ch = name?.[0]?.toUpperCase() ?? "?";
	return (
		<div
			className={cn(
				"flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-muted to-muted-foreground/20 text-[11px] font-medium text-muted-foreground",
				ringClass,
			)}
		>
			{ch}
		</div>
	);
}
