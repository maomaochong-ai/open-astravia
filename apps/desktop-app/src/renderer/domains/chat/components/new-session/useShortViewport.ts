import { useEffect, useState } from "react";
import { SHORT_VIEWPORT } from "./constants";

export function useShortViewport(threshold = SHORT_VIEWPORT): boolean {
	const [short, setShort] = useState(() => window.innerHeight < threshold);

	useEffect(() => {
		const onResize = (): void => setShort(window.innerHeight < threshold);
		onResize();
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [threshold]);

	return short;
}
