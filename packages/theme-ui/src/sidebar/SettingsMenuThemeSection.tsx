import type { JSX, MouseEvent } from "react";
import { cn } from "@astravia/ui";

export interface SettingsMenuThemeOption {
	value: string;
	label: string;
	icon: string;
}

export interface SettingsMenuThemeSectionProps {
	title: string;
	mode: string;
	options: readonly SettingsMenuThemeOption[];
	onSetMode: (value: string, event: MouseEvent<HTMLButtonElement>) => void;
}

export function SettingsMenuThemeSection({
	title,
	mode,
	options,
	onSetMode,
}: SettingsMenuThemeSectionProps): JSX.Element {
	return (
		<div className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-1.5">
			<div className="flex items-center gap-2 text-[12px] font-medium text-foreground">
				<span className="icon-[solar--palette-round-linear] h-3.5 w-3.5" />
				<span>{title}</span>
			</div>
			<div className="flex items-center gap-0.5 rounded-md bg-accent/60 p-0.5">
				{options.map((option) => (
					<button
						key={option.value}
						type="button"
						title={option.label}
						aria-label={option.label}
						aria-pressed={mode === option.value}
						onClick={(event) => onSetMode(option.value, event)}
						className={cn(
							"flex h-5 w-6 items-center justify-center rounded-[4px] transition-colors",
							mode === option.value
								? "bg-primary text-primary-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						<span className={cn(option.icon, "h-3.5 w-3.5")} />
					</button>
				))}
			</div>
		</div>
	);
}
