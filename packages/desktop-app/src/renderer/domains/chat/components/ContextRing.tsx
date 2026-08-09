import { ContextRingView } from "@vetta/theme-ui/chat";
import { Button } from "@shared/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@shared/components/ui/popover";
import { useTranslation } from "react-i18next";
import { useContextRingModel } from "../hooks/useContextRingModel";

export function ContextRing({ className }: { className?: string } = {}): JSX.Element | null {
	const { t } = useTranslation("chat");
	const model = useContextRingModel();
	if (!model) return null;
	return (
		<Popover>
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
			{model.details ? (
				<PopoverContent side="top" align="end" className="w-80 p-0">
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
						<span>{t("contextRing.details.section")}</span>
						<span>{t("contextRing.details.tokens")}</span>
						<span>{t("contextRing.details.share")}</span>
					</div>
					<div className="max-h-72 overflow-y-auto">
						{model.details.sections.map((section) => (
							<div
								key={section.id}
								className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 border-b border-border/30 px-3.5 py-2 last:border-b-0"
							>
								<div className="min-w-0">
									<div className="truncate text-[11px] text-foreground" title={section.title}>
										{section.title}
									</div>
									<div className="truncate text-[10px] text-muted-foreground" title={section.metadata}>
										{section.metadata}
									</div>
								</div>
								<span className="text-[11px] tabular-nums">{section.tokens}</span>
								<span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
									{section.share}
								</span>
							</div>
						))}
					</div>
				</PopoverContent>
			) : null}
		</Popover>
	);
}
