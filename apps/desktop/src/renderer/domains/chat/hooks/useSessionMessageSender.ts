import { waitForPluginHostFirstReady } from "@domains/plugins/runtime/plugin-events";
import { useProjectActions } from "@domains/project/hooks/useProjects";
import type { PersistedImageResult } from "@preload/api";
import { type ConversationUserMessageViewModel, createConversationUserMessage } from "@shared/conversation";
import { i18n } from "@shared/i18n";
import {
	BUILTIN_KNOWLEDGE_RETRIEVAL_ACTION_ID,
	recordInputActionsUsed,
	recordInputContextUsed,
} from "@shared/lib/app-monitor-events";
import { deriveSkillNames, MultipleSceneReferencesError, prepareInputPrompt } from "@shared/lib/input-tokens";
import { perfSendComplete, perfSendMark } from "@shared/lib/perf-send";
import {
	activeInputActionIdsAtom,
	activeInputDraftKeyAtom,
	activeSessionAtom,
	activeSessionStreamingAtom,
	appshotAttachmentAtom,
	attachedImagesAtom,
	batchProjectsAtom,
	chatMessagesAtom,
	conversationBucketCwd,
	defaultConversationCwdAtom,
	inputValueAtom,
	isStreamingAtom,
	knowledgeRetrievalActiveAtom,
	mentionedFilesAtom,
	pendingMessageEditAtom,
	pendingSessionCreationAtom,
	pendingSessionOpenAtom,
	pluginInputActionsAtom,
	projectsAtom,
	promptAttachmentAtom,
	promptSuggestionsAtom,
	pushSessionInputHistory,
	reasoningByModelAtom,
	recordSentInputAndClearDraft,
	retryProgressAtom,
	type SendMessageOptions,
	type SendMessageResult,
	selectedModelAtom,
	todoItemsBySessionAtom,
} from "@shared/store/atoms";
import { bumpQueuedDispatchSeq } from "@shared/store/message-queue-atoms";
import type { PromptAttachmentRef, PromptRequest } from "@vetta/runtime-core";
import type { PluginPromptContext } from "@vetta-org/plugin-sdk";
import { getDefaultStore, useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useRef } from "react";
import { appendError, fullHistoryToChat, isUserImageFile, nextId, toChatErrorDetails } from "../services/chat-service";
import { rememberOptimisticUserMessage } from "../services/optimistic-user-message-cache";
import { getSessionRuntimeWhenReady } from "../services/session-runtime-readiness";
import {
	restoreStagedPendingSessionSend,
	stagePendingSessionSend,
	takeStagedPendingSessionSend,
} from "../services/staged-new-session-send";

interface SessionMessageSenderOptions {
	bumpSuggestionToken: (runtimeId: string) => void;
}

export interface SessionMessageSender {
	sendMessage: (overrideText?: string, options?: SendMessageOptions) => Promise<SendMessageResult | undefined>;
	abortMessage: () => Promise<void>;
	sendQueuedNow: (runtimeId: string, id: string) => Promise<void>;
}

function modelKeyToParts(key: string | null | undefined): { provider: string; id: string } | undefined {
	if (!key) return undefined;
	const separator = key.indexOf("/");
	if (separator <= 0) return undefined;
	return { provider: key.slice(0, separator), id: key.slice(separator + 1) };
}

function getProjects() {
	return getDefaultStore().get(projectsAtom);
}

