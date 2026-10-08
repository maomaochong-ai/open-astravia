import { useStore } from "jotai";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { AfterPaint } from "../shared/components/AfterPaint";
import { initialRoutePaintedAtom } from "./initial-route-paint-state";

function ReportPaint(): null {
	const store = useStore();
	useEffect(() => {
		if (store.get(initialRoutePaintedAtom)) return;
		store.set(initialRoutePaintedAtom, true);
		window.vetta.appLifecycle.reportRendererContentPainted();
	}, [store]);
	return null;
}

export function InitialRoutePaint({ children }: { children?: ReactNode }): JSX.Element {
	return (
		<AfterPaint>
			<ReportPaint />
			{children}
		</AfterPaint>
	);
}
