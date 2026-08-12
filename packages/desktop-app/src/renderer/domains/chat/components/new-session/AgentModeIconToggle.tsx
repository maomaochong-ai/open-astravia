import { useDefaultAgentMode } from "@shared/hooks/useDefaultAgentMode";
import { cn } from "@shared/lib/utils";
import type { AgentMode } from "@shared/store/atoms";
import { useTranslation } from "react-i18next";

export const AGENT_MODES: readonly AgentMode[] = ["work", "coding"];

export const AGENT_MODE_ICONS: Record<AgentMode, string> = {
	work: "icon-[solar--case-minimalistic-linear]",
	coding: "icon-[solar--code-linear]",
};

/**
 * 新会话欢迎区的胶囊形工作/编程切换，也是工作模式在整个 App 里唯一的调整入口。
 * 写的是「新会话默认模式」：会话创建时把它固化进 SessionConfig，之后会话内不可变，
 * 所以侧边栏与设置菜单都不再提供切换入口。
 * 当前选中段在 icon 右侧展示 Label（Work/Coding）；未选中仅 icon。
 */
export function AgentModeIconToggle({ className }: { className?: string }): JSX.Element {
	const { t } = useTranslation("settings");
	const { defaultAgentMode, setDefaultAgentMode } = useDefaultAgentMode();

	return (
		<div
			role="group"
			aria-label={t("agentMode.title")}
			className={cn(
				"relative inline-flex h-7 shrink-0 items-center rounded-full border border-primary/40 p-0.5",
				className,
			)}
		>
			{AGENT_MODES.map((mode) => {
				const active = mode === defaultAgentMode;
				const label = t(`agentMode.${mode}`);
				return (
					<button
						key={mode}
						type="button"
						onClick={() => void setDefaultAgentMode(mode)}
						aria-label={label}
						aria-pressed={active}
						title={label}
						className={cn(
							"relative z-10 flex h-6 items-center justify-center rounded-full transition-[color,background-color,padding] duration-200 ease-out",
							active
								? "gap-1 bg-primary px-2 text-primary-foreground"
								: "w-7 text-muted-foreground hover:text-foreground",
						)}
					>
						<span className={cn(AGENT_MODE_ICONS[mode], "h-3.5 w-3.5 shrink-0")} aria-hidden />
						{active && <span className="text-[11px] font-medium leading-none">{label}</span>}
					</button>
				);
			})}
		</div>
	);
}
