import { type JSX, type ReactNode, useEffect, useRef, useState } from "react";

interface ConfirmButtonProps {
	label: ReactNode;
	confirmLabel: string;
	className?: string;
	disabled?: boolean;
	onConfirm(): void;
}

/** Two-step inline confirmation: first click arms, second click within 3s fires. */
export function ConfirmButton(props: ConfirmButtonProps): JSX.Element {
	const [armed, setArmed] = useState(false);
	const timer = useRef<number | null>(null);
	useEffect(
		() => () => {
			if (timer.current !== null) window.clearTimeout(timer.current);
		},
		[],
	);
	return (
		<button
			type="button"
			disabled={props.disabled}
			className={[
				"rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
				armed
					? "border-red-500/60 bg-red-500/10 text-red-500"
					: "border-[var(--border)] bg-transparent text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
				props.className ?? "",
			].join(" ")}
			onClick={() => {
				if (!armed) {
					setArmed(true);
					timer.current = window.setTimeout(() => setArmed(false), 3_000);
					return;
				}
				if (timer.current !== null) window.clearTimeout(timer.current);
				setArmed(false);
				props.onConfirm();
			}}
		>
			{armed ? props.confirmLabel : props.label}
		</button>
	);
}
