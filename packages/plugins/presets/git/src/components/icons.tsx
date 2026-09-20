interface IconProps {
	className?: string;
}

export function GitIcon({ className }: IconProps): JSX.Element {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<circle cx="18" cy="18" r="3" />
			<circle cx="6" cy="6" r="3" />
			<path d="M6 21V9a9 9 0 0 0 9 9" />
		</svg>
	);
}

export function RefreshIcon({ className }: IconProps): JSX.Element {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M21 12a9 9 0 1 1-2.64-6.36" />
			<path d="M21 3v6h-6" />
		</svg>
	);
}

export function FileIcon({ className }: IconProps): JSX.Element {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M14 3v4a1 1 0 0 0 1 1h4" />
			<path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
		</svg>
	);
}

export function CloseIcon({ className }: IconProps): JSX.Element {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M18 6 6 18" />
			<path d="m6 6 12 12" />
		</svg>
	);
}

export function ListViewIcon({ className }: IconProps): JSX.Element {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M8 6h13" />
			<path d="M8 12h13" />
			<path d="M8 18h13" />
			<path d="M3 6h.01" />
			<path d="M3 12h.01" />
			<path d="M3 18h.01" />
		</svg>
	);
}

export function TreeViewIcon({ className }: IconProps): JSX.Element {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M4 4h7" />
			<path d="M9 10h7" />
			<path d="M9 16h7" />
			<path d="M4 4v12a2 2 0 0 0 2 2h1" />
			<path d="M6 10h1" />
		</svg>
	);
}

export function SidebarIcon({ className }: IconProps): JSX.Element {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<rect x="3" y="4" width="18" height="16" rx="2" />
			<path d="M9 4v16" />
		</svg>
	);
}

export function GraphIcon({ className }: IconProps): JSX.Element {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<circle cx="5" cy="6" r="2" />
			<circle cx="5" cy="18" r="2" />
			<circle cx="15" cy="12" r="2" />
			<path d="M5 8v8" />
			<path d="M5 12h4a4 4 0 0 0 4-4V8" />
		</svg>
	);
}

export function BranchIcon({ className }: IconProps): JSX.Element {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<circle cx="6" cy="6" r="2.5" />
			<circle cx="6" cy="18" r="2.5" />
			<circle cx="18" cy="8" r="2.5" />
			<path d="M6 8.5v7" />
			<path d="M18 10.5a6 6 0 0 1-6 6H6" />
		</svg>
	);
}

export function CopyIcon({ className }: IconProps): JSX.Element {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<rect x="9" y="9" width="11" height="11" rx="2" />
			<path d="M5 15V5a2 2 0 0 1 2-2h8" />
		</svg>
	);
}

export function PushIcon({ className }: IconProps): JSX.Element {
	return (
		<svg className={className} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<path d="M16 20V4M10.6667 9.33333L16 4L21.3333 9.33333M4 16C4 19.1826 5.26428 22.2348 7.51472 24.4853C9.76516 26.7357 12.8174 28 16 28C19.1826 28 22.2348 26.7357 24.4853 24.4853C26.7357 22.2348 28 19.1826 28 16" />
		</svg>
	);
}

export function PullIcon({ className }: IconProps): JSX.Element {
	return (
		<svg className={className} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<path d="M16 12L16 28M21.3333 22.6667L16 28L10.6667 22.6667M28 16C28 12.8174 26.7357 9.76516 24.4853 7.51472C22.2348 5.26429 19.1826 4 16 4C12.8174 4 9.76516 5.26428 7.51472 7.51472C5.26428 9.76516 4 12.8174 4 16" />
		</svg>
	);
}

export function FetchIcon({ className }: IconProps): JSX.Element {
	return (
		<svg className={className} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<path d="M20.4468 4H12.2584M20.4468 16.2826H25.3408C25.6107 16.2827 25.8745 16.3628 26.0988 16.5127C26.3232 16.6627 26.4981 16.8758 26.6014 17.1252C26.7046 17.3745 26.7317 17.6489 26.679 17.9136C26.6264 18.1782 26.4965 18.4214 26.3057 18.6123L17.3175 27.6004C17.0616 27.8563 16.7145 28 16.3526 28C15.9907 28 15.6437 27.8563 15.3877 27.6004L6.39958 18.6123C6.20877 18.4214 6.07884 18.1782 6.02621 17.9136C5.97357 17.6489 6.0006 17.3745 6.10387 17.1252C6.20714 16.8758 6.38202 16.6627 6.60639 16.5127C6.83077 16.3628 7.09457 16.2827 7.36445 16.2826H12.2584V8.09422H20.4468V16.2826Z" />
		</svg>
	);
}

export function SyncIcon({ className }: IconProps): JSX.Element {
	return (
		<svg className={className} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<path d="M14.6667 12.3333L9.33333 7L4 12.3333M9.33333 7V25.6667M17.3333 20.3333L22.6667 25.6667L28 20.3333M22.6667 25.6667V7" />
		</svg>
	);
}

/** Disclosure chevron; points down, rotated by callers when collapsed. */
export function ChevronIcon({ className }: IconProps): JSX.Element {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="m6 9 6 6 6-6" />
		</svg>
	);
}
