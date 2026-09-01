import type { JSX } from "react";

/** 内联 SVG：插件不依赖宿主的图标字体，避免主题替换后图标消失。 */
function Icon({ children, label }: { children: JSX.Element; label?: string }): JSX.Element {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.7"
			strokeLinecap="round"
			strokeLinejoin="round"
			className="h-3.5 w-3.5"
			role={label ? "img" : undefined}
			aria-label={label}
			aria-hidden={label ? undefined : true}
		>
			{children}
		</svg>
	);
}

export function DeviceIcon(): JSX.Element {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.6"
			className="h-6 w-6"
			aria-hidden="true"
		>
			<rect x="6" y="2.5" width="12" height="19" rx="3" />
			<path d="M10 18.8h4" strokeLinecap="round" />
		</svg>
	);
}

export function RefreshIcon({ label }: { label?: string }): JSX.Element {
	return (
		<Icon label={label}>
			<>
				<path d="M20 12a8 8 0 1 1-2.3-5.6" />
				<path d="M20 4v4h-4" />
			</>
		</Icon>
	);
}

export function ExternalIcon({ label }: { label?: string }): JSX.Element {
	return (
		<Icon label={label}>
			<>
				<path d="M14 4h6v6" />
				<path d="M20 4 11 13" />
				<path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
			</>
		</Icon>
	);
}
