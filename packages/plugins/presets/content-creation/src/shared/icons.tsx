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

export function DuplicateIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
			<rect x="8" y="8" width="11" height="11" rx="2" />
			<path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
		</svg>
	);
}

export function LockIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
			<rect x="5" y="10" width="14" height="10" rx="2" />
			<path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" />
		</svg>
	);
}

export function UnlockIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
			<rect x="5" y="10" width="14" height="10" rx="2" />
			<path d="M8 10V7a4 4 0 0 1 7.5-2M12 14v2" />
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

export function ArrowUpIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
			<path d="m6 10 6-6 6 6M12 4v16" />
		</svg>
	);
}

export function ImageIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
			<rect x="3" y="4" width="18" height="16" rx="2" />
			<circle cx="9" cy="10" r="1.5" />
			<path d="m5 18 5-5 3 3 2-2 4 4" />
		</svg>
	);
}

export function CloseIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
			<path d="m6 6 12 12M18 6 6 18" />
		</svg>
	);
}
