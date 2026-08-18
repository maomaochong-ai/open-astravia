import { KnowledgeBreadcrumbView } from "@vetta/theme-ui/knowledge";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@vetta/ui";

import { cn } from "@shared/lib/utils";
import { SettingsAiAssist } from "../../settings/ai-assist";
import type { useKnowledgeBaseListModel } from "../hooks/useKnowledgeBaseListModel";
import {
	countKnowledgeDirsFromStatuses,
	countKnowledgeFilesFromStatuses,
	formatKnowledgeUpdatedAt,
	knowledgeBaseDisplayName,
} from "../lib/knowledge-base";

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

interface KnowledgeBaseListPageViewProps {
	model: ReturnType<typeof useKnowledgeBaseListModel>;
}

export function KnowledgeBaseListPageView({ model }: KnowledgeBaseListPageViewProps): JSX.Element {
	const { t } = useTranslation("settings");
	const fileStatuses = model.fileStatuses;

	return (
		<div className="flex h-full w-full flex-1 flex-col overflow-hidden">
			<header
				className={cn(
					"flex shrink-0 gap-4 px-8 pb-5 pt-7",
					model.narrow ? "flex-col items-stretch" : "items-end justify-between",
				)}
			>
				<motion.div
					initial={{ opacity: 0, y: -8 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.45, ease: EASE_OUT }}
				>
					<div className="flex items-center gap-2">
						<Button
							variant="ghost"
							size="icon-sm"
							title={t("kbAllBack")}
							onClick={model.goBack}
						>
							<span className="icon-[mdi--arrow-left] h-4 w-4" />
						</Button>
						<h1 className="text-[24px] font-bold tracking-tight text-foreground">{t("kbAllTitle")}</h1>
						<motion.span
							key={model.knowledgeBases.length}
							initial={{ opacity: 0, scale: 0.85 }}
							animate={{ opacity: 1, scale: 1 }}
							transition={{ duration: 0.25, ease: EASE_OUT }}
							className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
						>
							{model.knowledgeBases.length}
						</motion.span>
					</div>
					<p className="ml-9 mt-1 text-[12px] text-muted-foreground/60">{t("kbAllSubtitle")}</p>
				</motion.div>
				<motion.div
					initial={{ opacity: 0, y: -6 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.4, delay: 0.06, ease: EASE_OUT }}
					className="flex items-center gap-2"
				>
					<div className={cn("relative", model.narrow ? "min-w-0 flex-1" : "w-64")}>
						<span className="icon-[mdi--magnify] absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
						<input
							value={model.search}
							onChange={(event) => model.setSearch(event.target.value)}
							placeholder={t("kbAllSearch")}
							className="h-8 w-full min-w-0 rounded-lg border border-transparent bg-secondary pl-8 pr-3 text-[12px] shadow-none outline-none placeholder:text-muted-foreground/45 hover:bg-accent focus-visible:border-primary/25 focus-visible:bg-background/70"
						/>
					</div>
					<SettingsAiAssist tabId="knowledgeBase" />
					<Button variant="primary" onClick={model.createKnowledgeBase}>
						<span className="icon-[mdi--plus] h-4 w-4" />
						{t("kbCreateBase")}
					</Button>
				</motion.div>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
				<AnimatePresence mode="popLayout">
					{model.filteredBases.length > 0 ? (
						<motion.div
							key="knowledge-grid"
							layout
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: 6 }}
							transition={{ duration: 0.35, ease: EASE_OUT }}
							className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3"
						>
							<AnimatePresence mode="popLayout">
								{model.filteredBases.map((base, index) => {
									// 懒加载树不全：文件/目录数从加工态路径推导（+ 根层空目录）
									const stats = {
										files: countKnowledgeFilesFromStatuses(base.id, fileStatuses),
										directories: countKnowledgeDirsFromStatuses(base.id, fileStatuses, base.nodes),
									};
									const active = base.id === model.activeId;
									return (
										<motion.div
											key={base.id}
											layout
											initial={{ opacity: 0, y: 10, scale: 0.985 }}
											animate={{ opacity: 1, y: 0, scale: 1 }}
											exit={{ opacity: 0, y: 4, scale: 0.985 }}
											transition={{
												duration: 0.28,
												delay: Math.min(index * 0.035, 0.18),
												ease: EASE_OUT,
												layout: { duration: 0.24, ease: EASE_OUT },
											}}
											whileHover={{ y: -2 }}
											whileTap={{ scale: 0.99 }}
											className="flex"
										>
											<Button
												variant="ghost"
												onClick={() => model.openKnowledgeBase(base)}
												className={cn(
													"group h-auto min-h-36 w-full items-stretch justify-start whitespace-normal rounded-xl border p-4 text-left transition-[background-color,border-color,box-shadow]",
													active
														? "border-primary/25 bg-primary/6 hover:bg-primary/10 hover:shadow-sm"
														: "border-border bg-muted/25 hover:bg-muted/55 hover:shadow-sm",
												)}
											>
												<div className="flex w-full flex-col">
													<div className="flex items-start justify-between gap-3">
														<div
															className={cn(
																"flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
																active
																	? "bg-primary/12 text-primary"
																	: "bg-accent text-muted-foreground group-hover:text-foreground",
															)}
														>
															<span className="icon-[mdi--book-open-variant-outline] h-4 w-4" />
														</div>
														{active && (
															<motion.span
																initial={{ opacity: 0, scale: 0.85 }}
																animate={{ opacity: 1, scale: 1 }}
																className="rounded-full bg-primary/10 px-2 py-0.5 text-[9.5px] font-medium text-primary"
															>
																{t("kbCurrent")}
															</motion.span>
														)}
													</div>
													<h2 className="mt-3 truncate text-[13px] font-semibold text-foreground">
														{knowledgeBaseDisplayName(base)}
													</h2>
													<div className="mt-auto flex items-center gap-2 pt-3 text-[10px] text-muted-foreground/50">
														<span>{t("kbDirCount", { n: stats.directories })}</span>
														<span>·</span>
														<span>{t("kbFileCount", { n: stats.files })}</span>
														<span className="ml-auto">{formatKnowledgeUpdatedAt(base.updatedAt)}</span>
													</div>
												</div>
											</Button>
										</motion.div>
									);
								})}
							</AnimatePresence>
						</motion.div>
					) : (
						<motion.div
							key="knowledge-empty"
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: 6 }}
							transition={{ duration: 0.35, ease: EASE_OUT }}
							className="flex h-full min-h-72 flex-col items-center justify-center text-center"
						>
							<motion.span
								className="icon-[mdi--bookshelf] h-10 w-10 text-muted-foreground/30"
								initial={{ scale: 0.9 }}
								animate={{ scale: 1 }}
								transition={{ duration: 0.4, ease: EASE_OUT }}
							/>
							<p className="mt-3 text-[13px] font-medium text-foreground">
								{model.knowledgeBases.length === 0 ? t("kbAllEmptyNone") : t("kbAllEmptyNoMatch")}
							</p>
							<p className="mt-1 text-[11px] text-muted-foreground/55">
								{model.knowledgeBases.length === 0
									? t("kbAllEmptyNoneDesc")
									: t("kbAllEmptyNoMatchDesc")}
							</p>
							{model.knowledgeBases.length === 0 && (
								<Button variant="primary" className="mt-4" onClick={model.createKnowledgeBase}>
									<span className="icon-[mdi--plus] h-4 w-4" />
									{t("kbCreateBase")}
								</Button>
							)}
						</motion.div>
					)}
				</AnimatePresence>
			</div>
		</div>
	);
}

export type ThemeUiLink_KnowledgeBreadcrumbView = typeof KnowledgeBreadcrumbView;
