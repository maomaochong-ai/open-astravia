import { Button, Input, Switch } from "@vetta-org/ui";
import type { JSX, KeyboardEvent } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { ProviderIcon } from "../shared/provider-icon";
import type { ModelSelectorLabels, ModelSelectorProviderGroup } from "./ModelSelectorView";
import { ReasoningStepSlider } from "./ReasoningStepSlider";

/** A searchable picker body for an existing surface. It never creates a second overlay. */
export function InlineModelPicker({
	title,
	avatar,
	description,
	status,
	backLabel,
	onBack,
	groups,
	selectedModel,
	defaultKey,
	labels,
	disabled,
	onModelSelect,
	inheritance,
	reasoning,
}: {
	readonly title: string;
	readonly avatar?: { readonly src: string; readonly alt: string };
	readonly description: string;
	readonly status?: string;
	readonly backLabel: string;
	readonly onBack: () => void;
	readonly groups: readonly ModelSelectorProviderGroup[];
	readonly selectedModel?: string;
	readonly defaultKey?: string;
	readonly labels: ModelSelectorLabels;
	readonly disabled: boolean;
	readonly onModelSelect: (key: string) => void;
	readonly inheritance?: {
		readonly label: string;
		readonly selected: boolean;
		readonly disabled?: boolean;
		readonly onChange: (checked: boolean) => void;
	};
	readonly reasoning?: {
		readonly value: string;
		readonly levels: readonly string[];
		readonly onChange: (value: string) => Promise<void> | void;
	};
}): JSX.Element {
	const [query, setQuery] = useState("");
	const inheritanceLabelId = useId();
	const input = useRef<HTMLInputElement>(null);
	const list = useRef<HTMLDivElement>(null);
	useEffect(() => {
		input.current?.focus();
	}, []);
	const normalized = query.trim().toLocaleLowerCase();
	const filtered = groups.flatMap((group) => {
		const models = group.models.filter((model) =>
			[model.displayName, model.modelId, model.provider, group.label, ...(model.tags ?? [])].some((text) =>
				text.toLocaleLowerCase().includes(normalized),
			),
		);
		return models.length ? [{ ...group, models }] : [];
	});
	function navigate(event: KeyboardEvent<HTMLElement>) {
		const buttons = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
		const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
		let next: number;
		if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
		else if (event.key === "ArrowUp") next = index <= 0 ? buttons.length - 1 : index - 1;
		else if (event.key === "Home" && index >= 0) next = 0;
		else if (event.key === "End" && index >= 0) next = buttons.length - 1;
		else return;
		if (!buttons.length) return;
		event.preventDefault();
		buttons[next]?.focus();
	}
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
			<div className="flex items-center gap-2">
				<Button variant="ghost" size="icon-sm" aria-label={backLabel} onClick={onBack} className="shrink-0">
					<span aria-hidden="true" className="icon-[solar--alt-arrow-left-linear] size-4" />
				</Button>
				{avatar ? (
					<img src={avatar.src} alt={avatar.alt} className="size-6 shrink-0 rounded-full object-cover" />
				) : null}
				<h2 className="min-w-0 truncate text-[13px] font-medium">{title}</h2>
				{status ? (
					<span role="status" className="ml-auto shrink-0 text-[11px] text-muted-foreground">
						{status}
					</span>
				) : null}
			</div>
			<p className="text-[11px] text-muted-foreground">{description}</p>
			{inheritance ? (
				<div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
					<p id={inheritanceLabelId} className="min-w-0 text-[12px] font-medium">
						{inheritance.label}
					</p>
					<Switch
						checked={inheritance.selected}
						disabled={disabled || inheritance.disabled}
						className="disabled:opacity-100"
						aria-labelledby={inheritanceLabelId}
						onCheckedChange={inheritance.onChange}
					/>
				</div>
			) : null}
			{reasoning ? (
				<ReasoningStepSlider
					label={labels.reasoningHeader}
					value={reasoning.value}
					levels={reasoning.levels}
					levelLabel={labels.levelLabel}
					disabled={disabled}
					onChange={reasoning.onChange}
				/>
			) : null}
			<div className="relative">
				<Input
					ref={input}
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={navigate}
					aria-label={labels.searchPlaceholder}
					placeholder={labels.searchPlaceholder}
					className="pr-8 text-[12px]"
				/>
				{query ? (
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label={labels.clearSearch}
						className="absolute right-1 top-1"
						onClick={() => {
							setQuery("");
							input.current?.focus();
						}}
					>
						<span aria-hidden="true" className="icon-[solar--close-circle-linear] size-3.5" />
					</Button>
				) : null}
			</div>
			<div
				ref={list}
				onKeyDown={navigate}
				role="group"
				aria-label={labels.modelHeader}
				className="min-h-0 flex-1 overflow-y-auto"
			>
				{filtered.map((group) => (
					<div key={group.provider}>
						<div className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-muted-foreground">
							<ProviderIcon symbol={group.icon} className="size-3" />
							{group.label}
							{group.models[0]?.remote ? <span>{labels.cloudOnly}</span> : null}
						</div>
						{group.models.map((model) => (
							<Button
								key={model.key}
								variant={model.key === selectedModel && !inheritance?.selected ? "secondary" : "ghost"}
								aria-pressed={model.key === selectedModel && !inheritance?.selected}
								disabled={disabled}
								className="h-auto w-full justify-start gap-2 px-2 py-2 text-[12px] disabled:opacity-100"
								onClick={() => onModelSelect(model.key)}
							>
								<span className="min-w-0 flex-1 text-left">
									<span className="block truncate">{model.displayName}</span>
									{model.tags?.length ? (
										<span className="block truncate text-[10px] text-muted-foreground">{model.tags.join(" · ")}</span>
									) : null}
								</span>
								{labels.multiplierLabel?.(model) ? (
									<span className="shrink-0 text-[11px] text-muted-foreground">{labels.multiplierLabel(model)}</span>
								) : null}
								{model.supportsImage ? (
									<span className="shrink-0 text-[10px] text-muted-foreground">{labels.visionBadge}</span>
								) : null}
								{model.key === defaultKey ? (
									<span className="shrink-0 text-[10px] text-muted-foreground">{labels.defaultBadge}</span>
								) : null}
								{model.key === selectedModel && !inheritance?.selected ? (
									<span aria-hidden="true" className="icon-[solar--check-circle-linear] size-3.5 shrink-0" />
								) : null}
							</Button>
						))}
					</div>
				))}
				{!filtered.length ? (
					<div role="status" className="px-2 py-8 text-center text-[12px] text-muted-foreground">
						<p>{labels.noResults}</p>
						<p className="mt-1 text-[11px]">{labels.noResultsHint}</p>
					</div>
				) : null}
			</div>
		</div>
	);
}
