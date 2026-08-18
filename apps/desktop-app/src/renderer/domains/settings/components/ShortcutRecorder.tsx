import { ShortcutRecorderView } from "@vetta/theme-ui/settings";
import { eventToShortcut, formatShortcut } from "@shared/lib/platform";

export function ShortcutRecorder({
	value,
	onChange,
	onReset,
	isDefault,
	placeholder,
	resetLabel,
}: {
	value: string;
	onChange: (shortcut: string) => void;
	onReset: () => void;
	isDefault: boolean;
	placeholder: string;
	resetLabel: string;
}): JSX.Element {
	return (
		<ShortcutRecorderView
			value={value}
			onChange={onChange}
			onReset={onReset}
			isDefault={isDefault}
			placeholder={placeholder}
			resetLabel={resetLabel}
			eventToShortcut={eventToShortcut}
			formatShortcut={formatShortcut}
		/>
	);
}
