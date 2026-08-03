import { AGENT_MODE_ICONS } from "@shared/components/AgentModeSwitcher";
import { type AgentMode, agentModeAtom } from "@shared/store/atoms";
import { cn } from "@vetta/ui";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import type { PluginAbility } from "../../types";

const KNOWN_AGENT_MODES: readonly AgentMode[] = ["work", "coding"];

function isKnownAgentMode(mode: string): mode is AgentMode {
	return (KNOWN_AGENT_MODES as readonly string[]).includes(mode);
}

/**
 * 插件的适用工作场景（agent_mode 轴，ADR-0046）。
 * 能力市场不再按当前工作模式过滤条目，改由这里说明它在哪些模式下才有入口，
 * 免得用户在另一模式下看不到插件、以为能力丢了。
 * 未安装的市场条目拿不到 manifest 的 agent_mode，故只对已装插件展示。
 */
export function PluginAgentModeSection({ item }: { item: PluginAbility }): JSX.Element | null {
	const { t } = useTranslation("abilities");
	const currentMode = useAtomValue(agentModeAtom);

	if (!item.plugin) return null;

	const modes = item.agentModes;
	const universal = modes.length === 0;
	const activeHere = universal || modes.includes(currentMode);

	return (
		<div>
			<div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
				{t("plugin.agentMode.title")}
			</div>
			<div className="flex flex-wrap gap-1.5">
				{universal ? (
					<span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
						{t("plugin.agentMode.all")}
					</span>
				) : (
					modes.map((mode) => (
						<span
							key={mode}
							className={cn(
								"inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
								mode === currentMode ? "bg-primary/10 text-primary/90" : "bg-muted text-muted-foreground",
							)}
						>
							{isKnownAgentMode(mode) ? (
								<span className={cn(AGENT_MODE_ICONS[mode], "h-3 w-3 shrink-0")} />
							) : null}
							{isKnownAgentMode(mode) ? t(`plugin.agentMode.${mode}`) : mode}
						</span>
					))
				)}
			</div>
			<div className={cn("mt-1.5 text-[11px]", activeHere ? "text-muted-foreground" : "text-amber-500")}>
				{universal ? t("plugin.agentMode.hintAll") : t("plugin.agentMode.hint")}
			</div>
		</div>
	);
}
