import { useDefaultAgentMode } from "@shared/hooks/useDefaultAgentMode";
import { cn } from "@shared/lib/utils";
import { FACTORY_DEFAULT_AGENT_MODE } from "@shared/store/atoms";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgentModeOption } from "../../../../../preload/api-types/session";

/**
 * 拉取注册表前渲染空容器（IPC 往返毫秒级，肉眼不可见）。刻意不做硬编码回退：
 * 回退清单会随注册表演进悄悄过期，成为"新增模式 = 一份 md"承诺之外的第二事实源。
 */
const EMPTY_MODES: readonly AgentModeOption[] = [];

/**
 * 输入框上方选项行里的工作模式切换，也是工作模式在整个 App 里唯一的调整入口。
 * 写的是「新会话默认模式」：会话创建时把它固化进 SessionConfig，之后会话内不可变，
 * 所以侧边栏与设置菜单都不再提供切换入口。
 *
 * 选项遍历 coding-agent 的模式注册表渲染（ADR-0071）：新增模式只需新增一份
 * modes/*.md（可选补 i18n 文案），本组件零改动。文案优先取 i18n（agentMode.<id>），
 * 缺译时回落注册表自带的 label。
 */
export function AgentModeIconToggle({ className }: { className?: string }): JSX.Element {
	const { t, i18n } = useTranslation("settings");
	const { defaultAgentMode, setDefaultAgentMode } = useDefaultAgentMode();
	const [modes, setModes] = useState<readonly AgentModeOption[]>(EMPTY_MODES);
	// 显示顺序：出厂默认模式排最前（它是绝大多数用户的选中态），其余保持注册表顺序。
	const orderedModes = useMemo(
		() => [
			...modes.filter((mode) => mode.id === FACTORY_DEFAULT_AGENT_MODE),
			...modes.filter((mode) => mode.id !== FACTORY_DEFAULT_AGENT_MODE),
		],
		[modes],
	);

	useEffect(() => {
		let disposed = false;
		void window.vetta.session
			.getAgentModes()
			.then((fetched) => {
				if (!disposed && fetched.length > 0) setModes(fetched);
			})
			.catch(() => undefined);
		return () => {
			disposed = true;
		};
	}, []);

	return (
		<div
			role="group"
			aria-label={t("agentMode.title")}
			className={cn(
				// 经典 segmented control：半透明凹槽轨道 + 浮起的选中段。与同一行的项目选择器
				// 共用同一层 accent 底色，两枚控件读作一组静默 chip，亮度层级让位给下方输入框。
				"relative inline-flex h-7 shrink-0 items-center rounded-lg bg-accent/50 p-0.5",
				className,
			)}
		>
			{orderedModes.map((mode) => {
				const active = mode.id === defaultAgentMode;
				// key 由注册表驱动、无法静态枚举，绕过 typed-i18n 的字面量约束；缺译回落注册表 label。
				const key = `agentMode.${mode.id}`;
				const label = i18n.exists(`settings:${key}`) ? String(t(key as never)) : mode.label;
				return (
					<button
						key={mode.id}
						type="button"
						onClick={() => void setDefaultAgentMode(mode.id)}
						aria-label={label}
						aria-pressed={active}
						title={label}
						className={cn(
							"relative z-10 flex h-6 items-center justify-center rounded-md text-[12px] font-medium transition-[color,background-color,padding] duration-200 ease-out",
							active
								? "gap-1.5 bg-background px-2 text-foreground shadow-sm"
								: "w-7 text-muted-foreground/70 hover:text-foreground",
						)}
					>
						<span className={cn(mode.icon, "h-3.5 w-3.5 shrink-0")} aria-hidden />
						{active && <span className="leading-none">{label}</span>}
					</button>
				);
			})}
		</div>
	);
}
