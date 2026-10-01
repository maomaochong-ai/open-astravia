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
		setColumns(galleryColumnCount(node.clientWidth));
		// 回调里读 contentRect 而不是 clientWidth：同一批回调里别人可能已经写过样式，
		// 再读一次布局属性就是一次强制同步布局。
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) setColumns(galleryColumnCount(entry.contentRect.width));
		});
		observer.observe(node);
		return () => observer.disconnect();
	}, [node]);

	return { ref: setNode, columns };
}
