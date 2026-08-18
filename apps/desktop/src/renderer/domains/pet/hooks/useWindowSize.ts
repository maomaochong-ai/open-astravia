import { useEffect, useState } from "react";

function getWindowSize(): { width: number; height: number } {
	return {
		width: window.innerWidth,
		height: window.innerHeight,
	};
}

export function useWindowSize(): [
	{ width: number; height: number },
	(size: { width: number; height: number }) => void,
] {
	const [windowSize, setWindowSize] = useState(getWindowSize);

	useEffect(() => {
		const handleResize = () => setWindowSize(getWindowSize());
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, []);

	return [windowSize, setWindowSize];
}
