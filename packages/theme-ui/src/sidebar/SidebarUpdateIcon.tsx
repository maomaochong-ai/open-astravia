import type { JSX } from "react";

export interface SidebarUpdateIconProps {
	downloadProgressLabel: string;
	phase: "available" | "downloading" | "ready" | "error";
	progress?: number;
}

export function SidebarUpdateIcon({
	downloadProgressLabel,
	phase,
	progress,
}: SidebarUpdateIconProps): JSX.Element {
	if (phase === "downloading") {
		return (
			<SidebarUpdateProgress
				label={downloadProgressLabel}
				progress={progress ?? 0}
			/>
		);
	}
	if (phase === "ready") {
		return (
			<>
				<span className="icon-[solar--restart-square-linear] h-4 w-4 text-primary" />
				<span className="absolute right-[3px] top-[3px] h-1.5 w-1.5 rounded-full bg-primary" />
			</>
		);
	}
	if (phase === "available") {
		return (
			<>
				<span className="icon-[solar--download-square-linear] h-4 w-4 text-primary" />
				<span className="absolute right-[3px] top-[3px] h-1.5 w-1.5 rounded-full bg-primary" />
			</>
		);
	}
	return <span className="icon-[solar--danger-square-linear] h-4 w-4 text-destructive" />;
}

function SidebarUpdateProgress({
	label,
	progress,
}: {
	label: string;
	progress: number;
}): JSX.Element {
	const radius = 9;
	const stroke = 2;
	const circumference = 2 * Math.PI * radius;
	const progressOffset = circumference * (1 - progress);

	return (
		<svg width="22" height="22" viewBox="0 0 22 22" className="rotate-[-90deg]">
			<title>{label}</title>
			<circle
				cx="11"
				cy="11"
				r={radius}
				fill="none"
				stroke="currentColor"
				strokeWidth={stroke}
				opacity={0.25}
			/>
			<circle
				cx="11"
				cy="11"
				r={radius}
				fill="none"
				stroke="var(--primary)"
				strokeWidth={stroke}
				strokeDasharray={circumference}
				strokeDashoffset={progressOffset}
				strokeLinecap="round"
				style={{ transition: "stroke-dashoffset 200ms ease-out" }}
			/>
		</svg>
	);
}
