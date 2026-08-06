import type { JSX } from "react";

export interface SkillToggleSwitchProps {
	checked: boolean;
	onChange: () => void;
	disabled?: boolean;
}

export function SkillToggleSwitch({ checked, onChange, disabled }: SkillToggleSwitchProps): JSX.Element {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			disabled={disabled}
			onClick={(e) => {
				e.stopPropagation();
				onChange();
			}}
			className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 ${
				checked ? "bg-primary" : "bg-input"
			}`}
		>
			<span
				className={`pointer-events-none block h-3.5 w-3.5 rounded-full bg-background shadow-lg ring-0 transition-transform duration-200 ${
					checked ? "translate-x-4" : "translate-x-0.5"
				}`}
			/>
		</button>
	);
}
