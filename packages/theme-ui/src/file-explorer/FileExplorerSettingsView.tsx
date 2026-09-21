import {
	Button,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Switch,
} from "@vetta-org/ui";
import { useId, type JSX } from "react";

export interface FileExplorerSettingsViewProps {
	showHidden: boolean;
	exclude: string;
	iconTheme: string;
	themes: readonly { id: string; label: string }[];
	error: string | null;
	labels: {
		title: string;
		showHidden: string;
		exclude: string;
		excludeHint: string;
		iconTheme: string;
		save: string;
		reset: string;
	};
	onShowHiddenChange(value: boolean): void;
	onExcludeChange(value: string): void;
	onSaveExclude(): void;
	onIconThemeChange(value: string): void;
	onReset(): void;
}

export function FileExplorerSettingsView(props: FileExplorerSettingsViewProps): JSX.Element {
	const id = useId();
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="icon-xs" title={props.labels.title} aria-label={props.labels.title}>
					<span className="icon-[solar--settings-linear] h-3.5 w-3.5" aria-hidden />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				aria-label={props.labels.title}
				className="w-72 max-w-[calc(100vw-2rem)] space-y-3 p-3"
			>
				<p className="text-[13px] font-medium">{props.labels.title}</p>
				<div className="flex items-center justify-between gap-3">
					<label htmlFor={`${id}-hidden`} className="text-[12px]">
						{props.labels.showHidden}
					</label>
					<Switch id={`${id}-hidden`} checked={props.showHidden} onCheckedChange={props.onShowHiddenChange} />
				</div>
				<div className="space-y-1.5">
					<label htmlFor={`${id}-theme`} className="text-[12px]">
						{props.labels.iconTheme}
					</label>
					<Select value={props.iconTheme} onValueChange={props.onIconThemeChange}>
						<SelectTrigger id={`${id}-theme`}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{props.themes.map((theme) => (
								<SelectItem key={theme.id} value={theme.id}>
									{theme.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="space-y-1.5">
					<label htmlFor={`${id}-exclude`} className="text-[12px]">
						{props.labels.exclude}
					</label>
					<textarea
						id={`${id}-exclude`}
						rows={4}
						value={props.exclude}
						onChange={(event) => props.onExcludeChange(event.target.value)}
						aria-describedby={`${id}-hint`}
						className="w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-[12px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
					/>
					<p id={`${id}-hint`} className="text-[11px] text-muted-foreground">
						{props.labels.excludeHint}
					</p>
					<Button variant="outline" size="sm" onClick={props.onSaveExclude}>
						{props.labels.save}
					</Button>
				</div>
				{props.error ? (
					<p role="alert" className="text-[12px] text-destructive">
						{props.error}
					</p>
				) : null}
				<Button variant="ghost" size="sm" onClick={props.onReset}>
					{props.labels.reset}
				</Button>
			</PopoverContent>
		</Popover>
	);
}
