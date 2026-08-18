import { isMac } from "@shared/lib/platform";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WindowControlItem, WindowControlsModel } from "./types";

export function useWindowControlsModel(): WindowControlsModel {
	const { t } = useTranslation("common");
	const [isMaximized, setIsMaximized] = useState(false);

	useEffect(() => {
		if (isMac) return;

		void window.vetta.window.isMaximized().then(setIsMaximized);
		return window.vetta.window.onMaximizedChanged(setIsMaximized);
	}, []);

	const minimize = useCallback(() => {
		void window.vetta.window.minimize();
	}, []);

	const maximize = useCallback(async () => {
		await window.vetta.window.maximize();
		const maximized = await window.vetta.window.isMaximized();
		setIsMaximized(maximized);
	}, []);

	const close = useCallback(() => {
		void window.vetta.window.close();
	}, []);

	const controls: WindowControlItem[] = [
		{
			action: minimize,
			kind: "minimize",
			label: t("appShell.windowControls.minimize"),
		},
		{
			action: maximize,
			kind: isMaximized ? "restore" : "maximize",
			label: t(isMaximized ? "appShell.windowControls.restore" : "appShell.windowControls.maximize"),
		},
		{
			action: close,
			kind: "close",
			label: t("appShell.windowControls.close"),
		},
	];

	return {
		controls,
		isMac,
		isMaximized,
	};
}
