import { useThemeSurface } from "@vetta/theme-sdk/appearance";
import { memo } from "react";
import { motion } from "motion/react";
import { ContextRing } from "../ContextRing";
import { ExecutionModeSelector } from "../ExecutionModeSelector";
import { ModelSelector } from "../ModelSelector";
import { SendButton } from "../SendButton";
import { ActiveActionCapsules, type ActiveActionCapsule } from "./ActiveActionCapsules";
import { InputBarToolbarButton } from "./InputBarToolbarButton";
import type { InputBarLabels, SpeechInputModel } from "./types";

const SPRING = { type: "spring" as const, stiffness: 460, damping: 32, mass: 0.9 };
const TOOLBAR_BUTTON_HOVER = { scale: 1.06 };
const TOOLBAR_BUTTON_TAP = { scale: 0.92 };

interface InputBarToolbarProps {
	/** 已激活的 input action，紧跟执行模式右侧显示。 */
	activeActions: readonly ActiveActionCapsule[];
	canSend: boolean;
	className?: string;
	hasSession: boolean;
	isEmpty: boolean;
	isStreaming: boolean;
	labels: Pick<InputBarLabels, "capsule" | "toolbar">;
	onAbort: () => void;
	onPlusClick: () => void;
	onSelectFiles: () => void;
	onSelectImages: () => void;
	onSend: () => void;
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
	slashOpen,
	speechInput,
}: InputBarToolbarProps): JSX.Element {
	const toolbarLeftSurface = useThemeSurface("chat.inputBarToolbarLeft");
	const toolbarRightSurface = useThemeSurface("chat.inputBarToolbarRight");

	return (
		<div
			className={[
				// 始终单行：窄宽靠折叠文案（执行模式名 / 推理档 / 快捷键提示）腾空间，不换行
				"flex flex-nowrap items-center justify-between gap-x-1.5 px-2 pb-2 pt-1 sm:px-2.5",
				className,
			]
				.filter(Boolean)
				.join(" ")}
		>
			<div
				className={[
					"flex min-w-0 shrink items-center gap-0.5",
					toolbarLeftSurface?.rootClassName,
				]
					.filter(Boolean)
					.join(" ")}
				data-theme-surface-root="chat.inputBarToolbarLeft"
			>
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
			</div>

			<div
				className={[
					"ml-auto flex min-w-0 shrink items-center gap-1",
					toolbarRightSurface?.rootClassName,
				]
					.filter(Boolean)
					.join(" ")}
				data-theme-surface-root="chat.inputBarToolbarRight"
			>
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
				{isStreaming && !isEmpty ? (
					<motion.button
						type="button"
						onClick={onSend}
						whileHover={TOOLBAR_BUTTON_HOVER}
						whileTap={TOOLBAR_BUTTON_TAP}
						transition={SPRING}
						title={labels.toolbar.queue}
						className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
					>
						<span className="icon-[solar--add-square-linear] h-[18px] w-[18px]" />
					</motion.button>
				) : (
					<div className="shrink-0">
						<SendButton canSend={canSend} isStreaming={isStreaming} onSend={onSend} onAbort={onAbort} />
					</div>
				)}
			</div>
		</div>
	);
});
