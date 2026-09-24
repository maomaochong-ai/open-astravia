import { useEffect, useRef, useState } from "react";

/** A single visibility signal gates parsing, worker jobs and preview lifetimes. */
export function useRichVisibility<T extends HTMLElement = HTMLSpanElement>() {
	const ref = useRef<T>(null);
	const [intersecting, setIntersecting] = useState(false);
	const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
	useEffect(() => {
		const update = () => setVisible(!document.hidden);
		document.addEventListener("visibilitychange", update);
		const element = ref.current;
		const observer =
			typeof IntersectionObserver === "function"
				? new IntersectionObserver((entries) => setIntersecting(entries.some((entry) => entry.isIntersecting)))
				: null;
		if (element && observer) observer.observe(element);
		else setIntersecting(true);
		return () => {
			observer?.disconnect();
			document.removeEventListener("visibilitychange", update);
		};
	}, []);
	return { ref, active: intersecting && visible };
}
