import type { AgentProfile } from "@vetta/agent-team";
import { Button } from "@vetta/ui";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { AgentConstellation } from "./AgentConstellation";

const easeOut = [0.22, 1, 0.36, 1] as const;

export interface AgentCenterHeroProps {
	readonly assembling: boolean;
	readonly assembledCount: number;
	readonly assemblySubmittable: boolean;
	/** 只作装饰：取前几位头像挂到标题下方的弧线上。 */
	readonly agents: readonly AgentProfile[];
	readonly onCreateTeam: () => void;
	readonly onSubmitAssembly: () => void;
	readonly onCancelAssembly: () => void;
}

/** 页面顶部：标题、说明、头像装饰与组队操作直接落在页面底色上，随内容一起滚动。 */
export function AgentCenterHero(props: AgentCenterHeroProps): JSX.Element {
	const { t } = useTranslation("agent-teams");

	return (
		<motion.header
			// 页面级的「点空白处退出组队」靠这个标记放行标题区里的保存/退出按钮，别删。
			data-assembly-region="hero"
			className="shrink-0 pb-5 pt-4 @md:pb-6"
			initial={{ opacity: 0, y: -10 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.45, ease: easeOut }}
		>
			<div className="flex min-w-0 flex-wrap items-start justify-between gap-x-6 gap-y-4">
				<div className="min-w-0 flex-1 basis-[12rem]">
					<h1 className="mb-1 min-w-0 truncate text-[20px] font-bold leading-tight tracking-tight text-foreground @md:text-[26px]">
						{t("center.title")}
					</h1>
					<p className="min-w-0 truncate text-[11.5px] text-muted-foreground/70">{t("center.subtitle")}</p>
					<div className="mt-3.5">
						<AgentConstellation agents={props.agents} />
					</div>
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
					) : (
						<Button type="button" variant="primary" size="sm" onClick={props.onCreateTeam}>
							<span className="icon-[solar--add-circle-linear] h-4 w-4" aria-hidden="true" />
							<span className="text-[12px] font-medium">{t("center.createTeam")}</span>
						</Button>
					)}
				</div>
			</div>
		</motion.header>
	);
}
