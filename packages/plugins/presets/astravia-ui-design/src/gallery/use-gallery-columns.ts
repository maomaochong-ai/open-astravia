import { useEffect, useState } from "react";
import { galleryColumnCount } from "./gallery-layout";

/**
 * 量出项目宫格当前实际排几列（与 auto-fill 的公式一致）。
 *
 * 用 callback ref 而不是 useRef：宫格随视图切换条件渲染，effect 必须跟着节点的
 * 挂载/卸载重挂 ResizeObserver，`ref.current` 的变化不会触发重跑。
 */
export function useGalleryColumns(): { ref: (node: HTMLElement | null) => void; columns: number } {
	const [node, setNode] = useState<HTMLElement | null>(null);
	const [columns, setColumns] = useState(1);

	useEffect(() => {
		if (!node) return;
		const measure = (): void => setColumns(galleryColumnCount(node.clientWidth));
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return () => observer.disconnect();
	}, [node]);

	return { ref: setNode, columns };
}
