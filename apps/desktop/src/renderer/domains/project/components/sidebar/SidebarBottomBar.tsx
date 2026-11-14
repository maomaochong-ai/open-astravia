import { cn } from "@shared/lib/utils";
import { MessageCenter } from "./message-center/MessageCenter";
import { SettingsMenu } from "./settings-menu/SettingsMenu";
import { SidebarUpdateButton } from "./update/SidebarUpdateButton";

interface SidebarBottomBarProps {
	className?: string;
	classNames?: {
		settings?: string;
	};
}

/**
 * 侧栏底栏：左侧用户菜单（昵称过长 truncate），右侧是消息中心与更新图标
 * （更新图标仅在有更新时出现，shrink-0 不被挤出）。
 *
 * 消息中心没有跟随参照实现移除：本仓的站内信接的是服务端 SSE 与未读计数，
 * 与参照实现里那条「商业版遗留」的通知入口不是同一件事。
 */
export function SidebarBottomBar({ className, classNames }: SidebarBottomBarProps): JSX.Element {
	return (
		<div className={cn("flex min-w-0 items-center gap-1 px-1.5 py-1.5", className)}>
			<div className={cn("min-w-0 flex-1", classNames?.settings)}>
				<SettingsMenu />
			</div>
			<div className="flex shrink-0 items-center gap-1">
				<MessageCenter />
				<SidebarUpdateButton />
			</div>
		</div>
	);
}
