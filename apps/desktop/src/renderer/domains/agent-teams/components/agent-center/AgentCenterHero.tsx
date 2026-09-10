import type { AgentProfile } from "@vetta/agent-team";
import { Button } from "@vetta/ui";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { AgentConstellation } from "./AgentConstellation";

const easeOut = [0.22, 1, 0.36, 1] as const;

export interface AgentCenterHeroProps {
	readonly assembling: boolean;
	readonly assembledCount: number;
	readonly assemblySubmittable: boolean;
	/** 只作装饰：取前几位头像挂到 banner 的弧线上。 */
	readonly agents: readonly AgentProfile[];
	readonly teamCount: number;
	readonly onCreateTeam: () => void;
	readonly onSubmitAssembly: () => void;
	readonly onCancelAssembly: () => void;
}

/** 页面顶部 banner：标题、规模概览、组队操作与头像装饰共处一张卡片，随内容一起滚动。 */
export function AgentCenterHero(props: AgentCenterHeroProps): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const reduceMotion = useReducedMotion();

	return (
		<motion.header
			// 页面级的「点空白处退出组队」靠这个标记放行标题区里的保存/退出按钮，别删。
			data-assembly-region="hero"
			className="shrink-0 pb-4 pt-1 @md:pb-5"
			initial={{ opacity: 0, y: -10 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.45, ease: easeOut }}
		>
			<div className="group relative isolate overflow-hidden rounded-2xl border border-border/50 bg-card/40 px-5 py-4 @md:px-7 @md:py-5">
				<HeroBackdrop reduceMotion={Boolean(reduceMotion)} />

				<div className="relative flex min-w-0 flex-wrap items-end justify-between gap-x-6 gap-y-4">
					<div className="min-w-0 flex-1 basis-[12rem]">
						<h1 className="mb-1 min-w-0 truncate text-[20px] font-bold leading-tight tracking-tight text-foreground @md:text-[26px]">
							{t("center.title")}
						</h1>
						<p className="min-w-0 truncate text-[11.5px] text-muted-foreground/70">{t("center.subtitle")}</p>
						<div className="mt-3 flex flex-wrap items-center gap-1.5">
							<HeroStat icon="icon-[solar--users-group-rounded-linear]" label={t("center.expertCount", { count: props.agents.length })} />
							<HeroStat icon="icon-[solar--widget-5-linear]" label={t("center.bannerTeams", { count: props.teamCount })} />
						</div>
					</div>

					<div className="flex shrink-0 flex-col items-end gap-3">
						<div className="hidden @2xl:block">
							<AgentConstellation agents={props.agents} />
						</div>

						<div className="flex flex-wrap items-center justify-end gap-1">
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
				</div>
			</div>
		</motion.header>
	);
}

function HeroStat({ icon, label }: { readonly icon: string; readonly label: string }): JSX.Element {
	return (
		<span className="inline-flex items-center gap-1.5 rounded-full bg-foreground/[0.04] px-2.5 py-1 text-[11.5px] text-muted-foreground ring-1 ring-inset ring-border/40">
			<span className={`${icon} h-3.5 w-3.5 text-primary/70`} aria-hidden="true" />
			{label}
		</span>
	);
}

/** banner 底纹：极光光斑 + 细点阵 + 偶尔扫过的高光，全部不接收指针事件。 */
function HeroBackdrop({ reduceMotion }: { readonly reduceMotion: boolean }): JSX.Element {
	return (
		<div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
			<div className="absolute inset-0 bg-gradient-to-br from-primary/[0.07] via-transparent to-foreground/[0.03]" />

			<div
				className="absolute inset-0 opacity-[0.05] text-foreground"
				style={{
					backgroundImage: "radial-gradient(currentColor 1px, transparent 1px)",
					backgroundSize: "16px 16px",
					maskImage: "linear-gradient(to right, black, transparent 70%)",
					WebkitMaskImage: "linear-gradient(to right, black, transparent 70%)",
				}}
			/>

			<motion.div
				className="absolute -left-16 -top-24 h-56 w-56 rounded-full bg-primary/25 opacity-[0.55] blur-3xl transition-opacity duration-500 group-hover:opacity-80"
				animate={reduceMotion ? undefined : { x: [0, 26, 0], y: [0, 14, 0], scale: [1, 1.12, 1] }}
				transition={{ duration: 18, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
			/>
			<motion.div
				className="absolute -bottom-28 right-4 h-52 w-52 rounded-full bg-primary/15 opacity-50 blur-3xl transition-opacity duration-500 group-hover:opacity-90"
				animate={reduceMotion ? undefined : { x: [0, -30, 0], y: [0, -12, 0], scale: [1.1, 1, 1.1] }}
				transition={{ duration: 24, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
			/>

			{!reduceMotion && (
				<motion.div
					className="absolute inset-y-0 w-1/4 skew-x-12 bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent"
					initial={{ left: "-30%" }}
					animate={{ left: ["-30%", "130%"] }}
					transition={{ duration: 2.6, repeat: Number.POSITIVE_INFINITY, repeatDelay: 7, ease: "easeInOut" }}
				/>
			)}
		</div>
	);
}