export function useSessionMessageSender({ bumpSuggestionToken }: SessionMessageSenderOptions): SessionMessageSender {
	const activeSession = useAtomValue(activeSessionAtom);
	const [attachedImages, setAttachedImages] = useAtom(attachedImagesAtom);
	const [mentionedFiles, setMentionedFiles] = useAtom(mentionedFilesAtom);
	const appshotAttachment = useAtomValue(appshotAttachmentAtom);
	const [selectedModel] = useAtom(selectedModelAtom);
	const todoItemsMap = useAtomValue(todoItemsBySessionAtom);
	const batchProjects = useAtomValue(batchProjectsAtom);
	const defaultConversationCwd = useAtomValue(defaultConversationCwdAtom);
	const setChatMessages = useSetAtom(chatMessagesAtom);
	const setActiveSessionStreaming = useSetAtom(activeSessionStreamingAtom);
	const setPromptSuggestions = useSetAtom(promptSuggestionsAtom);
	const setRetryProgress = useSetAtom(retryProgressAtom);
	const { loadSessions, ensureLocalSession } = useProjectActions();

	const attachedImagesRef = useRef(attachedImages);
	attachedImagesRef.current = attachedImages;
	const mentionedFilesRef = useRef(mentionedFiles);
	mentionedFilesRef.current = mentionedFiles;
	const appshotRef = useRef(appshotAttachment);
	appshotRef.current = appshotAttachment;
	const selectedModelRef = useRef(selectedModel);
	selectedModelRef.current = selectedModel;
	const todoItemsMapRef = useRef(todoItemsMap);
	todoItemsMapRef.current = todoItemsMap;
	const batchProjectsRef = useRef(batchProjects);
	batchProjectsRef.current = batchProjects;
	const defaultConversationCwdRef = useRef(defaultConversationCwd);
	defaultConversationCwdRef.current = defaultConversationCwd;

	const sendMessage = useCallback(
		async (overrideText?: string, options?: SendMessageOptions): Promise<SendMessageResult | undefined> => {
			const interactionId = options?.interactionId;
			let stagedInput = options?.stagedInput;
			// 目标会话读共享 atom（store 直读，不走 React 闭包）：openSession 同步写入
			// activeSessionAtom，同一 tick 内「创建会话+发送」的组合仍读得到新值。不能读
			// 实例级 activeSessionRef——useSessionManager 同时挂载多份（RootLayout /
			// ChatPage / NewSessionPage），pluginSendMessageRef 只留最后渲染者的
			// sendMessage，而该实例的 ref 记的是「它自己最后打开的会话」，与用户当前
			// 激活会话可能相差很久：插件派活曾因此落进另一个 workspace 的陈年会话。
			const store = getDefaultStore();
			const transitionPending =
				store.get(pendingSessionOpenAtom) !== null || store.get(pendingSessionCreationAtom) !== null;
			let session = store.get(activeSessionAtom);
			if (transitionPending && !stagedInput) {
				const deferredInteractionId = interactionId ?? `pending-send-${Date.now()}`;
				stagedInput = stagePendingSessionSend(overrideText, deferredInteractionId) ?? undefined;
				if (!stagedInput) return;
				const stagedMessageId = stagedInput.optimisticMessage.id;
				session = await getSessionRuntimeWhenReady();
				const acceptedInput = takeStagedPendingSessionSend(stagedMessageId);
				if (!acceptedInput) return;
				stagedInput = acceptedInput;
				if (!session) {
					restoreStagedPendingSessionSend(stagedInput);
					return;
				}
			}
			// 不订阅输入 atom；调用时读取还能覆盖“先写草稿、同一流程立即发送”的场景。
			const inputValue = stagedInput?.rawText ?? store.get(inputValueAtom);
			const attachedImages = stagedInput?.attachedImages ?? attachedImagesRef.current;
			const mentionedFiles = stagedInput?.mentionedFiles ?? mentionedFilesRef.current;
			const appshot = stagedInput ? stagedInput.appshot : appshotRef.current;
			const selectedModel = stagedInput ? stagedInput.selectedModel : selectedModelRef.current;
			// overrideText：来自输入预测建议（点击 bubble / 空输入回车按 placeholder 发送），
			// 作为独立 prompt 直发，不带技能 / @文件前缀，也不消费当前草稿与附图。
			const override = typeof overrideText === "string" ? overrideText.trim() : "";
			const hasOverride = stagedInput?.hasOverride ?? override.length > 0;
			if (
				!session?.runtimeId ||
				(!hasOverride &&
					!inputValue.trim() &&
					attachedImages.length === 0 &&
					mentionedFiles.length === 0 &&
					!appshot)
			) {
				return;
			}
			// 发出新 prompt：清空该会话的输入预测，并作废仍在飞的生成（过期判定）。
			// 插件静默发送不动用户正在看的预测。
			if (options?.source !== "plugin") {
				bumpSuggestionToken(session.runtimeId);
				setPromptSuggestions((prev) => {
					if (!(session.runtimeId in prev)) return prev;
					const next = { ...prev };
					delete next[session.runtimeId];
					return next;
				});
			}
			perfSendMark("sender-enter", interactionId);
			const rawText = stagedInput?.rawText ?? (hasOverride ? override : inputValue.trim());
			let preparedInput: ReturnType<typeof prepareInputPrompt>;
			try {
				preparedInput = prepareInputPrompt(rawText);
			} catch (error) {
				if (!(error instanceof MultipleSceneReferencesError)) throw error;
				const message = i18n.t("chat:inputBar.error.multipleScenes");
				setChatMessages((prev) => appendError(prev, message));
				return { status: "failed", error: { message } };
			}
			const images = !hasOverride && attachedImages.length > 0 ? attachedImages : undefined;
			// 把附图落盘到会话图片缓存，改用 @路径 引用而非把 base64 塞进上下文：
			// 视觉模型经 Read 工具即可看到图，不支持视觉的模型也能用工具对图做 OCR/改图等。
			let imagePaths: string[] = [];
			let persistedImages: PersistedImageResult[] = [];
			if (images) {
				try {
					persistedImages = await window.vetta.dialog.persistImages(
						session.runtimeId,
						images.map((img) => ({ id: img.id, data: img.data, mimeType: img.mimeType })),
					);
					imagePaths = persistedImages.map((image) => image.path);
				} catch (err) {
					console.error("[useSessionManager.sendMessage] persistImages failed:", err);
				}
			}
			const promptRef =
				!hasOverride && preparedInput.sceneName
					? { kind: "scene" as const, name: preparedInput.sceneName }
					: undefined;
			const attachmentsByPath = new Map<string, PromptAttachmentRef>();
			if (!hasOverride) {
				for (const file of mentionedFiles) {
					attachmentsByPath.set(file.path, {
						kind: file.isDirectory ? "directory" : isUserImageFile(file.path) ? "image" : "file",
						path: file.path,
					});
				}
				if (appshot?.imagePath) {
					attachmentsByPath.set(appshot.imagePath, { kind: "image", path: appshot.imagePath });
				}
				if (appshot?.textPath) {
					attachmentsByPath.set(appshot.textPath, { kind: "file", path: appshot.textPath });
				}
				for (const path of imagePaths) {
					attachmentsByPath.set(path, { kind: "image", path });
				}
			}
			const attachments = [...attachmentsByPath.values()];
			const text = hasOverride ? rawText : preparedInput.text;
			if (stagedInput && imagePaths.length > 0) {
				const stagedId = stagedInput.optimisticMessage.id;
				setChatMessages((messages) =>
					messages.map((message) =>
						message.id === stagedId && message.kind === "user"
							? { ...message, attachments, images: undefined }
							: message,
					),
				);
			}
			recordInputContextUsed({
				files: hasOverride ? [] : mentionedFiles,
				images: hasOverride ? [] : persistedImages,
				...(promptRef ? { promptRef } : {}),
			});
			// 行内 skill 是软引用，不进 promptRef，但调用次数仍要计入 app-monitor
			// （命令面板按使用频次排序依赖这份统计）。每个被引用的 skill 记一次。
			if (!hasOverride) {
				for (const name of deriveSkillNames(preparedInput.segments)) {
					recordInputContextUsed({ promptRef: { kind: "skill", name } });
				}
			}
			if (!hasOverride) {
				// 普通发送清理当前草稿；提前上屏的新会话首条只补记历史。
				perfSendMark("clear-draft-start", interactionId);
				if (stagedInput) {
					// 用户可能已在 Runtime 创建期间输入下一条消息。首条只补记历史，
					// 不得清掉当前编辑器中后来产生的新草稿与附件。
					pushSessionInputHistory(getDefaultStore().get(activeInputDraftKeyAtom), rawText);
				} else {
					recordSentInputAndClearDraft(rawText);
					setAttachedImages([]);
					setMentionedFiles([]);
				}
				perfSendMark("clear-draft-end", interactionId);
			}
			// 最后一条用户消息重编辑：提交时先中止当前生成，再删除旧消息及其回复子树；
			// 随后的正常 prompt 从原 parent 继续，因此不会创建会话内分支。
			const pendingEdit = store.get(pendingMessageEditAtom);
			if (pendingEdit) {
				if (store.get(isStreamingAtom)) {
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
							if (p.sessionId === session.runtimeId && p.running === false) finish();
						});
						if (!store.get(isStreamingAtom)) {
							finish();
							return;
						}
						void window.vetta.session.abort(session.runtimeId).catch((err) => {
							console.error("[useSessionManager.sendMessage] abort before edit failed:", err);
						});
					});
				}
				try {
					await window.vetta.session.replaceLastUserMessage(session.runtimeId, pendingEdit.entryId);
					const history = await window.vetta.session.getFullHistory(session.runtimeId);
					setChatMessages(fullHistoryToChat(history));
					store.set(pendingMessageEditAtom, null);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					console.error("[useSessionManager.sendMessage] replaceLastUserMessage failed:", err);
					store.set(pendingMessageEditAtom, null);
					setChatMessages((prev) => appendError(prev, message));
					return;
				}
			}

			// streaming 期间发送 = 排队等下一轮：跳过「用户气泡 / 清产物列表 / 乐观侧边栏 /
			// 清 todo」这些开启新一轮才该有的副作用，仅在下方组装好 promptReq 快照后入队。
			// （输入框已在上方清空，符合「入队后清空输入框」语义。）
			const streaming = pendingEdit ? false : getDefaultStore().get(isStreamingAtom);
			let optimisticUserMsgId: string | undefined;
			if (!streaming && stagedInput) {
				optimisticUserMsgId = stagedInput.optimisticMessage.id;
				rememberOptimisticUserMessage(
					session.runtimeId,
					{
						...stagedInput.optimisticMessage,
						attachments,
						...(imagePaths.length > 0 ? { images: undefined } : {}),
					},
					[],
				);
			} else if (!streaming) {
				// 失败重发去重（ADR-0060）：上一轮以错误收尾且最后一条用户消息与本次
				// 文本相同时，先 replaceLastUserMessage 回退再发，避免 jsonl 双份 user
				// 记录、也避免下一轮模型上下文里出现两条相同消息。
				if (!pendingEdit) {
					const currentMsgs = store.get(chatMessagesAtom);
					const lastMsg = currentMsgs.at(-1);
					let lastUserIdx = -1;
					for (let i = currentMsgs.length - 1; i >= 0; i--) {
						if (currentMsgs[i].kind === "user") {
							lastUserIdx = i;
							break;
						}
					}
					const lastUserCandidate = lastUserIdx >= 0 ? currentMsgs[lastUserIdx] : undefined;
					const lastUser = lastUserCandidate?.kind === "user" ? lastUserCandidate : undefined;
					if (
						lastMsg?.kind === "agent" &&
						lastMsg.blocks.some((block) => block.type === "error") &&
						lastUser?.entryId &&
						lastUser.text === text
					) {
						try {
							await window.vetta.session.replaceLastUserMessage(session.runtimeId, lastUser.entryId);
							setChatMessages((prev) => prev.slice(0, lastUserIdx));
						} catch (err) {
							// 回退失败就按普通追加发送；宁可重复也不丢消息。
							console.warn("[useSessionManager.sendMessage] resend dedupe failed:", err);
						}
					}
				}
				const userMsg: ConversationUserMessageViewModel = createConversationUserMessage({
					id: nextId("user"),
					deliveryPhase: "pending",
					text,
					timestamp: Date.now(),
					model: modelKeyToParts(selectedModel),
					promptRef,
					attachments,
				});
				// Base64 preview only when persistence failed; structured image paths
				// are otherwise the canonical source for optimistic and restored UI.
				if (images && imagePaths.length === 0) {
					userMsg.images = images.map((img) => ({ data: img.data, mimeType: img.mimeType, name: img.name }));
				}
				if (appshot) {
					userMsg.appshot = appshot;
				}
				userMsg.mentionedFiles = mentionedFiles.slice();
				const settingsAssistTabId = options?.settingsAssistTabId?.trim();
				if (settingsAssistTabId) {
					userMsg.settingsAssistTabId = settingsAssistTabId;
				}
				rememberOptimisticUserMessage(session.runtimeId, userMsg, store.get(chatMessagesAtom));
				perfSendMark("optimistic-append", interactionId);
				setChatMessages((prev) => [...prev, userMsg]);
				optimisticUserMsgId = userMsg.id;
			}

			// Optimistically expose this session in the sidebar before the disk file
			// has been flushed (SessionManager only writes after the assistant's
			// first message). Use the user's prompt prefix as a temporary label;
			// auto-title or the next loadSessions will overwrite as appropriate.
			const sp = session.sessionPath;
			if (!streaming && sp) {
				// ADR-0007：「对话」session 的 cwd 是默认项目根下的 per-session 子目录，
				// 但侧边栏 sessionsMap / 默认列表都挂在项目根 bucket 上。乐观行必须落到根
				// bucket，否则既不在「会话」列表显示，auto-title 的 applyLocalRename(root,…)
				// 也会因 bucket 不匹配而落空，导致改名要等下一次磁盘刷新才生效。
				const bucketCwd = conversationBucketCwd(session.cwd, defaultConversationCwdRef.current);
				ensureLocalSession(bucketCwd, {
					id: session.runtimeId,
					path: sp,
					cwd: session.cwd,
					firstMessage: text.slice(0, 80) || i18n.t("chat:session.emptyMessageLabel"),
					modifiedAt: Date.now(),
				});
			}

			// 检查当前 session 是否归属一个 paused 的 batch-task 子任务。命中则改走
			// resume 路径（入队首，由调度器按并发数放行），跳过 session.prompt。
			let pausedBatch: { projectId: string; taskId: string } | undefined;
			for (const p of batchProjectsRef.current) {
				const matched = p.tasks.find((t) => t.sessionId === session.runtimeId && t.status === "paused");
				if (matched) {
					pausedBatch = { projectId: p.id, taskId: matched.id };
					break;
				}
			}

			if (pausedBatch) {
				try {
					// The batch resume contract still accepts text only. Preserve attachment
					// behavior there through the legacy prefix format until that API is migrated.
					const legacyText = attachments.length
						? `${attachments.map((attachment) => `@${attachment.path}`).join("\n")}\n${text}`
						: text;
					await window.vetta.batchTasks.resumeTaskWithText(pausedBatch.projectId, pausedBatch.taskId, legacyText);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					console.error("[useSessionManager.sendMessage] resumeTaskWithText rejected:", err);
					setChatMessages((prev) => appendError(prev, message));
				}
				await loadSessions(session.cwd);
				return;
			}

			// 非批量任务项目：若该 session 已有 todo 且全部 done，在发起下一个
			// prompt 前先清空 todo 列表，让用户开启新一轮工作时面板回到干净状态。
			// 批量任务依赖严格 todo 机制，不在此清空；scene 等 lock 状态后端会自行拒绝。
			// streaming 入队时不清：当前正在跑的回合仍拥有这些 todo。
			if (!streaming) {
				const projectType = getProjects().find((p) => p.cwd === session.cwd)?.type;
				if (projectType !== "batch") {
					const items = todoItemsMapRef.current.get(session.runtimeId) ?? [];
					if (items.length > 0 && items.every((i) => i.status === "done")) {
						try {
							await window.vetta.session.clearTodos(session.runtimeId);
						} catch (err) {
							console.error("[useSessionManager.sendMessage] clearTodos failed:", err);
						}
					}
				}
			}

			const promptReq: PromptRequest = {
				text: text || "(see attached content)",
				promptRef,
			};
			if (attachments.length > 0 || pendingEdit) {
				promptReq.attachments = attachments;
			}
			if (images && imagePaths.length === 0) {
				promptReq.images = images.map((image) => ({
					type: "image",
					data: image.data,
					mimeType: image.mimeType,
				}));
			}
			if (selectedModel) {
				promptReq.modelKey = selectedModel;
				// Per-model reasoning level rides alongside modelKey (see reasoning-level design).
				const level = getDefaultStore().get(reasoningByModelAtom)[selectedModel];
				if (level) promptReq.reasoning = level;
			}
			// Caller-supplied metadata first (e.g. settings AI assist model-only instruction).
			if (options?.metadata && Object.keys(options.metadata).length > 0) {
				promptReq.metadata = { ...options.metadata };
			}
			// Merge metadata and hidden instructions contributed by active plugin
			// input actions.
			const pluginStore = getDefaultStore();
			const usedInputActions: Parameters<typeof recordInputActionsUsed>[0] = [];
			const pluginInstructions: string[] = [];
			const pluginPromptContexts: Array<PluginPromptContext & { pluginId: string }> = [];
			const activeActionIds = pluginStore.get(activeInputActionIdsAtom);
			if (activeActionIds.size > 0) {
				for (const action of pluginStore.get(pluginInputActionsAtom)) {
					if (!activeActionIds.has(action.actionId)) continue;
					const decoration = action.decoratePrompt?.();
					if (decoration?.metadata) {
						promptReq.metadata = { ...promptReq.metadata, ...decoration.metadata };
					}
					if (decoration?.instructions) {
						pluginInstructions.push(
							...decoration.instructions.filter(
								(instruction) => typeof instruction === "string" && instruction.trim().length > 0,
							),
						);
					}
					if (decoration?.metadata || decoration?.instructions) {
						usedInputActions.push({ actionId: action.actionId, actionKind: "plugin" });
					}
				}
			}
			// 原生「知识检索」开关（硬隔离）：开启后本轮携带 knowledgeMode——
			// input-pipeline 暴露 kb-read 工具并注入仅模型可见的「优先查询知识库」提示。
			if (pluginStore.get(knowledgeRetrievalActiveAtom)) {
				promptReq.metadata = { ...promptReq.metadata, knowledgeMode: true };
				usedInputActions.push({
					actionId: BUILTIN_KNOWLEDGE_RETRIEVAL_ACTION_ID,
					actionKind: "builtin",
				});
			}
			// Plugin-owned attachment data stays structured until the coding-agent
			// input boundary. Legacy metadata/instructions remain supported.
			// 插件 sendPrompt 不消费：promptAttachment 是用户为下一条手动消息挂的，
			// 被插件静默发送吃掉会既丢附件又让用户困惑（ADR-0060）。
			const promptAttachment = options?.source === "plugin" ? null : pluginStore.get(promptAttachmentAtom);
			if (promptAttachment) {
				if (promptAttachment.metadata) {
					promptReq.metadata = { ...promptReq.metadata, ...promptAttachment.metadata };
				}
				pluginInstructions.push(
					...(promptAttachment.instructions ?? []).filter(
						(instruction) => typeof instruction === "string" && instruction.trim().length > 0,
					),
				);
				if (promptAttachment.context) {
					pluginPromptContexts.push({
						pluginId: promptAttachment.ownerPluginId,
						...structuredClone(promptAttachment.context),
					});
				}
				if (promptAttachment.lifecycle !== "sticky") {
					pluginStore.set(promptAttachmentAtom, null);
				}
			}
			if (pluginInstructions.length > 0) {
				promptReq.metadata = { ...promptReq.metadata, pluginInstructions };
			}
			if (pluginPromptContexts.length > 0) {
				promptReq.metadata = { ...promptReq.metadata, pluginPromptContexts };
			}
			recordInputActionsUsed(usedInputActions);
			// 恒置 followUp（ADR-0060）：streaming 中入 kernel 队列、立即收 queued 回执；
			// 空闲时 kernel 忽略该字段直接开 turn。即便 isStreamingAtom 与主进程真实状态
			// 失步，最坏结果也是入队而非 SESSION_BUSY 丢消息。
			promptReq.streamingBehavior = "followUp";
			let sendResult: SendMessageResult | undefined;
			try {
				perfSendMark("await-plugin-host", interactionId);
				// 只等首次激活：热重载期间旧工具注册仍有效（last-known-good），
				// 不再让插件集合变化把每次发送挡住最长 5 秒。
				await waitForPluginHostFirstReady();
				perfSendMark("prompt-ipc-start", interactionId);
				const promptPromise = window.vetta.session.prompt(
					session.runtimeId,
					promptReq,
					interactionId ? { interactionId } : undefined,
				);
				perfSendComplete("prompt-dispatched", interactionId);
				const outcome = await promptPromise;
				perfSendMark("prompt-ipc-end", interactionId);
				if (outcome?.status === "queued") {
					if (optimisticUserMsgId) {
						// 以为空闲实则已在跑：消息已入 kernel 队列，撤掉抢先的乐观气泡，
						// 待消费时经 queue.changed 重新上屏，保证顺序与模型可见一致。
						const staleId = optimisticUserMsgId;
						setChatMessages((prev) => prev.filter((m) => m.id !== staleId));
					}
					sendResult = { status: "queued", queueItemId: outcome.queueItemId };
				} else if (outcome?.status === "failed") {
					// A terminal failure is a normal prompt receipt, not a rejected IPC call.
					// Render it here as the authoritative fallback when the event stream is
					// delayed or lost. appendError deduplicates the later error event by turnId.
					const message =
						outcome.error?.message?.trim() || i18n.t("chat:messageList.errorBlock.kinds.unknown.title");
					setChatMessages((prev) =>
						appendError(prev, message, undefined, outcome.turnId, toChatErrorDetails(outcome.error)),
					);
					setActiveSessionStreaming(false);
					setRetryProgress(null);
					sendResult = { status: "failed", error: { message } };
				} else {
					sendResult = { status: "sent" };
				}
			} catch (err) {
				// RuntimeHost.prompt 现在会先把 prompt 期同步抛错（"No model
				// selected" / "No API key found" / "Agent is already processing"
				// 等）转换成 error 事件广播给所有订阅者，再把异常向上抛——所以
				// 正常情况下这里 catch 到的时候 chat 里已经多了一条 error block。
				// 但保留这层兜底是因为：(1) 旧版 RuntimeHost 或其它 host 实现未
				// 必有合成事件机制；(2) IPC 链路自身（preload / electron）出错
				// 时不会经过 RuntimeHost。任何 reject 在这里直接落成一条 error
				// 气泡，杜绝「按了发送但屏幕完全没反应」的死寂体验。
				const message = err instanceof Error ? err.message : String(err);
				console.error("[useSessionManager.sendMessage] prompt rejected:", err);
				setChatMessages((prev) => {
					const last = prev.at(-1);
					const lastError = last?.kind === "agent" ? last.blocks.at(-1) : undefined;
					if (last?.kind === "agent" && lastError?.type === "error" && lastError.text === message) return prev;
					return appendError(prev, message);
				});
				sendResult = { status: "failed", error: { message } };
			}
			// ADR-0007：归一回项目根 bucket，否则「对话」session 刷的是没用的子目录桶，
			// 侧边栏默认列表（挂在根 bucket）拿不到这一轮的对账更新。
			void loadSessions(conversationBucketCwd(session.cwd, defaultConversationCwdRef.current)).catch((err) => {
				console.warn("[useSessionManager.sendMessage] background session list refresh failed", err);
			});
			return sendResult;
		},
		[
			// 输入文本调用时读 store，其余输入相关值读 ref，不再入依赖，保证
			// sendMessage 身份在打字时稳定，避免下游
			// Virtuoso footer 重挂载（footer 内的插件 turn 卡会因此闪烁/重查）。
			setAttachedImages,
			setMentionedFiles,
			setChatMessages,
			loadSessions,
			ensureLocalSession,
			setPromptSuggestions,
			setActiveSessionStreaming,
			setRetryProgress,
			bumpSuggestionToken,
		],
	);

	const abortMessage = useCallback(async () => {
		if (!activeSession?.runtimeId) return;
		await window.vetta.session.abort(activeSession.runtimeId);
	}, [activeSession]);

	// 立即发送某条排队消息（队列面板点击 / 拖拽后即时发）。ADR-0060：打断与续发在
	// kernel 内原子完成（take → cancel 当前回合 → 以该条目开新 turn），渲染端不再
	// 等待 running-changed、没有超时竞态。用户气泡在消费时经 queue.changed 差分上屏。
	const sendQueuedNow = useCallback(
		async (runtimeId: string, id: string) => {
			// 被打断回合的 agent_end 整体重拉已「跨到下一轮」：+1 序号使其落地时被判
			// 过期而跳过，避免冲掉新一轮的用户气泡（判活机制见 message-queue-atoms）。
			bumpQueuedDispatchSeq(runtimeId);
			try {
				await window.vetta.session.sendQueuedMessageNow(runtimeId, id);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error("[useSessionManager.sendQueuedNow] failed:", err);
				if (getDefaultStore().get(activeSessionAtom)?.runtimeId === runtimeId) {
					setChatMessages((prev) => appendError(prev, message));
				}
			}
		},
		[setChatMessages],
	);

	return { sendMessage, abortMessage, sendQueuedNow };
}
