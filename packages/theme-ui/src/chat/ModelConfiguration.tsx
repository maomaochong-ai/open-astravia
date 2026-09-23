import { Button, Popover, PopoverContent, PopoverTrigger } from "@vetta-org/ui";
import type { JSX, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";

export function ModelConfigurationPopover({
	triggerLabel,
	title,
	open,
	onOpenChange,
	onBack,
	children,
}: {
	readonly triggerLabel: string;
	readonly title: string;
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
	readonly onBack?: () => void;
	readonly children: ReactNode;
}): JSX.Element {
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					className="h-7 min-w-0 max-w-52 gap-1 rounded-full px-2 text-[11px]"
					title={triggerLabel}
				>
					<span className="truncate">{triggerLabel}</span>
					<span aria-hidden="true" className="icon-[solar--alt-arrow-down-linear] size-3 shrink-0" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				side="top"
				aria-label={title}
				onEscapeKeyDown={(event) => {
					if (onBack) {
						event.preventDefault();
						onBack();
					}
				}}
				className={
					onBack
						? "flex h-[min(36rem,75vh)] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden p-3"
						: "block w-[min(24rem,calc(100vw-2rem))] max-h-[min(36rem,75vh)] overflow-y-auto p-3"
				}
			>
				{children}
			</PopoverContent>
		</Popover>
	);
}

export interface ModelConfigurationMember {
	readonly id: string;
	readonly name: string;
	readonly avatar: string;
	readonly selectionLabel: string;
	readonly selectionDetail?: string;
	readonly editLabel: string;
}
export interface ModelConfigurationGroup {
	readonly key: string;
	readonly label: string;
	readonly detail?: string;
	readonly usageLabel: string;
	readonly unavailable?: string;
	readonly members: readonly ModelConfigurationMember[];
}

