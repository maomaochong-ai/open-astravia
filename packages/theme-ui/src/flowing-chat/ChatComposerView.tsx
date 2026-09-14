import { cn } from "@vetta-org/ui";
import type { JSX } from "react";
import {
	forwardRef,
	useCallback,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";

export interface ChatComposerMember {
	readonly id: number;
	readonly username: string;
	readonly avatar?: string | null;
}

export interface ChatComposerReplyMessage {
	readonly type: string;
	readonly content: string;
	readonly sender_name: string;
	readonly attachments?: readonly { readonly name?: string }[];
}

export interface ChatComposerViewProps {
	replyTo: ChatComposerReplyMessage | null;
	onClearReply: () => void;
	onSendText: (text: string, mentionedUserIds: number[]) => Promise<void>;
	onSendFiles: (files: File[]) => Promise<void>;
	members: ChatComposerMember[];
	currentUserId: number;
}

export interface ChatComposerViewHandle {
	insertMention: (member: ChatComposerMember) => void;
	focus: () => void;
}

interface MentionState {
	open: boolean;
	query: string;
	startIndex: number;
}

const EMPTY_MENTION_STATE: MentionState = { open: false, query: "", startIndex: -1 };

export const ChatComposerView = forwardRef<ChatComposerViewHandle, ChatComposerViewProps>(function ChatComposerView(
	{ replyTo, onClearReply, onSendText, onSendFiles, members, currentUserId },
	ref,
) {
	const [value, setValue] = useState("");
	const [busy, setBusy] = useState(false);
	const [mentionState, setMentionState] = useState<MentionState>(EMPTY_MENTION_STATE);
	const [activeMentionIdx, setActiveMentionIdx] = useState(0);
	// 已选中的 @ 用户：name -> id
	const [pendingMentions, setPendingMentions] = useState<Map<string, number>>(new Map());

	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const imageInputRef = useRef<HTMLInputElement>(null);

	const mentionableMembers = useMemo(
		() => members.filter((m) => m.id !== currentUserId),
		[members, currentUserId],
	);

	const filteredMembers = useMemo(() => {
		if (!mentionState.open) return [] as ChatComposerMember[];
		const q = mentionState.query.toLowerCase();
		if (!q) return mentionableMembers.slice(0, 8);
		return mentionableMembers
			.filter((m) => m.username.toLowerCase().includes(q))
			.slice(0, 8);
	}, [mentionState, mentionableMembers]);

	// 实际发送时：把还出现在文本里的 @<name> 收集成 id 数组
	const computeMentionedIds = useCallback(
		(text: string): number[] => {
			const ids: number[] = [];
			for (const [name, id] of pendingMentions) {
				if (text.includes(`@${name}`)) ids.push(id);
			}
			return ids;
		},
		[pendingMentions],
	);

	const submit = useCallback(async () => {
		const text = value.trim();
		if (!text || busy) return;
		setBusy(true);
		try {
			await onSendText(text, computeMentionedIds(text));
			setValue("");
			setPendingMentions(new Map());
			setMentionState(EMPTY_MENTION_STATE);
		} finally {
			setBusy(false);
		}
	}, [value, busy, onSendText, computeMentionedIds]);

	const closeMention = useCallback(() => {
		setMentionState(EMPTY_MENTION_STATE);
		setActiveMentionIdx(0);
	}, []);

	const insertMentionAt = useCallback(
		(member: ChatComposerMember, replaceFromIdx: number) => {
			const el = textareaRef.current;
			if (!el) return;
			const before = value.slice(0, replaceFromIdx);
			const cursor = el.selectionStart ?? value.length;
			const after = value.slice(cursor);
			const insert = `@${member.username} `;
			const next = before + insert + after;
			setValue(next);
			setPendingMentions((prev) => {
				const m = new Map(prev);
				m.set(member.username, member.id);
				return m;
			});
			closeMention();
			// 把光标放到插入文本之后
			requestAnimationFrame(() => {
				el.focus();
				const pos = before.length + insert.length;
				el.setSelectionRange(pos, pos);
			});
		},
		[value, closeMention],
	);

	// 暴露给父组件：从外部插入 @ 提及（如右键头像）
	useImperativeHandle(
		ref,
		() => ({
			insertMention: (member: ChatComposerMember) => {
				const el = textareaRef.current;
				const cursor = el?.selectionStart ?? value.length;
				insertMentionAt(member, cursor);
			},
			focus: () => textareaRef.current?.focus(),
		}),
		[insertMentionAt, value],
	);

	// 监听输入：识别 @ 触发器
	const handleChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			const next = e.target.value;
			setValue(next);
			const cursor = e.target.selectionStart ?? next.length;
			// 从光标向左找最近的 @；若中间出现空白或换行则不算
			let i = cursor - 1;
			while (i >= 0) {
				const ch = next[i];
				if (ch === "@") {
					// @前面必须是行首或空白
					const prev = i > 0 ? next[i - 1] : "";
					if (i === 0 || prev === " " || prev === "\n" || prev === "\t") {
						const query = next.slice(i + 1, cursor);
						setMentionState({ open: true, query, startIndex: i });
						setActiveMentionIdx(0);
						return;
					}
					break;
				}
				if (ch === " " || ch === "\n" || ch === "\t") break;
				i--;
			}
			if (mentionState.open) closeMention();
		},
		[mentionState.open, closeMention],
	);

	const onKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (mentionState.open && filteredMembers.length > 0) {
				if (e.key === "ArrowDown") {
					e.preventDefault();
					setActiveMentionIdx((i) => (i + 1) % filteredMembers.length);
					return;
				}
				if (e.key === "ArrowUp") {
					e.preventDefault();
					setActiveMentionIdx((i) => (i - 1 + filteredMembers.length) % filteredMembers.length);
					return;
				}
				if (e.key === "Enter" || e.key === "Tab") {
					e.preventDefault();
					const m = filteredMembers[activeMentionIdx];
					if (m) insertMentionAt(m, mentionState.startIndex);
					return;
				}
				if (e.key === "Escape") {
					e.preventDefault();
					closeMention();
					return;
				}
			}
			if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
				e.preventDefault();
				void submit();
			}
		},
		[mentionState, filteredMembers, activeMentionIdx, insertMentionAt, closeMention, submit],
	);

	const handleFiles = useCallback(
		async (files: FileList | null) => {
			if (!files || files.length === 0 || busy) return;
			setBusy(true);
			try {
				await onSendFiles(Array.from(files));
			} finally {
				setBusy(false);
			}
		},
		[busy, onSendFiles],
	);

	const hasText = value.trim().length > 0;

	return (
		<div className="relative px-3 pt-2 pb-3">
			{mentionState.open && filteredMembers.length > 0 && (
				<div className="absolute bottom-full left-3 right-3 mb-2 max-h-52 overflow-hidden rounded-2xl border border-border/60 bg-popover/95 shadow-[0_8px_24px_-8px_rgba(15,23,42,0.18)] backdrop-blur-xl">
					<div className="border-b border-border/40 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/60">
						提及成员
					</div>
					<div className="max-h-44 overflow-y-auto py-1">
						{filteredMembers.map((m, i) => (
							<button
								key={m.id}
								type="button"
								onClick={() => insertMentionAt(m, mentionState.startIndex)}
								onMouseEnter={() => setActiveMentionIdx(i)}
								className={cn(
									"flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] transition-colors",
									i === activeMentionIdx && "bg-accent",
								)}
							>
								{m.avatar ? (
									<img
										src={m.avatar}
										alt={m.username}
										className="h-6 w-6 rounded-full object-cover ring-1 ring-border/40"
									/>
								) : (
									<div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground">
										{m.username[0]}
									</div>
								)}
								<span className="font-medium">{m.username}</span>
							</button>
						))}
					</div>
				</div>
			)}

			{replyTo && (
				<div className="mb-2 flex items-center gap-2 rounded-xl border-l-[3px] border-primary/60 bg-muted/40 px-3 py-1.5 text-[11px]">
					<span className="icon-[mdi--reply] h-3.5 w-3.5 text-primary/70" />
					<div className="min-w-0 flex-1 truncate">
						<span className="font-medium text-foreground/80">{replyTo.sender_name}</span>
						<span className="ml-1 text-muted-foreground">{getReplyPreview(replyTo)}</span>
					</div>
					<button
						type="button"
						onClick={onClearReply}
						className="rounded-full p-0.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
					>
						<span className="icon-[mdi--close] h-3 w-3" />
					</button>
				</div>
			)}

			<div className="flex items-end gap-2">
				{/* Composer pill */}
				<div
					className={cn(
						"flex flex-1 items-end gap-1 rounded-3xl border border-border/50 bg-card px-3 py-1.5",
						"shadow-[0_1px_2px_rgba(15,23,42,0.04),0_2px_8px_-2px_rgba(15,23,42,0.06)]",
						"transition-shadow duration-200 focus-within:shadow-[0_2px_4px_rgba(15,23,42,0.06),0_4px_16px_-2px_rgba(15,23,42,0.10)]",
					)}
				>
					<textarea
						ref={textareaRef}
						value={value}
						onChange={handleChange}
						onKeyDown={onKeyDown}
						disabled={busy}
						placeholder="输入消息，@ 提及成员"
						rows={1}
						className="min-h-[24px] max-h-32 flex-1 resize-none border-0 bg-transparent px-1 py-1 text-[12.5px] leading-[20px] text-foreground outline-none placeholder:text-muted-foreground/50"
					/>
					<button
						type="button"
						onClick={() => imageInputRef.current?.click()}
						disabled={busy}
						title="发送图片"
						className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
					>
						<span className="icon-[mdi--image-outline] h-4 w-4" />
					</button>
					<button
						type="button"
						onClick={() => fileInputRef.current?.click()}
						disabled={busy}
						title="发送文件"
						className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
					>
						<span className="icon-[mdi--paperclip] h-4 w-4" />
					</button>
				</div>

				{/* Send button (separate circular) */}
				<button
					type="button"
					onClick={() => void submit()}
					disabled={busy || !hasText}
					className={cn(
						"flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all duration-200",
						hasText && !busy
							? "scale-100 bg-primary text-primary-foreground shadow-md hover:scale-105 hover:bg-primary/90"
							: "scale-95 bg-muted text-muted-foreground/40",
					)}
				>
					<span className="icon-[mdi--send] h-4 w-4" />
				</button>
			</div>
			<input
				ref={imageInputRef}
				type="file"
				accept="image/*"
				multiple
				className="hidden"
				onChange={(e) => {
					void handleFiles(e.target.files);
					e.target.value = "";
				}}
			/>
			<input
				ref={fileInputRef}
				type="file"
				multiple
				className="hidden"
				onChange={(e) => {
					void handleFiles(e.target.files);
					e.target.value = "";
				}}
			/>
		</div>
	);
});

function getReplyPreview(msg: ChatComposerReplyMessage): string {
	if (msg.type === "text") return msg.content.slice(0, 80);
	if (msg.type === "image") return "[图片]";
	if (msg.type === "file") return `[文件] ${msg.attachments?.[0]?.name ?? ""}`;
	return msg.content;
}
