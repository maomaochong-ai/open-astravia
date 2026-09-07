import { Button } from "@vetta/ui";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

const easeOut = [0.22, 1, 0.36, 1] as const;

export interface AgentCenterHeroProps {
	readonly assembling: boolean;
	readonly assembledCount: number;
	readonly assemblySubmittable: boolean;
	readonly teamSelected: boolean;
	readonly onCreateTeam: () => void;
	readonly onRecruit: () => void;
	readonly onSubmitAssembly: () => void;
	readonly onCancelAssembly: () => void;
	readonly onClearSelection: () => void;
	readonly onOpenTeamSettings: () => void;
	readonly onDeleteTeam: () => void;
}

/** 页面标题区，排版与工作区详情页 header 对齐：同样的字号、间距与入场动画。 */
export function AgentCenterHero(props: AgentCenterHeroProps): JSX.Element {
	const { t } = useTranslation("agent-teams");
	return (
		<motion.header
			className="shrink-0 px-4 pb-4 pt-1 @md:px-8 @md:pb-5"
			initial={{ opacity: 0, y: -10 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.45, ease: easeOut }}
		>
			<div className="flex min-w-0 flex-col gap-3">
				<div className="flex min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-2">
					<div className="min-w-0 flex-1 basis-[8rem]">
						<h1 className="mb-1 min-w-0 truncate text-[20px] font-bold leading-tight tracking-tight text-foreground @md:text-[26px]">
							{t("center.title")}
						</h1>
						<p className="min-w-0 truncate text-[11.5px] text-muted-foreground/70">{t("center.subtitle")}</p>
					</div>

					<div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
						{props.assembling ? (
							<>
								<span className="mr-1 text-[11.5px] text-muted-foreground/70">
									{t("center.assembled", { count: props.assembledCount })}
								</span>
								<Button type="button" variant="ghost" size="sm" onClick={props.onCancelAssembly}>
									<span className="text-[12px] font-medium">{t("center.exitAssembly")}</span>
								</Button>
								<Button
									type="button"
									variant="primary"
									size="sm"
									disabled={!props.assemblySubmittable}
									onClick={props.onSubmitAssembly}
								>
									<span className="icon-[solar--check-read-linear] h-4 w-4" aria-hidden="true" />
									<span className="text-[12px] font-medium">{t("center.saveTeam")}</span>
								</Button>
							</>
						) : props.teamSelected ? (
							<>
								<Button type="button" variant="ghost" size="sm" onClick={props.onClearSelection}>
									<span className="text-[12px] font-medium">{t("center.cancel")}</span>
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									onClick={props.onDeleteTeam}
									title={t("center.deleteTeam")}
									aria-label={t("center.deleteTeam")}
									className="text-muted-foreground hover:text-destructive"
								>
									<span className="icon-[solar--trash-bin-trash-linear] h-3.5 w-3.5" aria-hidden="true" />
								</Button>
								<Button
									type="button"
									variant="outline"
									size="icon-sm"
									onClick={props.onOpenTeamSettings}
									title={t("center.teamSettings")}
									aria-label={t("center.teamSettings")}
								>
									<span className="icon-[solar--settings-linear] h-3.5 w-3.5" aria-hidden="true" />
								</Button>
								<Button type="button" variant="primary" size="sm" onClick={props.onRecruit}>
									<span className="icon-[solar--user-plus-linear] h-4 w-4" aria-hidden="true" />
									<span className="text-[12px] font-medium">{t("center.recruit")}</span>
								</Button>
							</>
						) : (
							<Button type="button" variant="primary" size="sm" onClick={props.onCreateTeam}>
								<span className="icon-[solar--add-circle-linear] h-4 w-4" aria-hidden="true" />
								<span className="text-[12px] font-medium">{t("center.createTeam")}</span>
							</Button>
						)}
					</div>
				</div>
			</div>
		</motion.header>
	);
}
