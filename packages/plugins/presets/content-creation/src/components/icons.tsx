interface IconProps {
	className?: string;
}

const stroke = {
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 1.7,
	strokeLinecap: "round",
	strokeLinejoin: "round",
} as const;

export function ContentCreationIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
			<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H12M4 7.5v10A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V12" />
			<path d="m8 16 5.5-5.5 2 2L10 18H8v-2Z" />
			<path d="M17 3v5M14.5 5.5h5" />
		</svg>
	);
}

export function AddIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
			<path d="M12 5v14M5 12h14" />
		</svg>
	);
}

export function TrashIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
			<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
		</svg>
	);
}

export function PlayIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
			<path d="m8 5 11 7-11 7Z" />
		</svg>
	);
}

export function PauseIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
			<path d="M9 5v14M15 5v14" />
		</svg>
	);
}
