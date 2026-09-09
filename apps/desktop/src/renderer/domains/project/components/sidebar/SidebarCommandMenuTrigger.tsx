import { formatShortcut } from "@shared/lib/platform";
import { getEffectiveShortcut, loadShortcutBindings } from "@shared/lib/shortcuts";
import { commandMenuOpenAtom } from "@shared/store/atoms";
import { Button } from "@vetta/ui";
import { useSetAtom } from "jotai";
import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";

/**
 * 侧栏顶部的 Command Menu 入口。
 *
 * 主入口是 ⌘K，这个按钮只是可发现性的兜底，因此保持原来的图标按钮形态：顶栏在
 * mac 上要给红绿灯让出 78px，侧栏最窄 180px 时留给 actions 的净宽不足 70px，
 * 放不下「输入框样式」的触发条。快捷键提示挂在 title 上，并跟随用户改键。
 */
export function SidebarCommandMenuTrigger(): JSX.Element {
	const { t } = useTranslation("common");
	const setOpen = useSetAtom(commandMenuOpenAtom);
	const [shortcut, setShortcut] = useState("");

	useEffect(() => {
		let active = true;
		const apply = (bindings: Parameters<typeof getEffectiveShortcut>[1]) => {
			if (active) setShortcut(getEffectiveShortcut("open-command-menu", bindings));
		};
		void loadShortcutBindings().then(apply);
		return window.vetta.config.onShortcutsChanged((event) => apply(event.bindings ?? {}));
	}, []);

	const label = t("commandMenu.trigger");
	const hint = shortcut ? `${label} (${formatShortcut(shortcut)})` : label;

	return (
		<Button
			className="no-drag"
			aria-label={hint}
			size="icon-sm"
			title={hint}
			type="button"
			variant="ghost"
			onClick={() => setOpen(true)}
		>
			<span aria-hidden="true" className="icon-[solar--magnifer-linear] size-4" />
		</Button>
	);
}
