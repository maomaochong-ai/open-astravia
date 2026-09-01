import { ConversationComposerToolbarView } from "@vetta/theme-ui/chat";
import { memo } from "react";
import { ContextRing } from "../ContextRing";
import { ExecutionModeSelector } from "../ExecutionModeSelector";
import { ModelSelector } from "../ModelSelector";
import { SendButton } from "../SendButton";
import { ActiveActionCapsules, type ActiveActionCapsule } from "./ActiveActionCapsules";
import { InputBarToolbarButton } from "./InputBarToolbarButton";
import type { InputBarLabels, SpeechInputModel } from "./types";

/** hover / press 缩放走 CSS，与 InputBarToolbarButton 保持一致。 */
const QUEUE_BUTTON_INTERACTION =
	"transition-transform duration-150 ease-out will-change-transform hover:scale-[1.06] active:scale-[0.92]";

interface InputBarToolbarProps {
	/** 已激活的 input action，紧跟执行模式右侧显示。 */
	activeActions: readonly ActiveActionCapsule[];
	canSend: boolean;
	className?: string;
	hasSession: boolean;
	isEmpty: boolean;
	isStreaming: boolean;
	labels: Pick<InputBarLabels, "capsule" | "toolbar">;
	onAbort: () => void | Promise<void>;
	onPlusClick: () => void;
	onSelectFiles: () => void;
	onSelectImages: () => void;
	onSend: () => void;
	/** 发送前的准备态（如新会话页正在创建待建项目）。 */
	sendPending?: { readonly label: string };
	slashOpen: boolean;
	speechInput: SpeechInputModel;
}

export const InputBarToolbar = memo(function InputBarToolbar({
	activeActions,
	canSend,
	className,
	hasSession,
	isEmpty,
	isStreaming,
	labels,
	onAbort,
	onPlusClick,
	onSelectFiles,
	onSelectImages,
	onSend,
	sendPending,
	slashOpen,
	speechInput,
}: InputBarToolbarProps): JSX.Element {
	return (
		<ConversationComposerToolbarView
			className={className}
			left={
				<>
				{/*
				 * 标记给命令区的 click-outside 判定用：不跳过的话，mousedown 先把命令区
				 * 收起、紧接着的 click 又把它打开，这个按钮就永远关不掉面板。
				 */}
				<span data-command-panel-toggle="true" className="flex shrink-0">
					<InputBarToolbarButton
						icon="icon-[solar--code-scan-bold-duotone]"
						title={labels.toolbar.skills}
						disabled={!hasSession}
						onClick={onPlusClick}
						active={slashOpen}
					/>
				</span>
				<div className="ml-1 h-4 w-px shrink-0 bg-border/70" />
				{/*
				 * 展开形态下这个位置让给「插图 / 附件」——命令区已经占满上方，
				 * 此时执行模式与模型收起，工具栏只服务于「往输入框里添东西」+ 发送。
				 *
				 * 两套控件都常驻挂载、只切 display：换形态时卸载 / 挂载
				 * ExecutionModeSelector 与 ModelSelector 是一次同步 render（各自的 model
				 * hook + i18n + IPC），正好落在展开动画的第一帧上，低配设备直接顿一下。
				 */}
				{/* keep-open：命令区的 click-outside 走 mousedown，不标记的话这两个按钮
				    会在 click 之前随面板一起卸载，文件选择器永远弹不出来。 */}
				<span
					data-command-panel-keep-open="true"
					className={slashOpen ? "flex shrink-0 items-center gap-0.5" : "hidden"}
				>
					<InputBarToolbarButton
						icon="icon-[solar--gallery-linear]"
						title={labels.toolbar.addImage}
						disabled={!hasSession}
						onClick={onSelectImages}
					/>
					<InputBarToolbarButton
						icon="icon-[solar--paperclip-linear]"
						title={labels.toolbar.attachFile}
						disabled={!hasSession}
						onClick={onSelectFiles}
					/>
				</span>
				<div className={slashOpen ? "hidden" : "min-w-0 shrink"}>
					<ExecutionModeSelector />
				</div>
				<ActiveActionCapsules
					items={activeActions}
					removeHint={labels.capsule.removeDefault}
					groupLabel={labels.capsule.activeGroup}
				/>
				</>
			}
			right={
				<>
				{/* 展开形态只留发送：模型与上下文圆环让位给命令区（同上，只切 display 不卸载） */}
				<div className={slashOpen ? "hidden" : "min-w-0 shrink"}>
					<ModelSelector />
				</div>
				{/* 包一层控制显隐：ContextRingView 自带 `flex`，直接叠 `hidden` 压不住它。 */}
				<div className={slashOpen ? "hidden" : "contents"}>
					<ContextRing className="mr-1 shrink-0" />
				</div>
				{speechInput.visible && !slashOpen && (
					<InputBarToolbarButton
						icon={speechInput.active ? "icon-[solar--stop-circle-linear]" : "icon-[solar--microphone-3-linear]"}
						title={speechInput.title}
						disabled={speechInput.disabled}
						onClick={speechInput.onToggle}
						active={speechInput.active}
					/>
				)}
				{isStreaming && !isEmpty && !sendPending ? (
					<button
						type="button"
						onClick={onSend}
						title={labels.toolbar.queue}
						className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground ${QUEUE_BUTTON_INTERACTION}`}
					>
						<span className="icon-[solar--add-square-linear] h-[18px] w-[18px]" />
					</button>
				) : (
					<div className="shrink-0">
						<SendButton
							canSend={canSend}
							isStreaming={isStreaming}
							pending={sendPending}
							onSend={onSend}
							onAbort={onAbort}
						/>
					</div>
				)}
				</>
			}
		/>
	);
});