/** Grouping comes from the host; the overview reveals individual controls on demand. */
export function ModelConfigurationOverview({
	groups,
	defaultKey,
	defaultInUse,
	defaultModelLabel,
	defaultDetail,
	defaultUnavailable,
	defaultLabel,
	defaultHint,
	title,
	customLabel,
	expandLabel,
	collapseLabel,
	disabled,
	returnFocus,
	onDefaultSelect,
	onMemberSelect,
}: {
	readonly groups: readonly ModelConfigurationGroup[];
	readonly defaultKey: string;
	readonly defaultInUse: boolean;
	readonly defaultModelLabel: string;
	readonly defaultDetail?: string;
	readonly defaultUnavailable?: string;
	readonly defaultLabel: string;
	readonly defaultHint: string;
	readonly title: string;
	readonly customLabel: string;
	readonly expandLabel: string;
	readonly collapseLabel: string;
	readonly disabled: boolean;
	readonly returnFocus?: string;
	readonly onDefaultSelect: () => void;
	readonly onMemberSelect: (id: string) => void;
}): JSX.Element {
	const [expanded, setExpanded] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	const contentId = useId();
	const defaultGroup = defaultInUse ? groups.find((group) => group.key === defaultKey) : undefined;
	const otherGroups = groups.filter((group) => !defaultInUse || group.key !== defaultKey);
	useEffect(() => {
		if (returnFocus)
			Array.from(root.current?.querySelectorAll<HTMLButtonElement>("[data-edit-target]") ?? [])
				.find((button) => button.dataset.editTarget === returnFocus)
				?.focus();
	}, [returnFocus, disabled]);

	function memberRows(group: ModelConfigurationGroup) {
		return (
			<div className="divide-y divide-border/50">
				{group.members.map((member) => (
					<div key={member.id} role="group" aria-label={member.name} className="flex min-w-0 items-center gap-2 py-2">
						<img src={member.avatar} alt={member.name} className="size-7 shrink-0 rounded-full object-cover" />
						<span className="w-16 shrink-0 truncate text-[12px]" title={member.name}>
							{member.name}
						</span>
						<Button
							variant="outline"
							disabled={disabled}
							className="h-auto min-h-9 min-w-0 flex-1 justify-between gap-2 px-2 py-1.5 text-left text-[12px]"
							aria-label={member.editLabel}
							aria-description={[member.selectionLabel, member.selectionDetail].filter(Boolean).join(" · ")}
							data-edit-target={`member:${member.id}`}
							onClick={() => onMemberSelect(member.id)}
						>
							<span className="min-w-0 whitespace-normal break-words">
								<span className="block">{member.selectionLabel}</span>
								{member.selectionDetail ? (
									<span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
										{member.selectionDetail}
									</span>
								) : null}
							</span>
							<span aria-hidden="true" className="icon-[solar--alt-arrow-right-linear] size-3.5 shrink-0" />
						</Button>
					</div>
				))}
			</div>
		);
	}

	function avatarSummary(group: ModelConfigurationGroup) {
		return (
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
				<div className="flex flex-wrap gap-1">
					{group.members.map((member) => (
						<Button
							key={member.id}
							variant="ghost"
							size="icon-sm"
							className="size-7 rounded-full p-0"
							disabled={disabled}
							title={[member.name, member.selectionLabel, member.selectionDetail].filter(Boolean).join(" · ")}
							aria-label={member.editLabel}
							aria-description={[member.selectionLabel, member.selectionDetail].filter(Boolean).join(" · ")}
							data-edit-target={`member:${member.id}`}
							onClick={() => onMemberSelect(member.id)}
						>
							<img
								src={member.avatar}
								alt={member.name}
								className="size-6 rounded-full object-cover ring-1 ring-border/50"
							/>
						</Button>
					))}
				</div>
				{group.usageLabel ? <span className="text-[11px] text-muted-foreground">{group.usageLabel}</span> : null}
			</div>
		);
	}

	return (
		<div ref={root} className="space-y-3">
			<div className="flex items-center justify-between gap-2">
				<h2 className="text-[13px] font-medium">{title}</h2>
				<Button
					variant="ghost"
					size="sm"
					className="h-7 gap-1 px-2 text-[11px]"
					aria-expanded={expanded}
					aria-controls={contentId}
					onClick={() => setExpanded((current) => !current)}
				>
					{expanded ? collapseLabel : expandLabel}
					<span
						aria-hidden="true"
						className={
							expanded ? "icon-[solar--alt-arrow-up-linear] size-3" : "icon-[solar--alt-arrow-down-linear] size-3"
						}
					/>
				</Button>
			</div>
			<div id={contentId} className="space-y-3">
				{defaultInUse ? (
					<section
						aria-label={defaultGroup?.label}
						className="overflow-hidden rounded-lg border border-border bg-muted/20"
					>
						<Button
							variant="ghost"
							className="h-auto w-full justify-between gap-3 rounded-none px-3 py-2.5 text-left text-foreground"
							disabled={disabled}
							aria-label={defaultLabel}
							aria-description={`${defaultModelLabel}. ${defaultHint}`}
							data-edit-target="default"
							onClick={onDefaultSelect}
						>
							<span className="min-w-0 space-y-1">
								<span className="block text-[11px] font-normal text-muted-foreground">{defaultLabel}</span>
								<span className="block whitespace-normal break-words text-[14px] font-medium">{defaultModelLabel}</span>
								{defaultDetail ? (
									<span className="block text-[11px] font-normal text-muted-foreground">{defaultDetail}</span>
								) : null}
							</span>
							<span
								aria-hidden="true"
								className="icon-[solar--alt-arrow-right-linear] size-4 shrink-0 text-muted-foreground"
							/>
						</Button>
						<div className="space-y-1.5 px-3 pb-2.5">
							{defaultGroup ? (expanded ? memberRows(defaultGroup) : avatarSummary(defaultGroup)) : null}
							<p className="text-[11px] text-muted-foreground">{defaultHint}</p>
							{defaultUnavailable ? (
								<p role="status" className="text-[11px] text-destructive">
									{defaultUnavailable}
								</p>
							) : null}
						</div>
					</section>
				) : null}
				{otherGroups.length > 0 ? (
					<div className="space-y-1">
						<h3 className="px-1 text-[11px] text-muted-foreground">{customLabel}</h3>
						<div className="divide-y divide-border/50">
							{otherGroups.map((group) => (
								<section key={group.key} aria-label={group.label} className="py-2 first:pt-0 last:pb-0">
									{expanded || group.members.length === 1 ? (
										memberRows(group)
									) : (
										<div className="space-y-1.5 px-1 py-1">
											<div className="min-w-0">
												<p className="break-words text-[13px] font-medium">{group.label}</p>
												{group.detail ? <p className="text-[11px] text-muted-foreground">{group.detail}</p> : null}
											</div>
											{avatarSummary(group)}
										</div>
									)}
									{group.unavailable ? (
										<p role="status" className="mt-1 text-[11px] text-destructive">
											{group.unavailable}
										</p>
									) : null}
								</section>
							))}
						</div>
					</div>
				) : null}
				{!defaultInUse ? (
					<Button
						variant="ghost"
						className="h-auto w-full justify-between gap-2 border-t border-border/50 px-1 py-2 text-left"
						disabled={disabled}
						aria-label={defaultLabel}
						aria-description={`${defaultModelLabel}. ${defaultHint}`}
						data-edit-target="default"
						onClick={onDefaultSelect}
					>
						<span className="min-w-0 whitespace-normal">
							<span className="block text-[12px]">{defaultLabel}</span>
							<span className="mt-0.5 block text-[11px] font-normal">{defaultHint}</span>
						</span>
						<span aria-hidden="true" className="icon-[solar--alt-arrow-right-linear] size-3.5 shrink-0" />
					</Button>
				) : null}
			</div>
		</div>
	);
}
