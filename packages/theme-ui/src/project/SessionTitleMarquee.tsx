import { cn } from "@vetta-org/ui";
import { type CSSProperties, type JSX, useRef, useState } from "react";

interface SessionTitleMarqueeProps {
	className?: string;
	label: string;
	title?: string;
}

type MarqueeStyle = CSSProperties & {
	"--session-title-marquee-distance": string;
	"--session-title-marquee-duration": string;
};

/** Keeps the compact sidebar label truncated until the user points at an overflowing title. */
export function SessionTitleMarquee({
	className,
	label,
	title = label,
}: SessionTitleMarqueeProps): JSX.Element {
	const labelRef = useRef<HTMLSpanElement>(null);
	const [marqueeStyle, setMarqueeStyle] = useState<MarqueeStyle | undefined>();

	const startMarquee = (): void => {
		const labelElement = labelRef.current;
		if (!labelElement) return;
		const overflowDistance = Math.ceil(labelElement.scrollWidth - labelElement.clientWidth);
		if (overflowDistance <= 1) return;

		setMarqueeStyle({
			"--session-title-marquee-distance": `-${overflowDistance}px`,
			"--session-title-marquee-duration": `${Math.max(2.5, overflowDistance / 72 + 1.2)}s`,
		});
	};

	return (
		<span
			className={cn("min-w-0 flex-1 overflow-hidden", className)}
			data-session-title="true"
			data-session-title-scrolling={marqueeStyle ? "true" : undefined}
			onMouseEnter={startMarquee}
			onMouseLeave={() => setMarqueeStyle(undefined)}
			title={title}
		>
			<span
				ref={labelRef}
				className={cn("block whitespace-nowrap", marqueeStyle ? "session-title-marquee-track w-max" : "truncate")}
				style={marqueeStyle}
			>
				{label}
			</span>
		</span>
	);
}
