import { lazy, Suspense } from "react";
import { ActionApprovalCenter } from "../shared/action-approval/ActionApprovalCenter";
import { SshPromptDialog } from "../shared/components/SshPromptDialog";
import { UiZoomHud } from "../shared/components/UiZoomHud";
import { useAtomValue } from "jotai";
import { initialRoutePaintedAtom } from "./initial-route-paint-state";

const RootOverlayViews = lazy(() =>
	import("./RootOverlayViews").then((module) => ({ default: module.RootOverlayViews })),
);

export function RootGlobalOverlays(): JSX.Element {
	const routePainted = useAtomValue(initialRoutePaintedAtom);
	return (
		<>
			{/* Keep receiving requests while the presenter chunk is loading. */}
			<ActionApprovalCenter />
			<SshPromptDialog />
			<UiZoomHud />
			{routePainted && (
				<Suspense fallback={null}>
					<RootOverlayViews />
				</Suspense>
			)}
		</>
	);
}
