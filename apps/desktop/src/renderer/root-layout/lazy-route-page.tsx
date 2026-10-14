import { lazy } from "react";
import type { ComponentType } from "react";
import { InitialRoutePaint } from "./InitialRoutePaint";
import { useIdleRoutePrefetch } from "./useIdleRoutePrefetch";

function IdleRoutePrefetch(): null {
	useIdleRoutePrefetch();
	return null;
}

/** Network waits can look idle; only prefetch after the requested page commits. */
export function lazyRoutePage(load: () => Promise<{ default: ComponentType }>) {
	return lazy(async () => {
		const { default: Page } = await load();
		return {
			default: function LoadedRoutePage() {
				return (
					<>
						<Page />
						<InitialRoutePaint>
							<IdleRoutePrefetch />
						</InitialRoutePaint>
					</>
				);
			},
		};
	});
}
