import { useCallback, useEffect, useMemo, useState } from "react";

export interface WindowPinAction {
	readonly pinned: boolean;
	toggle(): Promise<void>;
}

/** Window-level capability. It deliberately has no Conversation dependency. */
export function useWindowPinAction(): WindowPinAction {
	const [pinned, setPinned] = useState(false);

	useEffect(() => {
		void window.vetta.window.isAlwaysOnTop().then(setPinned);
	}, []);

	const toggle = useCallback(async () => {
		setPinned(await window.vetta.window.toggleAlwaysOnTop());
	}, []);

	return useMemo(() => ({ pinned, toggle }), [pinned, toggle]);
}
