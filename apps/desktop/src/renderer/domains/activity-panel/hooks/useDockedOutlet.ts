import { useCallback, useState } from "react";

/**
 * 登记「标签卡内容 portal 进去的那个容器」。
 *
 * 宽屏侧栏与窄屏 bottom sheet 各渲染一份同样的容器，跨断点切换时两份会短暂同时存在：
 * AnimatePresence 会让退场的 sheet 多活一个动画时长才卸载。若卸载时无条件清空登记，
 * 就会把新挂载的那份刚注册好的容器抹成 null，portal 失去落点、面板内容整个消失
 * （拉窄再拉宽后面板空白，只有再拉窄才会回来）。
 *
 * 因此只在「正在卸载的就是当前登记的那个容器」时才清空。返回的 ref 回调依赖 React 19 的
 * ref cleanup：返回清理函数后 React 不再用 null 调用该 ref。
 */
export function useDockedOutlet(): [HTMLDivElement | null, (node: HTMLDivElement) => () => void] {
	const [outlet, setOutlet] = useState<HTMLDivElement | null>(null);
	const registerOutlet = useCallback((node: HTMLDivElement) => {
		setOutlet(node);
		return () => setOutlet((current) => (current === node ? null : current));
	}, []);
	return [outlet, registerOutlet];
}
