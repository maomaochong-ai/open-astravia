import { useEffect, useState } from "react";

/** Tick once per second while the tool is still running, so the live badge updates. */
export function useElapsedWhilePending(startedAt: number | undefined, pending: boolean): number | null {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!pending || startedAt === undefined) return;
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [pending, startedAt]);
	if (startedAt === undefined) return null;
	return Math.max(0, now - startedAt);
}
