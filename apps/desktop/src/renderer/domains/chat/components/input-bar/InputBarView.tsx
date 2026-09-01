import { createPortal } from "react-dom";
import { PerfSendProfiler } from "@shared/lib/perf-send";
import { AnimatePresence, motion } from "motion/react";
import { useThemeComponent } from "@vetta/theme-sdk";
import { useThemeSurface } from "@vetta/theme-sdk/appearance";
import {
	ConversationComposerView,
	InputBarContextMenuView,
	InputBarPlaceholder,
} from "@vetta/theme-ui/chat";
import { useDelayedUnmount } from "@vetta/theme-ui/shared";
import { CommandPanel } from "../command-panel/CommandPanel";
import { AtPanel } from "../AtPanel";
import { ActionButtonBar } from "../ActionButtonBar";
import { QuestionPanel } from "../QuestionPanel";
import { McpElicitationPanel } from "../McpElicitationPanel";
import { AppshotCard } from "../AppshotCard";
import { InputBarBackground } from "./InputBarBackground";
import { InputBarDrawer } from "./InputBarDrawer";
import { InputBarFooter } from "./InputBarFooter";
import { InputBarTodoStatus } from "./InputBarTodoStatus";
import { InputBarSpeechStatus } from "./InputBarSpeechStatus";
import { PromptAttachmentLabels } from "./PromptAttachmentLabels";
import { InputBarToolbar } from "./InputBarToolbar";
import { InputEditor } from "./editor/InputEditor";
import type { InputBarViewProps } from "./types";

const SOFT = { duration: 0.18, ease: [0.22, 0.61, 0.36, 1] as const };

