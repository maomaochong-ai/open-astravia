import { type ReactNode, useEffect, useState } from "react";
import { waitForCommittedPaint } from "../lib/committed-paint";

/** Mount secondary UI after the current commit has had a chance to paint. */
export function AfterPaint({ children }: { children: ReactNode }): JSX.Element | null {
	const [painted, setPainted] = useState(false);
	useEffect(() => {
		let disposed = false;
		void waitForCommittedPaint({ timeoutMs: null }).then(() => {
			if (!disposed) setPainted(true);
		});
		return () => {
			disposed = true;
		};
	}, []);
	return painted ? <>{children}</> : null;
}
