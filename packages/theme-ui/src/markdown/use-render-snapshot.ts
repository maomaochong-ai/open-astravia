import { useEffect, useRef, useState } from "react";

/** Trailing throttle: continuous arrivals cannot postpone rendering indefinitely. */
export function useRenderSnapshot(source: string, active: boolean, live: boolean, interval = 250): string {
	const [snapshot, setSnapshot] = useState(source);
	const latest = useRef(source);
	latest.current = source;
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => {
		if (!active || !live) {
			clearTimeout(timer.current);
			timer.current = undefined;
			if (active) setSnapshot(source);
			return;
		}
		if (snapshot === source || timer.current !== undefined) return;
		timer.current = setTimeout(() => {
			timer.current = undefined;
			setSnapshot(latest.current);
		}, interval);
	}, [source, snapshot, active, live, interval]);
	useEffect(() => () => clearTimeout(timer.current), []);
	return active && !live ? source : snapshot;
}
