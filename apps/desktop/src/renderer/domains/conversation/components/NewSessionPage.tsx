import { OrphanRemoteProjectGuard } from "@domains/project/components/orphan-remote/OrphanRemoteProjectGuard";
import { pageHeaderRightSlotAtom } from "@shared/store/atoms";
import { useSearch } from "@tanstack/react-router";
import { useThemeSurface } from "@vetta-org/theme-sdk/appearance";
import { useSetAtom } from "jotai";
import { useEffect, useMemo } from "react";
import { NewSessionHeaderActions } from "./new-session/NewSessionHeaderActions";
import { NewSessionPageView } from "./new-session/NewSessionPageView";
import { useNewSessionPageModel } from "./new-session/useNewSessionPageModel";

export function NewSessionPage(): JSX.Element {
	const search = useSearch({ strict: false }) as { cwd?: string };
	return (
		<OrphanRemoteProjectGuard cwd={search.cwd ? decodeURIComponent(search.cwd) : null}>
			<NewSessionPageContent />
		</OrphanRemoteProjectGuard>
	);
}

function NewSessionPageContent(): JSX.Element {
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