export function InputBarView({ model, className, classNames }: InputBarViewProps): JSX.Element {
	const hasPendingInteraction = Boolean(model.pendingMcpElicitation || model.pendingQuestion);
	const surface = useThemeSurface("chat.inputBar");
	const ThemedInputBarBackground = useThemeComponent(
		"chat.inputBarBackground",
		InputBarBackground,
	);
	const ThemedInputBarPlaceholder = useThemeComponent(
		"chat.inputBarPlaceholder",
		InputBarPlaceholder,
	);
	// 附件胶囊区折叠动画播完（200ms）后再卸载内容，动画本身是纯 CSS grid 过渡。
	const renderCapsules = useDelayedUnmount(model.hasCapsules, 220);

	return (
		<div className={["relative px-2 pb-3 pt-1 sm:px-4 sm:pb-4", className, classNames?.root].filter(Boolean).join(" ")}>
			<AnimatePresence>
				{model.pendingMcpElicitation ? (
					<motion.div
						key="mcp-elicitation"
						initial={{ opacity: 0, y: 12 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: 12 }}
						transition={SOFT}
						className="absolute inset-x-0 bottom-0 z-20"
					>
						<McpElicitationPanel request={model.pendingMcpElicitation} />
					</motion.div>
				) : model.pendingQuestion ? (
					<motion.div
						key="ask-user-question"
						initial={{ opacity: 0, y: 12 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: 12 }}
						transition={SOFT}
						className="absolute inset-x-0 bottom-0 z-20"
					>
						<QuestionPanel pending={model.pendingQuestion} />
					</motion.div>
				) : null}
			</AnimatePresence>

			<div
				className={[
					// @container：工具栏/动作条按输入区宽度折叠文案（非视口），避免窄栏换行
					"relative mx-auto w-full max-w-2xl @container transition-opacity duration-150",
					hasPendingInteraction ? "pointer-events-none opacity-0" : "",
					classNames?.stack,
				]
					.filter(Boolean)
					.join(" ")}
				aria-hidden={hasPendingInteraction ? true : undefined}
			>
				<PerfSendProfiler id="ib:AtPanel">
					<AtPanel
						open={model.atOpen}
						onClose={model.actions.handleAtClose}
						onSelect={model.actions.handleAtSelect}
						filter={model.atFilter}
						cwd={model.effectiveCwd}
					/>
				</PerfSendProfiler>

				<PerfSendProfiler id="ib:ActionButtonBar">
					<ActionButtonBar />
				</PerfSendProfiler>

				<PromptAttachmentLabels
					labels={model.promptAttachmentLabels ?? []}
					icon={model.promptAttachmentIcon}
					removeLabel={model.labels.capsule.removeDefault}
					onRemove={model.actions.removePromptAttachment}
				/>

				<InputBarDrawer
					items={model.drawerItems}
					activeTabId={model.drawerActiveTab}
					onActiveTabChange={model.actions.setDrawerActiveTab}
					permissionLabels={model.labels.permission}
				/>

				<ConversationComposerView
					focused={model.isFocused}
					topConnected={model.slashVisible}
					dropZone={{
						...model.dropZone,
						style: {
							opacity: model.hasSession ? 1 : 0.55,
							...(model.slashVisible ? { borderTopColor: "transparent" } : null),
						},
					}}
					classNames={{
						card: [surface?.rootClassName, classNames?.card].filter(Boolean).join(" "),
						content: classNames?.cardContent,
					}}
					regions={{
						decoration: <ThemedInputBarBackground />,
						command: (
							<PerfSendProfiler id="ib:CommandPanel">
								<CommandPanel
									open={model.slashOpen}
									onClose={model.actions.handleSlashClose}
									onSelect={model.actions.handleSlashSelect}
									onSelectConnector={model.actions.handleConnectorSelect}
									filter={model.slashFilter}
									cwd={model.effectiveCwd || undefined}
									className={model.isFocused ? "border-primary/20" : undefined}
								/>
							</PerfSendProfiler>
						),
						attachments: (
							/*
						 * 顶部附件区只剩「不是一个词」的东西：重编辑提示、Appshot 复合卡片、
						 * 插件上下文、场景胶囊。文件 / 图片 / skill 都已进入文本流。
						 */
						<div
							aria-hidden={!model.hasCapsules}
							className="grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none"
							style={{
								gridTemplateRows: model.hasCapsules ? "1fr" : "0fr",
								opacity: model.hasCapsules ? 1 : 0,
							}}
						>
							<div className="min-h-0 overflow-hidden rounded-t-[inherit]">
								{renderCapsules && (
									<div className={["space-y-1.5 px-3 pt-3", classNames?.capsules].filter(Boolean).join(" ")}>
										{model.pendingMessageEdit && (
											<div className="flex items-center justify-between gap-2 rounded-md border border-primary/25 bg-primary/5 px-2.5 py-1.5 text-[11px] text-primary">
												<span className="min-w-0 flex-1 leading-snug">{model.pendingEditHint}</span>
												<button
													type="button"
													onClick={model.actions.cancelPendingEdit}
													className="shrink-0 rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
												>
													{model.cancelPendingEditLabel}
												</button>
											</div>
										)}


										{model.appshotAttachment && (
											<AppshotCard data={model.appshotAttachment} onRemove={model.actions.removeAppshot} />
										)}

										{/* 图片缩略图行：文本流里对应「图 N」胶囊，编号在角标上复现 */}
										{model.imageAttachments.length > 0 && (
											<div className="flex flex-wrap items-center gap-1.5">
												{model.imageAttachments.map((image, index) => (
													<div key={image.path} className="group relative">
														<button
															type="button"
															onClick={() => model.actions.openImagePreview(index)}
															className="block h-12 w-12 overflow-hidden rounded-lg border border-border ring-1 ring-border/40"
															title={image.name}
														>
															<img
																src={image.url}
																alt={image.name}
																className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
															/>
														</button>
														<span className="pointer-events-none absolute bottom-0.5 right-0.5 rounded bg-foreground/45 px-1 text-[9px] font-medium leading-[1.4] text-background/90">
															{image.label}
														</span>
														<button
															type="button"
															onClick={() => model.actions.removeImage(image.path)}
															className="absolute -right-1.5 -top-1.5 flex items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 hover:text-destructive"
															title={model.labels.capsule.removeImage}
															style={{ height: 18, width: 18 }}
														>
															<span className="icon-[solar--close-circle-linear] h-3 w-3" />
														</button>
													</div>
												))}
											</div>
										)}

										{/* 插件附件不画在卡片里：它是「你现在正看着什么」，画在卡片外面顶部（PromptAttachmentLabels）。 */}
									</div>
								)}
							</div>
						</div>
						),
						editor: (
						<div className={["px-4 pb-1 pt-3", classNames?.editorWrap].filter(Boolean).join(" ")}>
							<div className="relative">
								<PerfSendProfiler id="ib:InputEditor">
								<InputEditor
									ariaLabel={model.placeholderTexts[0]}
									editable={model.hasSession}
									onContextMenu={model.actions.handleContextMenu}
									onEnter={model.actions.handleEnter}
									onFocusChange={model.actions.setFocused}
									onTriggerChange={model.actions.handleTriggerChange}
								/>
								</PerfSendProfiler>
								<ThemedInputBarPlaceholder
									texts={model.placeholderTexts}
									visible={model.showPlaceholder}
									rotating={model.placeholderRotating}
								/>
							</div>
						</div>
						),
						toolbar: (
						<PerfSendProfiler id="ib:Toolbar">
						<InputBarToolbar
							activeActions={model.activeActions}
							canSend={model.canSend}
							className={classNames?.toolbar}
							hasSession={model.hasSession}
							isEmpty={model.isEmpty}
							isStreaming={model.isStreaming}
							labels={model.labels}
							onAbort={model.actions.handleAbort}
							onPlusClick={model.actions.handlePlusClick}
							onSelectFiles={() => void model.actions.handleSelectFiles()}
							onSelectImages={() => void model.actions.handleSelectImages()}
							onSend={model.actions.handleSend}
							sendPending={model.sendPending}
							slashOpen={model.slashOpen}
							speechInput={model.speechInput}
						/>
						</PerfSendProfiler>
						),
					}}
				/>

				{/*
				 * 卡片下沿的附属区：出现时整条输入栏被平滑抬高，消失时落回去，动画由
				 * InputBarFooter 用 CSS 过渡承担。待办只是第一个住户，后续元素加进 items 即可。
				 */}
				<InputBarFooter
					items={[
						{
							id: "todo",
							node: model.todo ? <InputBarTodoStatus todo={model.todo} /> : null,
						},
						{
							id: "speech-input",
							node: model.speechInput.statusText ? (
								<InputBarSpeechStatus text={model.speechInput.statusText} />
							) : null,
						},
					]}
				/>
			</div>

			{model.contextMenu
				? createPortal(<InputBarContextMenuView {...model.contextMenu} />, document.body)
				: null}
		</div>
	);
}
