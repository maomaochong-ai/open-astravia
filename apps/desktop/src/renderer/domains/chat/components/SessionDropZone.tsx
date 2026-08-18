import { SessionDropZoneView } from "@vetta/theme-ui/chat";
import { useSessionDropZoneModel } from "../hooks/useSessionDropZoneModel";

interface SessionDropZoneProps {
	/** Optional cwd used when no activeSession yet (e.g. NewSessionPage). */
	cwdOverride?: string;
	className?: string;
	children: React.ReactNode;
}

/**
 * @deprecated Prefer mounting drop on the input **card** via InputBarView
 * (useSessionDropZoneModel + SessionDropZoneView). Outer wrappers include
 * padding / max-width gutters and misalign the overlay with the real input.
 *
 * Still available for one-off shells that already match the visual target box.
 */
export function SessionDropZone({ cwdOverride, className, children }: SessionDropZoneProps): JSX.Element {
	const model = useSessionDropZoneModel(cwdOverride);
	return (
		<SessionDropZoneView className={className} {...model}>
			{children}
		</SessionDropZoneView>
	);
}
