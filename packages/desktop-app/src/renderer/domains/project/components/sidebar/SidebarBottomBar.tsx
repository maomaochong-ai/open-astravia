import { cn } from "@shared/lib/utils";
import { MessageCenter } from "./message-center/MessageCenter";
import { SettingsMenu } from "./settings-menu/SettingsMenu";
import { SidebarUpdateBanner } from "./update/SidebarUpdateBanner";

interface SidebarBottomBarProps {
	className?: string;
	classNames?: {
		settings?: string;
	};
}

/**
 * 侧栏底栏：上方更新条（仅更新就绪时显示），下方左侧用户菜单（昵称过长 truncate）、右侧消息中心 shrink-0 不被挤出。
 */
export function SidebarBottomBar({ className, classNames }: SidebarBottomBarProps): JSX.Element {
	return (
		<div className={cn("flex min-w-0 flex-col gap-1 px-1.5 py-1.5", className)}>
			<SidebarUpdateBanner />
			<div className="flex min-w-0 items-center gap-1">
				<div className={cn("min-w-0 flex-1", classNames?.settings)}>
					<SettingsMenu />
				</div>
				<div className="shrink-0">
					<MessageCenter />
				</div>
			</div>
		</div>
	);
}
