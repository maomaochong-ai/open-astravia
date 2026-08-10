import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useThemeComponent } from "@vetta/theme-sdk";
import { useThemeSurface } from "@vetta/theme-sdk/appearance";
import { ThemeSurface } from "@vetta/theme-ui/appearance";
import { InputBarContextMenuView, InputBarPlaceholder, SessionDropZoneView } from "@vetta/theme-ui/chat";
import { CommandPanel } from "../command-panel/CommandPanel";
import { AtPanel } from "../AtPanel";
import { ActionButtonBar } from "../ActionButtonBar";
import { QuestionPanel } from "../QuestionPanel";
import { AppshotCard } from "../AppshotCard";
import { useSessionDropZoneModel } from "../../hooks/useSessionDropZoneModel";
import { InputBarBackground } from "./InputBarBackground";
import { InputBarCapsule } from "./InputBarCapsule";
import { InputBarDrawer } from "./InputBarDrawer";
import { InputBarTodoStatus } from "./InputBarTodoStatus";
import { PromptAttachmentLabels } from "./PromptAttachmentLabels";
import { InputBarToolbar } from "./InputBarToolbar";
import { InputEditor } from "./editor/InputEditor";
import type { InputBarViewProps } from "./types";

const SOFT = { duration: 0.18, ease: [0.22, 0.61, 0.36, 1] as const };
const COLLAPSE_INITIAL = { height: 0, opacity: 0 };
const COLLAPSE_ANIMATE = { height: "auto", opacity: 1 };
const COLLAPSE_EXIT = { height: 0, opacity: 0 };

export function InputBarView({ model, className, classNames }: InputBarViewProps): JSX.Element {
	const surface = useThemeSurface("chat.inputBar");
	const ThemedInputBarBackground = useThemeComponent(
		"chat.inputBarBackground",
		InputBarBackground,
	);
	const ThemedInputBarPlaceholder = useThemeComponent(
		"chat.inputBarPlaceholder",
		InputBarPlaceholder,
	);
	// Drop target = the visual input card only (not outer padding / max-width gutters).
	const dropZone = useSessionDropZoneModel(model.effectiveCwd || undefined);

	const cardClass = [
		// 浅色下输入栏与页面同为白底，靠一层大扩散低透明的外投影把它从背景里托起
		//（近距离叠色会在白底上发灰）；深色底色本身有层级差，不投影。
		"input-card relative z-10 overflow-visible border bg-input-bar-bg shadow-[0_8px_28px_-14px_rgb(0_0_0/0.10)] transition-[border-color,box-shadow,transform] duration-200 dark:shadow-none",
		// 展开态：命令区钉在卡片上沿，这里去掉上圆角，上边框改为透明（见下方 inline style，
		// 用 border-t-0 会少 1px 让整条 bar 抖一下），两块面才是连续的一整块。
		// 跟 slashVisible 而非 slashOpen：收起时要等命令区退场动画跑完才恢复圆角。
		model.slashVisible ? "rounded-b-[20px] rounded-t-none" : "rounded-[20px]",
		model.isFocused ? "border-primary/20" : "border-border",
		surface?.rootClassName,
		classNames?.card,
	]
		.filter(Boolean)
		.join(" ");

	return (
		<div className={["relative px-2 pb-3 pt-1 sm:px-4 sm:pb-4", className, classNames?.root].filter(Boolean).join(" ")}>
			<AnimatePresence>
				{model.pendingQuestion && (
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
				)}
			</AnimatePresence>

			<div
				className={[
					// @container：工具栏/动作条按输入区宽度折叠文案（非视口），避免窄栏换行
					"relative mx-auto w-full max-w-2xl @container transition-opacity duration-150",
					model.pendingQuestion ? "pointer-events-none opacity-0" : "",
					classNames?.stack,
				]
					.filter(Boolean)
					.join(" ")}
				aria-hidden={model.pendingQuestion ? true : undefined}
			>
				<AtPanel
					open={model.atOpen}
					onClose={model.actions.handleAtClose}
					onSelect={model.actions.handleAtSelect}
					filter={model.atFilter}
					cwd={model.effectiveCwd}
				/>

				<ActionButtonBar />

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

				<SessionDropZoneView
					{...dropZone}
					style={{
						opacity: model.hasSession ? 1 : 0.55,
						...(model.slashVisible ? { borderTopColor: "transparent" } : null),
					}}
					className={cardClass}
				>
					<ThemeSurface slot="chat.inputBar" />
					<ThemedInputBarBackground />
					<div className={["relative z-10 rounded-[inherit]", classNames?.cardContent].filter(Boolean).join(" ")}>
						{/* 展开形态：命令区与编辑区同处这张卡片，两者之间没有接缝 */}
						<CommandPanel
							open={model.slashOpen}
							onClose={model.actions.handleSlashClose}
							onSelect={model.actions.handleSlashSelect}
							onSelectConnector={model.actions.handleConnectorSelect}
							filter={model.slashFilter}
							cwd={model.effectiveCwd || undefined}
							className={model.isFocused ? "border-primary/20" : undefined}
						/>

						{/*
						 * 顶部附件区只剩「不是一个词」的东西：重编辑提示、Appshot 复合卡片、
						 * 插件上下文、场景胶囊。文件 / 图片 / skill 都已进入文本流。
						 */}
						<AnimatePresence initial={false}>
							{model.hasCapsules && (
								<motion.div
									key="capsules"
									initial={COLLAPSE_INITIAL}
									animate={COLLAPSE_ANIMATE}
									exit={COLLAPSE_EXIT}
									transition={SOFT}
									className="overflow-hidden rounded-t-[inherit]"
								>
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
										{model.selectedSkill && (
											<div className="flex flex-wrap items-center gap-1.5">
												<InputBarCapsule
													key="scene-capsule"
													icon="icon-[solar--clapperboard-open-linear]"
													label={model.selectedSkill.alias || model.selectedSkill.name}
													labels={model.labels.capsule}
													tone="primary"
													onRemove={model.actions.removeSkill}
												/>
											</div>
										)}
									</div>
								</motion.div>
							)}
						</AnimatePresence>

						<div className={["px-4 pb-1 pt-3", classNames?.editorWrap].filter(Boolean).join(" ")}>
							<div className="relative">
								<InputEditor
									ariaLabel={model.placeholderTexts[0]}
									editable={model.hasSession}
									onContextMenu={model.actions.handleContextMenu}
									onEnter={model.actions.handleEnter}
									onFocusChange={model.actions.setFocused}
									onTriggerChange={model.actions.handleTriggerChange}
								/>
								<ThemedInputBarPlaceholder
									texts={model.placeholderTexts}
									visible={model.showPlaceholder}
									rotating={model.placeholderRotating}
								/>
							</div>
						</div>

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
							slashOpen={model.slashOpen}
						/>
					</div>
				</SessionDropZoneView>

				{/* 待办在输入卡片之外、贴着下沿；点击展开 popover 而不是抽屉。 */}
				{model.todo && <InputBarTodoStatus todo={model.todo} />}
			</div>

			{model.contextMenu
				? createPortal(<InputBarContextMenuView {...model.contextMenu} />, document.body)
				: null}
		</div>
	);
}
