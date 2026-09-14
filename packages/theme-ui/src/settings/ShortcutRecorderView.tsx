import { useEffect, useRef, useState, type JSX } from "react";
import { Button, cn } from "@vetta-org/ui";

export interface ShortcutRecorderViewProps {
	readonly value: string;
	readonly onChange: (shortcut: string) => void;
	readonly onReset: () => void;
	readonly isDefault: boolean;
	readonly placeholder: string;
	readonly resetLabel: string;
	/** Host provides platform-specific key → shortcut parsing. */
	readonly eventToShortcut: (event: KeyboardEvent) => string | null;
	/** Host provides display formatting for a stored shortcut. */
	readonly formatShortcut: (shortcut: string) => string;
}

export function ShortcutRecorderView({
	value,
	onChange,
	onReset,
	isDefault,
	placeholder,
	resetLabel,
	eventToShortcut,
	formatShortcut,
}: ShortcutRecorderViewProps): JSX.Element {
	const [recording, setRecording] = useState(false);
	const [pendingKeys, setPendingKeys] = useState<string | null>(null);
	const inputRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (!recording) return;

		function handleKeyDown(e: KeyboardEvent) {
			e.preventDefault();
			e.stopPropagation();

			const shortcut = eventToShortcut(e);
			if (!shortcut) return;

			setPendingKeys(shortcut);
			onChange(shortcut);
			setRecording(false);
		}

		function handleBlur() {
			setRecording(false);
			setPendingKeys(null);
		}

		document.addEventListener("keydown", handleKeyDown, true);
		inputRef.current?.addEventListener("blur", handleBlur);
		const btn = inputRef.current;

		return () => {
			document.removeEventListener("keydown", handleKeyDown, true);
			btn?.removeEventListener("blur", handleBlur);
		};
	}, [recording, onChange, eventToShortcut]);

	const displayValue = pendingKeys ? formatShortcut(pendingKeys) : formatShortcut(value);

	return (
		<div className="flex items-center gap-2">
			<button
				ref={inputRef}
				type="button"
				onClick={() => {
					setRecording(true);
					setPendingKeys(null);
				}}
				className={cn(
					"flex h-[30px] min-w-[120px] items-center justify-center rounded-lg border px-3 text-[12px] font-mono transition-colors",
					recording
						? "animate-pulse border-primary bg-primary/10 text-foreground"
						: "border-input bg-muted text-foreground hover:bg-secondary",
				)}
			>
				{recording ? placeholder : displayValue}
			</button>
			{!isDefault && (
				<Button variant="ghost" size="icon-xs" onClick={onReset} title={resetLabel}>
					<span className="icon-[mdi--restore] h-3.5 w-3.5" />
				</Button>
			)}
		</div>
	);
}
