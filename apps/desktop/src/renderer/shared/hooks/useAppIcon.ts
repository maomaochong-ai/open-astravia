import { useCallback, useEffect, useState } from "react";
import { APP_ICON_DEFAULT, type AppIconId, normalizeAppIconId } from "../../../shared/app-icon";

/**
 * 应用图标。事实源在主进程（它负责换 Dock / 窗口图标并落盘），这里只镜像：
 * 点选立即更新本地值，主进程广播（含其他窗口触发的）再同步回来。
 */
export function useAppIcon(): { iconId: AppIconId; setIcon: (id: AppIconId) => void } {
	const [iconId, setIconId] = useState<AppIconId>(APP_ICON_DEFAULT);

	useEffect(() => {
		let cancelled = false;
		void window.astravia.appIcon.get().then((value) => {
			if (!cancelled) setIconId(normalizeAppIconId(value));
		});
		const off = window.astravia.appIcon.onChanged((value) => setIconId(normalizeAppIconId(value)));
		return () => {
			cancelled = true;
			off();
		};
	}, []);

	const setIcon = useCallback((id: AppIconId) => {
		setIconId(id);
		void window.astravia.appIcon.set(id);
	}, []);

	return { iconId, setIcon };
}
