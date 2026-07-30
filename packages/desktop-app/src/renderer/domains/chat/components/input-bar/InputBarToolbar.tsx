import { useThemeSurface } from "@vetta/theme-sdk/appearance";
import { memo } from "react";
import { motion } from "motion/react";
import { ContextRing } from "../ContextRing";
import { ExecutionModeSelector } from "../ExecutionModeSelector";
import { ModelSelector } from "../ModelSelector";
import { SendButton } from "../SendButton";
import { ActiveActionCapsules, type ActiveActionCapsule } from "./ActiveActionCapsules";
import { InputBarToolbarButton } from "./InputBarToolbarButton";
import type { InputBarLabels } from "./types";

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
	onSend: () => void;
	slashOpen: boolean;
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
	onSend,
	slashOpen,
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
				<InputBarToolbarButton
					icon="icon-[solar--code-scan-bold-duotone]"
					title={labels.toolbar.skills}
					disabled={!hasSession}
					onClick={onPlusClick}
					active={slashOpen}
				/>
				<div className="ml-1 h-4 w-px shrink-0 bg-border/70" />
				<div className="min-w-0 shrink">
					<ExecutionModeSelector />
				</div>
				<ActiveActionCapsules items={activeActions} removeHint={labels.capsule.removeDefault} />
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
				<div className="min-w-0 shrink">
					<ModelSelector />
				</div>
				<ContextRing className="mr-1 shrink-0" />
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
