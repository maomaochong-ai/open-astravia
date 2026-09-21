import { forwardRef, type ComponentPropsWithoutRef, type JSX, type ReactNode } from "react";
import { cn } from "@vetta-org/ui";

export interface SettingsMenuTriggerViewProps extends ComponentPropsWithoutRef<"button"> {
	readonly avatar?: ReactNode;
	/** Claw 在线状态徽章（圆点 + "Claw"），仅在线时展示。取代原工作模式 badge 位。 */
	readonly clawOnline?: boolean;
	readonly clawTitle?: string;
	readonly open: boolean;
	readonly settingsFallbackLabel: string;
	readonly userLabel?: string | null;
}

/** 底部头像 item 内的 Claw 在线状态徽章，非交互（点击由外层头像 item 处理）。 */
function ClawBadge({ title }: { title?: string }): JSX.Element {
	return (
		<span
			className="relative flex h-5 max-w-full shrink-0 items-center gap-1 rounded-full bg-secondary px-1.5 text-[10px] font-medium leading-none text-secondary-foreground"
			title={title}
		>
			{/* 在线是常驻状态：用静态圆点，不要 animate-ping（无限动画会让空闲窗口持续重绘）。 */}
			<span className="inline-flex h-1 w-1 shrink-0 rounded-full bg-secondary-foreground" />
			<span className="truncate">Claw</span>
		</span>
	);
}


export const SettingsMenuTriggerView = forwardRef<HTMLButtonElement, SettingsMenuTriggerViewProps>(
	function SettingsMenuTriggerView(
		{ avatar, className, clawOnline, clawTitle, open, settingsFallbackLabel, userLabel, ...props },
		ref,
	): JSX.Element {
		return (
			<button
				ref={ref}
				type="button"
				className={cn(
					// min-w-0：昵称过长时在 flex 底栏中可收缩，右侧 MessageCenter 不被挤出
					"no-drag flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-[6px] text-[12px] font-medium transition-colors",
					open ? "bg-accent text-foreground" : "text-foreground hover:bg-accent/50",
					className,
				)}
				{...props}
			>
				{userLabel ? (
					<>
						{/* avatar 与 Claw 不收缩；昵称 truncate 吃掉多余宽度 */}
						<span className="shrink-0">{avatar}</span>
						<span className="min-w-0 flex-1 truncate text-left">{userLabel}</span>
						{clawOnline && <ClawBadge title={clawTitle} />}
					</>
				) : (
					<>
						<span className="icon-[solar--settings-linear] h-3.5 w-3.5 shrink-0" />
						<span className="min-w-0 flex-1 truncate text-left">{settingsFallbackLabel}</span>
						{clawOnline && <ClawBadge title={clawTitle} />}
					</>
				)}
			</button>
		);
	},
);
