import { useCallback, useEffect, useState } from "react";

export interface FullScreenToggleModel {
	isFullScreen: boolean;
	toggle: () => void;
}

/**
 * 宿主标签栏的全屏切换状态。
 *
 * 初始值取主进程的真实状态：用户可能先用系统绿灯、Esc 或菜单进入过全屏，
 * 渲染端不能假设「当前未全屏」，否则首次点击方向会反。
 *
 * 桥接可能不完整（旧版 preload、只注入了部分能力的宿主），缺方法时按钮
 * 按「未全屏 + 点了没反应」降级，不允许把整个标签栏一起炸掉。
 */
export function useFullScreenToggle(): FullScreenToggleModel {
	const [isFullScreen, setIsFullScreen] = useState(false);

	useEffect(() => {
		const bridge: typeof window.astravia | undefined = window.astravia;
		const windowApi = bridge?.window;
		if (!windowApi) return;
		let active = true;
		void windowApi
			.isFullScreen()
			.then((value) => {
				if (active) setIsFullScreen(value);
			})
			.catch(() => {
				// 取不到就按未全屏处理，按钮仍可用。
			});
		const unsubscribe = windowApi.onFullScreenChanged((value) => setIsFullScreen(value));
		return () => {
			active = false;
			unsubscribe();
		};
	}, []);

	const toggle = useCallback(() => {
		const windowApi: typeof window.astravia.window | undefined = window.astravia?.window;
		if (!windowApi) return;
		void windowApi.toggleFullScreen().catch(() => {
			// 主进程没有窗口时返回 false，这里无需额外反馈。
		});
	}, []);

	return { isFullScreen, toggle };
}
