import { ContextRingView } from "@vetta/theme-ui/chat";
import { CollapsePanel } from "@vetta/theme-ui/shared";
import { Button } from "@shared/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@shared/components/ui/popover";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useContextRingModel } from "../hooks/useContextRingModel";
import {
	type ContextRingDetailGroupKind,
	toggleExpandedContextGroup,
} from "../services/context-ring-details";

export function ContextRing({ className }: { className?: string } = {}): JSX.Element | null {
	const { t } = useTranslation("chat");
	const [expandedGroup, setExpandedGroup] = useState<ContextRingDetailGroupKind | null>(null);
	const [open, setOpen] = useState(false);
	const model = useContextRingModel(open);
	useEffect(() => {
		if (!model && open) setOpen(false);
	}, [model, open]);
	if (!model) return null;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className={`h-7 w-7 shrink-0 rounded-full p-0${className ? ` ${className}` : ""}`}
					aria-label={model.tooltip}
				>
					<ContextRingView
						percent={model.percent}
						offset={model.offset}
						color={model.color}
						isCompacting={model.isCompacting}
						tooltip={model.tooltip}
						className="pointer-events-none"
					/>
				</Button>
			</PopoverTrigger>
			{open ? (
				<PopoverContent side="top" align="end" className="w-80 p-0">
					{model.details ? (
					<>
					<div className="border-b border-border/50 px-3.5 py-3">
						<PopoverTitle className="text-[13px]">{t("contextRing.details.title")}</PopoverTitle>
						<div className="mt-1 truncate text-[11px] text-muted-foreground">{model.details.model}</div>
						<div className="mt-2 flex items-center gap-3 text-[11px]">
							{model.details.actualTokens ? (
								<span>
									{t("contextRing.details.actual")}: {model.details.actualTokens}
								</span>
							) : null}
							<span className="text-muted-foreground">
								{t("contextRing.details.estimated")}: {model.details.estimatedTokens}
							</span>
						</div>
						<div className="mt-1 text-[10px] text-muted-foreground/70">{model.details.coverage}</div>
					</div>
					<div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 border-b border-border/40 px-3.5 py-1.5 text-[10px] text-muted-foreground">
						<span>{t("contextRing.details.category")}</span>
						<span>{t("contextRing.details.tokens")}</span>
						<span>{t("contextRing.details.share")}</span>
					</div>
					<div className="max-h-72 overflow-y-auto">
						{model.details.groups.map((group) => (
							<div key={group.id} className="border-b border-border/30 last:border-b-0">
								<button
									type="button"
									aria-expanded={expandedGroup === group.id}
									aria-controls={`context-ring-group-${group.id}`}
									onClick={() => setExpandedGroup((current) => toggleExpandedContextGroup(current, group.id))}
									className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 px-3.5 py-2 text-left transition-colors hover:bg-muted/40"
								>
									<div className="flex min-w-0 items-center gap-1.5">
										<span
											className={`icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${expandedGroup === group.id ? "rotate-90" : ""}`}
										/>
										<div className="min-w-0">
											<div className="truncate text-[11px] text-foreground">{group.title}</div>
											<div className="truncate text-[10px] text-muted-foreground">
												{t("contextRing.details.items", { count: group.itemCount })}
												{group.unknownCount > 0
													? ` · ${t("contextRing.details.unknownItems", { count: group.unknownCount })}`
													: null}
											</div>
										</div>
									</div>
									<span className="text-[11px] tabular-nums">{group.tokens}</span>
									<span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
										{group.share}
									</span>
								</button>
								<CollapsePanel open={expandedGroup === group.id} id={`context-ring-group-${group.id}`}>
									<div className="border-border/40 border-t bg-muted/20 py-0.5">
										{group.sections.map((section) => {
											const sectionMeta = [
												section.metadata,
												section.itemCount > 1
													? t("contextRing.details.items", { count: section.itemCount })
													: "",
												section.unknownCount > 0
													? t("contextRing.details.unknownItems", { count: section.unknownCount })
													: "",
											]
												.filter(Boolean)
												.join(" · ");
											return (
												<div
													key={section.id}
													className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 px-3.5 py-1.5 pl-7"
												>
													<div className="min-w-0">
														<div className="truncate text-[11px] text-foreground" title={section.title}>
															{section.title}
														</div>
														{sectionMeta ? (
															<div className="truncate text-[10px] text-muted-foreground" title={sectionMeta}>
																{sectionMeta}
															</div>
														) : null}
													</div>
													<span className="text-[11px] tabular-nums">{section.tokens}</span>
													<span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
														{section.share}
													</span>
												</div>
											);
										})}
									</div>
								</CollapsePanel>
							</div>
						))}
					</div>
					</>
				) : (
					<div className="px-3.5 py-3">
						<PopoverTitle className="text-[13px]">{t("contextRing.details.title")}</PopoverTitle>
						<div className="mt-2 text-[11px] text-foreground">{model.tooltip}</div>
						<p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
							{t("contextRing.details.unavailableAfterRestart")}
						</p>
					</div>
					)}
				</PopoverContent>
			) : null}
		</Popover>
	);
}
