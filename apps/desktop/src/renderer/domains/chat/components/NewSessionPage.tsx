import { pageHeaderRightSlotAtom } from "@shared/store/atoms";
import { useThemeSurface } from "@vetta/theme-sdk/appearance";
import { useSetAtom } from "jotai";
import { useEffect, useMemo } from "react";
import { NewSessionHeaderActions } from "./new-session/NewSessionHeaderActions";
import { NewSessionPageView } from "./new-session/NewSessionPageView";
import { useNewSessionPageModel } from "./new-session/useNewSessionPageModel";

export function NewSessionPage(): JSX.Element {
	const surface = useThemeSurface("chat.newSessionPage");
	const model = useNewSessionPageModel();
	const setHeaderRightSlot = useSetAtom(pageHeaderRightSlotAtom);

	const headerActions = useMemo(
		() => (
			<NewSessionHeaderActions
				activityOpen={model.activityOpen}
				onToggleActivity={model.onToggleActivity}
				onTogglePin={model.onTogglePin}
				panelTitle={model.panelTitle}
				pinTitle={model.pinTitle}
				pinned={model.pinned}
			/>
		),
		[
			model.activityOpen,
			model.onToggleActivity,
			model.onTogglePin,
			model.panelTitle,
			model.pinTitle,
			model.pinned,
		],
	);

	useEffect(() => {
		setHeaderRightSlot(headerActions);
		return () => setHeaderRightSlot(null);
	}, [headerActions, setHeaderRightSlot]);

	return <NewSessionPageView {...model} className={surface?.rootClassName} />;
}
