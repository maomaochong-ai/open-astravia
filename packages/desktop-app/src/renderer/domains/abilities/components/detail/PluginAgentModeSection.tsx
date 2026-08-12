import type { AgentMode } from "@shared/store/atoms";
import { useTranslation } from "react-i18next";
import type { PluginAbility } from "../../types";

const KNOWN_AGENT_MODES: readonly AgentMode[] = ["work", "coding"];

function isKnownAgentMode(mode: string): mode is AgentMode {
	return (KNOWN_AGENT_MODES as readonly string[]).includes(mode);
}

/**
 * 插件声明的模式偏好（agent_mode 轴）。
 *
 * 这里刻意不写「在哪些模式可用」：插件已不再被工作模式过滤，面板入口、命令、hook 在所有
 * 模式下都常驻，agent_mode 只剩「agent 在这些模式下优先考虑它」这层软含义。
 * 未安装的市场条目拿不到 manifest 的 agent_mode，故只对已装插件展示。
 */
export function PluginAgentModeSection({ item }: { item: PluginAbility }): JSX.Element | null {
	const { t } = useTranslation("abilities");

	if (!item.plugin) return null;

	const modes = item.agentModes;
	const universal = modes.length === 0;

	return (
		<div>
			<div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
				{t("plugin.agentMode.title")}
			</div>
			<div className="flex flex-wrap gap-1.5">
				{universal ? (
					<span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
						{t("plugin.agentMode.none")}
					</span>
				) : (
					modes.map((mode) => (
						<span
							key={mode}
							className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground"
						>
							{isKnownAgentMode(mode) ? t(`plugin.agentMode.${mode}`) : mode}
						</span>
					))
				)}
			</div>
			<div className="mt-1.5 text-[11px] text-muted-foreground">
				{universal ? t("plugin.agentMode.hintNone") : t("plugin.agentMode.hint")}
			</div>
		</div>
	);
}
