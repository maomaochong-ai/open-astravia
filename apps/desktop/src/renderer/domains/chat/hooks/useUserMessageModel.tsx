import {
	activeSessionAtom,
	appshotAttachmentAtom,
	chatMessagesAtom,
	confirmDialogAtom,
	filePreviewAtom,
	inputValueAtom,
	isStreamingAtom,
	mentionedFilesAtom,
	openSessionFnRef,
	pendingMessageEditAtom,
	type ChatMessage,
	type FilePreviewItem,
} from "@shared/store/atoms";
import {
	parseInputSegments,
	segmentsToText,
	toTokenPath,
	type InputSegment,
} from "@shared/lib/input-tokens";
import { pathBasename, toVettaFileUrl } from "@shared/lib/utils";
import {
	SettingsAssistBadgeView,
	type UserMessageContextMenuViewProps,
	type UserMessageViewProps,
} from "@vetta/theme-ui/chat";
import { getDefaultStore, useAtomValue, useSetAtom } from "jotai";
import { selectAtom } from "jotai/utils";
import { useCallback, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** 用户气泡只关心当前会话的 runtimeId / cwd，收窄订阅避免流式期间整屏气泡重渲染。 */
const activeSessionRuntimeIdAtom = selectAtom(activeSessionAtom, (session) => session?.runtimeId);
const activeSessionCwdAtom = selectAtom(activeSessionAtom, (session) => session?.cwd);
import {
	fullHistoryToChat,
	isSystemAttachmentPath,
	isUserImageFile,
	parseUserPrefixes,
} from "../services/chat-service";
import { AppshotCard, type AppshotCardData } from "../components/AppshotCard";
import { TextBlockView } from "../components/blocks/TextBlock";
import { CopyButton } from "../components/message-list/MessageActions";
import { useSkillTokenMeta } from "./useSkillTokenMeta";

const DELETE_CONFIRMATION_SUPPRESSION_MS = 60_000;
const CONTEXT_MENU_WIDTH = 170;
const CONTEXT_MENU_HEIGHT = 112;
const CONTEXT_MENU_VIEWPORT_GAP = 8;

let deleteConfirmationSuppressedUntil = 0;

const SETTINGS_ASSIST_TAB_IDS = [
	"mcp",
	"models",
	"knowledge",
	"knowledgeBase",
	"batchTasks",
	"automation",
	"im",
	"webhook",
	"appearance",
	"plugins",
	"pet",
	"environment",
	"shortcuts",
	"agent",
] as const;

type SettingsAssistTabId = (typeof SETTINGS_ASSIST_TAB_IDS)[number];

function isSettingsAssistTabId(value: string): value is SettingsAssistTabId {
	return (SETTINGS_ASSIST_TAB_IDS as readonly string[]).includes(value);
}

function isAppshotPath(path: string): boolean {
	return /[/\\]image-cache[/\\]appshot[/\\]/.test(path);
}

function splitAppshotFiles(files: string[]): { appshotImage: string | null; rest: string[] } {
	const appshotImage = files.find((path) => isAppshotPath(path) && /\.png$/i.test(path)) ?? null;
	return { appshotImage, rest: files.filter((path) => !isAppshotPath(path)) };
}

function getPreviewImageSrc(item: FilePreviewItem): string {
	// Prefer path → vetta-file so stale file:// urls never win after history reload.
	if (item.path) return toVettaFileUrl(item.path);
	if (item.url) return item.url;
	return "";
}

async function abortAndWait(runtimeId: string): Promise<void> {
	const store = getDefaultStore();
	if (!store.get(isStreamingAtom)) return;
	await new Promise<void>((resolve) => {
		let settled = false;
		let unsubscribe: () => void = () => {};
		const finish = (): void => {
			if (settled) return;
			settled = true;
			unsubscribe();
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(finish, 8000);
		unsubscribe = window.vetta.session.onRunningChanged((p) => {
			if (p.sessionId === runtimeId && p.running === false) finish();
		});
		if (!store.get(isStreamingAtom)) {
			finish();
			return;
		}
		void window.vetta.session.abort(runtimeId).catch((err) => {
			console.error("[useUserMessageModel] abort failed:", err);
		});
	});
}

async function reloadChatHistory(runtimeId: string): Promise<void> {
	const history = await window.vetta.session.getFullHistory(runtimeId);
	getDefaultStore().set(chatMessagesAtom, fullHistoryToChat(history));
}

/**
 * 重编辑回填：把已发出的消息还原成输入框里的「文本 + 行内 token」。
 *
 * 与输入框反序列化、气泡渲染共用 parseInputSegments，所以新旧两种格式
 * （行内 `@skill:` / `@路径`，与旧会话的行首前缀）都能还原到同一形态。
 */
function fillInputFromUserText(
	rawText: string,
	promptRef?: ChatMessage["promptRef"],
	attachments?: ChatMessage["attachments"],
): void {
	const store = getDefaultStore();
	const { segments, legacyRef } = parseInputSegments(rawText);
	const ref = promptRef ?? legacyRef ?? null;
	const restored: InputSegment[] = [...segments];

	// 结构化引用在持久化消息里不重复写进正文；重编辑时补回对应行内 token。
	if (
		ref &&
		(ref.kind === "skill" || ref.kind === "scene") &&
		!restored.some((segment) => segment.kind === ref.kind && segment.name === ref.name)
	) {
		restored.unshift({ kind: ref.kind, name: ref.name });
	}

	// 结构化 attachments 是权威来源（带 directory / image 类型）；
	// 文本里没被 token 覆盖到的补到末尾，避免重编辑丢附件。
	const covered = new Set(
		restored.flatMap((segment) =>
			segment.kind === "file" || segment.kind === "image" ? [segment.path] : [],
		),
	);
	for (const attachment of attachments ?? []) {
		if (covered.has(attachment.path)) continue;
		covered.add(attachment.path);
		restored.push(
			attachment.kind === "image" || isUserImageFile(attachment.path)
				? { kind: "image", path: attachment.path }
				: { kind: "file", path: attachment.path, isDirectory: attachment.kind === "directory" },
		);
	}

	// 文本一写入，ValueBridgePlugin 会把编辑器内容整体重建成这些 token。
	store.set(inputValueAtom, segmentsToText(restored));
	// Appshot capsule needs full AppshotAttachment; on re-edit the image path rides
	// along as an inline token instead (sendMessage will include it).
	store.set(appshotAttachmentAtom, null);
}

function inputHasDraft(): boolean {
	const store = getDefaultStore();
	return (
		store.get(inputValueAtom).trim().length > 0 ||
		store.get(mentionedFilesAtom).length > 0 ||
		store.get(appshotAttachmentAtom) !== null
	);
}

export interface UserMessageModelInput {
	hasAssistantAfter?: boolean;
	isLastUserMessage?: boolean;
	isStreaming?: boolean;
	message: ChatMessage;
	onAbortEdit?: () => void;
}

export interface UserMessageModel extends UserMessageViewProps {
	contextMenu: UserMessageContextMenuViewProps | null;
}

export function useUserMessageModel({
	message,
	isLastUserMessage = false,
	isStreaming = false,
	onAbortEdit,
}: UserMessageModelInput): UserMessageModel {
	const { t } = useTranslation("chat");
	// 正文里的能力 token 要还原成命令区插入时的样子（图标 + 别名）。
	const resolveSkillMeta = useSkillTokenMeta();
	const parsedUser = parseUserPrefixes(message.text);
	const { segments, legacyRef } = parseInputSegments(message.text);
	const promptRef = message.promptRef ?? legacyRef ?? undefined;
	/** Appshot 的截图/文本走独立卡片，不能同时又当行内 token 渲染一遍。 */
	const bodySegments = segments.filter(
		(segment) =>
			(segment.kind !== "image" && segment.kind !== "file") || !isAppshotPath(segment.path),
	);
	if (
		(promptRef?.kind === "skill" || promptRef?.kind === "scene") &&
		!bodySegments.some((segment) => segment.kind === promptRef.kind && segment.name === promptRef.name)
	) {
		// promptRef 不重复进入正文；显示时统一补成行内 token。
		bodySegments.unshift({ kind: promptRef.kind, name: promptRef.name });
	}
	// 归一成行内标记形式：旧会话的行首前缀因此也能被 rehype 插件识别成 token。
	// pathTokenText 会把 `\` 写成 `/`，避免气泡 markdown 把 `\.` 当转义吃掉后
	// 图片胶囊对不上编号表、退化成文件名。
	const displayText = segmentsToText(bodySegments);
	const inlinePaths = new Set(
		bodySegments.flatMap((segment) =>
			segment.kind === "file" || segment.kind === "image" ? [toTokenPath(segment.path)] : [],
		),
	);
	const attachmentPaths = message.attachments?.map((attachment) => attachment.path) ?? parsedUser.files;
	const { appshotImage, rest: displayFiles } = splitAppshotFiles(attachmentPaths);
	/**
	 * 图片按「正文里出现的顺序」编号，缩略图集中在气泡上方，
	 * 正文里只留「图 N」胶囊——与输入框的形态一致。
	 * 未在正文出现的图片（旧消息、base64 兜底）排在后面继续编号。
	 */
	const inlineImagePaths = bodySegments.flatMap((segment) =>
		segment.kind === "image" ? [segment.path] : [],
	);
	const inlineImageKeys = new Set(inlineImagePaths.map(toTokenPath));
	const imageFiles = [
		...inlineImagePaths,
		...displayFiles.filter((file) => isUserImageFile(file) && !inlineImageKeys.has(toTokenPath(file))),
	];
	// 键统一 `/`：气泡 markdown 里的 path 与附件/节点上的 OS 路径分隔符可能不一致。
	const imageLabelByPath = new Map(
		imageFiles.map((path, index) => [
			toTokenPath(path),
			t("inputBar.capsule.imageBadge", { index: index + 1 }),
		]),
	);
	// 文件徽标只保留未在正文行内呈现的（正常情况下为空，属兜底）。
	const fileBadges = displayFiles.filter(
		(file) => !isUserImageFile(file) && !inlinePaths.has(toTokenPath(file)),
	);
	const appshotData: AppshotCardData | null =
		message.appshot ?? (appshotImage ? { imagePath: appshotImage } : null);
	// Path-based thumbs are the canonical source (history reload + optimistic after
	// persistImages). Base64 on message.images is only for optimistic display when
	// persist failed. Merging both doubles thumbnails while streaming.
	const imageItems = useMemo<FilePreviewItem[]>(() => {
		const fromPaths = imageFiles.map((path) => ({
			name: pathBasename(path),
			path,
			kind: "image" as const,
		}));
		const hasPersistedImagePaths = imageFiles.some(isSystemAttachmentPath);
		if (hasPersistedImagePaths) {
			return fromPaths;
		}
		const fromBase64 = (message.images ?? []).map((image) => ({
			name: image.name,
			url: `data:${image.mimeType};base64,${image.data}`,
			kind: "image" as const,
			mime: image.mimeType,
		}));
		return [...fromBase64, ...fromPaths];
	}, [imageFiles, message.images]);
	const hasImages = imageItems.length > 0;
	const hasSkillBadge = false;
	const settingsAssistTabId = message.settingsAssistTabId?.trim() ?? "";
	const hasSettingsAssistBadge = settingsAssistTabId.length > 0;
	const hasFileBadges = fileBadges.length > 0;
	const copyText = displayText.trim();
	const [actionsVisible, setActionsVisible] = useState(false);
	const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
	const setFilePreview = useSetAtom(filePreviewAtom);
	const setConfirmDialog = useSetAtom(confirmDialogAtom);
	// 只订阅 runtimeId / cwd：视窗内每条用户气泡都挂着本 hook，若订阅 activeSession
	// 整个对象，流式期间任意字段变动都会把所有可见用户气泡连同前缀解析重跑一遍。
	const activeSessionRuntimeId = useAtomValue(activeSessionRuntimeIdAtom);
	const activeSessionCwd = useAtomValue(activeSessionCwdAtom);
	const pendingEdit = useAtomValue(pendingMessageEditAtom);

	const hasPersistedEntry = Boolean(message.entryId);
	const canEdit = isLastUserMessage && Boolean(activeSessionRuntimeId);
	const canDelete = hasPersistedEntry && Boolean(activeSessionRuntimeId);
	const canFork = hasPersistedEntry && Boolean(activeSessionRuntimeId);
	const branch = message.branch;
	const canSwitchBranch = Boolean(branch && branch.siblings.length > 1 && message.entryId);
	const isPendingEdit = Boolean(
		pendingEdit && isLastUserMessage && (!message.entryId || pendingEdit.entryId === message.entryId),
	);

	const applyEditFill = useCallback(async () => {
		let entryId = message.entryId;
		if (!entryId && activeSessionRuntimeId) {
			const history = await window.vetta.session.getFullHistory(activeSessionRuntimeId);
			for (let index = history.length - 1; index >= 0; index--) {
				const entry = history[index];
				if (entry.type === "message" && entry.message.role === "user" && entry.entryId) {
					entryId = entry.entryId;
					break;
				}
			}
		}
		if (!entryId) return;
		fillInputFromUserText(message.text, message.promptRef, message.attachments);
		getDefaultStore().set(pendingMessageEditAtom, { entryId });
	}, [activeSessionRuntimeId, message.attachments, message.entryId, message.promptRef, message.text]);

	const runWithInterruptConfirm = useCallback(
		(kind: "switch" | "fork", action: () => void | Promise<void>) => {
			const run = (): void => {
				void (async () => {
					const runtimeId = activeSessionRuntimeId;
					if (isStreaming && runtimeId) {
						onAbortEdit?.();
						await abortAndWait(runtimeId);
					}
					await action();
				})();
			};
			if (!isStreaming) {
				run();
				return;
			}
			setConfirmDialog({
				title: t(
					kind === "switch" ? "messageList.interrupt.switchTitle" : "messageList.interrupt.forkTitle",
				),
				message: t(
					kind === "switch" ? "messageList.interrupt.switchBody" : "messageList.interrupt.forkBody",
				),
				confirmLabel: t("messageList.interrupt.confirm"),
				cancelLabel: t("messageList.interrupt.cancel"),
				variant: "danger",
				onConfirm: run,
			});
		},
		[activeSessionRuntimeId, isStreaming, onAbortEdit, setConfirmDialog, t],
	);

	const handleEdit = useCallback(() => {
		const startEdit = (): void => {
			void applyEditFill().catch((error) => {
				console.error("[useUserMessageModel] prepare edit failed:", error);
			});
		};
		if (inputHasDraft() && !isPendingEdit) {
			setConfirmDialog({
				title: t("messageList.edit.overwriteDraftTitle"),
				message: t("messageList.edit.overwriteDraftBody"),
				confirmLabel: t("messageList.edit.overwriteDraftConfirm"),
				cancelLabel: t("messageList.interrupt.cancel"),
				onConfirm: startEdit,
			});
			return;
		}
		startEdit();
	}, [applyEditFill, isPendingEdit, setConfirmDialog, t]);

	const handleSwitchBranch = useCallback(
		(direction: -1 | 1) => {
			if (!branch || !message.entryId || !activeSessionRuntimeId) return;
			const nextIndex = branch.index + direction;
			if (nextIndex < 0 || nextIndex >= branch.siblings.length) return;
			const targetId = branch.siblings[nextIndex];
			if (!targetId || targetId === message.entryId) return;
			// Cancel pending edit when switching branches
			getDefaultStore().set(pendingMessageEditAtom, null);
			runWithInterruptConfirm("switch", async () => {
				const runtimeId = activeSessionRuntimeId;
				await window.vetta.session.switchBranch(runtimeId, targetId);
				await reloadChatHistory(runtimeId);
			});
		},
		[activeSessionRuntimeId, branch, message.entryId, runWithInterruptConfirm],
	);

	const handleFork = useCallback(() => {
		if (!message.entryId || !activeSessionRuntimeId) return;
		runWithInterruptConfirm("fork", async () => {
			// Drop any in-progress re-edit before switching sessions — pending entryIds
			// belong to the source session and cannot be replaced after opening the fork.
			const store = getDefaultStore();
			// 不在此处清输入：openSession 会落盘当前会话草稿再装入 fork 会话草稿，
			// 避免误把父会话未发送内容写成空并丢掉。
			store.set(pendingMessageEditAtom, null);

			const runtimeId = activeSessionRuntimeId;
			const cwd = activeSessionCwd;
			const { path } = await window.vetta.session.forkSession(runtimeId, message.entryId!);
			const open = openSessionFnRef.current;
			if (open && cwd) {
				await open(cwd, path);
			}
			// Fork file includes the selected user message; leaf is that message.
			// Do not set pendingMessageEdit — next send is a normal follow-up.
			store.set(pendingMessageEditAtom, null);
		});
	}, [activeSessionCwd, activeSessionRuntimeId, message.entryId, runWithInterruptConfirm]);

	const closeContextMenu = useCallback(() => setContextMenuPosition(null), []);

	const handleOpenContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
		event.preventDefault();
		setContextMenuPosition({
			x: Math.max(
				CONTEXT_MENU_VIEWPORT_GAP,
				Math.min(event.clientX, window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_VIEWPORT_GAP),
			),
			y: Math.max(
				CONTEXT_MENU_VIEWPORT_GAP,
				Math.min(event.clientY, window.innerHeight - CONTEXT_MENU_HEIGHT - CONTEXT_MENU_VIEWPORT_GAP),
			),
		});
	}, []);

	const handleMenuEdit = useCallback(() => {
		closeContextMenu();
		handleEdit();
	}, [closeContextMenu, handleEdit]);

	const handleMenuCopy = useCallback(() => {
		closeContextMenu();
		if (!copyText) return;
		void navigator.clipboard.writeText(copyText).catch((error) => {
			console.warn("[useUserMessageModel] copy failed", error);
		});
	}, [closeContextMenu, copyText]);

	const performDelete = useCallback(
		async (suppressForOneMinute: boolean): Promise<void> => {
			if (!message.entryId || !activeSessionRuntimeId) return;
			const runtimeId = activeSessionRuntimeId;
			if (isStreaming) {
				onAbortEdit?.();
				await abortAndWait(runtimeId);
			}
			await window.vetta.session.deleteMessage(runtimeId, message.entryId);
			if (suppressForOneMinute) {
				deleteConfirmationSuppressedUntil = Date.now() + DELETE_CONFIRMATION_SUPPRESSION_MS;
			}
			if (pendingEdit?.entryId === message.entryId) {
				getDefaultStore().set(pendingMessageEditAtom, null);
			}
			await reloadChatHistory(runtimeId);
		},
		[activeSessionRuntimeId, isStreaming, message.entryId, onAbortEdit, pendingEdit?.entryId],
	);

	const runDelete = useCallback(
		(suppressForOneMinute: boolean) => {
			void performDelete(suppressForOneMinute).catch((error) => {
				console.error("[useUserMessageModel] delete failed:", error);
			});
		},
		[performDelete],
	);

	const handleMenuDelete = useCallback(() => {
		closeContextMenu();
		if (!canDelete) return;
		if (Date.now() < deleteConfirmationSuppressedUntil) {
			runDelete(false);
			return;
		}
		setConfirmDialog({
			title: t("messageList.delete.title"),
			message: t(isStreaming ? "messageList.delete.streamingBody" : "messageList.delete.body"),
			confirmLabel: t("messageList.delete.confirm"),
			cancelLabel: t("messageList.interrupt.cancel"),
			checkbox: {
				label: t("messageList.delete.suppressForOneMinute"),
				checked: false,
			},
			variant: "danger",
			onConfirm: runDelete,
		});
	}, [canDelete, closeContextMenu, isStreaming, runDelete, setConfirmDialog, t]);

	const labels = {
		expand: t("messageList.userMessage.expand"),
		edit: t("messageList.editButton"),
		fork: t("messageList.forkButton"),
		skillBadge: t("messageList.userMessage.skillBadge"),
		sceneBadge: t("messageList.userMessage.sceneBadge"),
		branchPrev: t("messageList.branch.prev"),
		branchNext: t("messageList.branch.next"),
		branchPosition: branch
			? t("messageList.branch.position", { current: branch.index + 1, total: branch.siblings.length })
			: "",
		pendingEdit: t("messageList.edit.pendingHint"),
	};

	const settingsLabel = hasSettingsAssistBadge
		? t(
				isSettingsAssistTabId(settingsAssistTabId)
					? (`messageList.userMessage.settingsAssist.${settingsAssistTabId}` as const)
					: "messageList.userMessage.settingsAssist.unknown",
			)
		: "";

	const badges: ReactNode = (
		<>
			{hasSettingsAssistBadge && <SettingsAssistBadgeView label={settingsLabel} />}
		</>
	);

	const images: ReactNode = (
		<div className="flex max-w-full justify-end gap-2 overflow-x-auto">
			{imageItems.map((item, index) => {
				const src = getPreviewImageSrc(item);
				return (
					<button
						key={item.path ?? item.url ?? `${item.name}-${index}`}
						type="button"
						onClick={() => setFilePreview({ items: imageItems, index })}
						className="group relative h-20 w-20 overflow-hidden rounded-xl border border-border/60 bg-muted/60 transition-colors hover:border-primary/50"
						title={item.path ?? item.name}
					>
						<img src={src} alt={item.name} className="h-full w-full object-cover" />
						<span className="pointer-events-none absolute inset-0 bg-foreground/0 transition-colors group-hover:bg-foreground/10" />
						{/* 与正文里「图 N」胶囊对应的角标 */}
						<span className="pointer-events-none absolute bottom-1 right-1 rounded bg-foreground/45 px-1 text-[9px] font-medium leading-[1.4] text-background/90">
							{(item.path ? imageLabelByPath.get(toTokenPath(item.path)) : undefined) ??
								t("inputBar.capsule.imageBadge", { index: index + 1 })}
						</span>
					</button>
				);
			})}
		</div>
	);

	const fileBadgeNodes: ReactNode = (
		<>
			{fileBadges.map((file) => {
				const name = pathBasename(file);
				return (
					<button
						key={file}
						type="button"
						className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
						title={file}
						onClick={() => setFilePreview({ name, path: file })}
					>
						<span className="icon-[solar--file-linear] h-3 w-3" />
						{name}
					</button>
				);
			})}
		</>
	);

	return {
		// 入场动画只服务于 site 的演示流；桌面端恒静态，不驱动 motion。
		entryState: "static",
		displayText,
		hasImages,
		hasSkillBadge,
		hasSettingsAssistBadge,
		hasFileBadges,
		hasAppshot: Boolean(appshotData),
		copyText,
		contextMenu: contextMenuPosition
			? {
					canCopy: Boolean(copyText),
					canDelete,
					canEdit,
					labels: {
						copy: t("messageList.contextMenu.copy"),
						delete: t("messageList.contextMenu.delete"),
						edit: t("messageList.contextMenu.edit"),
					},
					onClose: closeContextMenu,
					onCopy: handleMenuCopy,
					onDelete: handleMenuDelete,
					onEdit: handleMenuEdit,
					x: contextMenuPosition.x,
					y: contextMenuPosition.y,
				}
			: null,
		isLastUserMessage,
		canEdit,
		canSwitchBranch,
		canFork,
		isPendingEdit,
		branchIndex: branch?.index ?? 0,
		branchTotal: branch?.siblings.length ?? 0,
		actionsVisible,
		labels,
		appshot: appshotData ? <AppshotCard data={appshotData} /> : null,
		images,
		badges,
		fileBadges: fileBadgeNodes,
		textBody: (
			<TextBlockView
				text={displayText}
				inlineTokens={{
					getImageLabel: (path) =>
						imageLabelByPath.get(toTokenPath(path)) ?? pathBasename(path),
					getSkill: (name) => resolveSkillMeta("skill", name),
					getScene: (name) => resolveSkillMeta("scene", name),
				}}
				className="max-w-full overflow-x-auto [overflow-wrap:anywhere] [&_code]:break-all"
			/>
		),
		relativeTime: null,
		copyButton: <CopyButton getText={() => copyText} />,
		onContextMenu: handleOpenContextMenu,
		onEdit: handleEdit,
		onFork: handleFork,
		onBranchPrev: () => handleSwitchBranch(-1),
		onBranchNext: () => handleSwitchBranch(1),
		onActionsVisibleChange: setActionsVisible,
	};
}
