import { ContextRingView } from "@vetta/theme-ui/chat";
import { Button } from "@shared/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@shared/components/ui/popover";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useContextRingModel } from "../hooks/useContextRingModel";
import {
	buildContextRingBarSegments,
	type ContextRingDetailGroup,
	type ContextRingDetailGroupKind,
	type ContextRingDetailsModel,
} from "../services/context-ring-details";

/** 分段配色由主题的等亮度色板提供，见 styles.css 的 --context-segment-*。 */
const GROUP_COLORS: Record<ContextRingDetailGroupKind, string> = {
	instructions: "var(--context-segment-1)",
	capabilities: "var(--context-segment-2)",
	tools: "var(--context-segment-3)",
	conversation: "var(--context-segment-4)",
	runtime: "var(--context-segment-5)",
};

export function ContextRing({ className }: { className?: string } = {}): JSX.Element | null {
	const { t } = useTranslation("chat");
	const [activeGroup, setActiveGroup] = useState<ContextRingDetailGroupKind | null>(null);
	const [open, setOpen] = useState(false);
	const model = useContextRingModel(open);
	useEffect(() => {
		if (!model && open) setOpen(false);
	}, [model, open]);
	useEffect(() => {
		if (!open) setActiveGroup(null);
	}, [open]);
	if (!model) return null;
	const details = model.details;
	const selected = details?.groups.find((group) => group.id === activeGroup) ?? null;
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
					/>
				</Button>
			</PopoverTrigger>
			{open ? (
				<PopoverContent side="top" align="end" className="w-64 p-0">
					{details ? (
						selected ? (
							<GroupDetailPane group={selected} onBack={() => setActiveGroup(null)} />
						) : (
							<OverviewPane details={details} onSelect={setActiveGroup} />
						)
					) : (
						<div className="px-3 py-2.5">
							<PopoverTitle className="text-[12px]">{t("contextRing.details.title")}</PopoverTitle>
							<div className="mt-1.5 text-[11px] text-foreground">{model.tooltip}</div>
							<p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
								{t("contextRing.details.unavailableAfterRestart")}
							</p>
						</div>
					)}
				</PopoverContent>
			) : null}
		</Popover>
	);
}

function OverviewPane({
	details,
	onSelect,
}: {
	details: ContextRingDetailsModel;
	onSelect: (group: ContextRingDetailGroupKind) => void;
}): JSX.Element {
	const { t } = useTranslation("chat");
	const segments = useMemo(
		() => buildContextRingBarSegments(details.groups, details.windowTokens),
		[details.groups, details.windowTokens],
	);
	return (
		<div className="px-3 py-2.5">
			<div className="flex items-baseline justify-between gap-2">
				<PopoverTitle className="truncate text-[12px]">{t("contextRing.details.title")}</PopoverTitle>
				<span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
					{details.tokens} / {details.windowLabel}
				</span>
			</div>
			<div className="truncate text-[10px] text-muted-foreground" title={details.model}>
				{details.model}
			</div>
			<div className="mt-2 flex h-2 gap-px overflow-hidden rounded-full bg-muted/50">
				{segments.map((segment) => {
					const group = details.groups.find((item) => item.id === segment.id);
					return (
						<button
							key={segment.id}
							type="button"
							title={group ? `${group.title} · ${group.tokens} · ${group.share}` : undefined}
							aria-label={group?.title}
							onClick={() => onSelect(segment.id)}
							style={{ width: `${segment.percent}%`, backgroundColor: GROUP_COLORS[segment.id] }}
							className="h-full transition-opacity hover:opacity-80"
						/>
					);
				})}
			</div>
			<div className="mt-1.5 max-h-56 overflow-y-auto">
				{details.groups.map((group) => (
					<button
						key={group.id}
						type="button"
						onClick={() => onSelect(group.id)}
						className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-x-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-muted/50"
					>
						<span
							className="h-2 w-2 shrink-0 rounded-full"
							style={{ backgroundColor: GROUP_COLORS[group.id] }}
							aria-hidden="true"
						/>
						<span className="truncate text-[11px] text-foreground">{group.title}</span>
						<span className="text-[11px] tabular-nums">{group.tokens}</span>
						<span className="w-9 text-right text-[10px] tabular-nums text-muted-foreground">{group.share}</span>
						<span className="icon-[solar--alt-arrow-right-linear] h-3 w-3 text-muted-foreground" aria-hidden="true" />
					</button>
				))}
			</div>
		</div>
	);
}

function GroupDetailPane({
	group,
	onBack,
}: {
	group: ContextRingDetailGroup;
	onBack: () => void;
}): JSX.Element {
	const { t } = useTranslation("chat");
	return (
		<div className="px-3 py-2.5">
			<div className="flex items-center gap-1.5">
				<button
					type="button"
					onClick={onBack}
					aria-label={t("contextRing.details.back")}
					className="-ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
				>
					<span className="icon-[solar--alt-arrow-left-linear] h-3.5 w-3.5" aria-hidden="true" />
				</button>
				<span
					className="h-2 w-2 shrink-0 rounded-full"
					style={{ backgroundColor: GROUP_COLORS[group.id] }}
					aria-hidden="true"
				/>
				<PopoverTitle className="truncate text-[12px]">{group.title}</PopoverTitle>
				<span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
					{group.tokens} · {group.share}
				</span>
			</div>
			<div className="mt-0.5 pl-6 text-[10px] text-muted-foreground">
				{t("contextRing.details.items", { count: group.itemCount })}
				{group.unknownCount > 0 ? ` · ${t("contextRing.details.unknownItems", { count: group.unknownCount })}` : null}
			</div>
			<div className="mt-1.5 max-h-56 overflow-y-auto">
				{group.sections.map((section) => {
					const meta = [
						section.metadata,
						section.itemCount > 1 ? t("contextRing.details.items", { count: section.itemCount }) : "",
						section.unknownCount > 0 ? t("contextRing.details.unknownItems", { count: section.unknownCount }) : "",
					]
						.filter(Boolean)
						.join(" · ");
					return (
						<div
							key={section.id}
							className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 px-1 py-1"
						>
							<div className="min-w-0">
								<div className="truncate text-[11px] text-foreground" title={section.title}>
									{section.title}
								</div>
								{meta ? (
									<div className="truncate text-[10px] text-muted-foreground" title={meta}>
										{meta}
									</div>
								) : null}
							</div>
							<span className="text-[11px] tabular-nums">{section.tokens}</span>
							<span className="w-9 text-right text-[10px] tabular-nums text-muted-foreground">{section.share}</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}
