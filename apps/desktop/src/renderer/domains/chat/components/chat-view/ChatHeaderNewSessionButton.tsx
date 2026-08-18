import { Button } from "@shared/components/ui/button";
import { useNarrowScreen } from "@shared/hooks/useNarrowScreen";
import { sidebarCollapsedAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { useNewChatNavigation } from "../../../project/hooks/useNewChatNavigation";

/**
 * 会话页顶栏「新会话」入口。仅在侧边栏不可见（收起或窄屏浮层）时出现，
 * 与展开侧边栏按钮同处标题左侧；行为等同侧边栏导航的「新会话」。
 */
export function ChatHeaderNewSessionButton(): JSX.Element | null {
	const { t } = useTranslation("chat");
	const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom);
	const narrow = useNarrowScreen();
	const onNewChat = useNewChatNavigation();

	if (!sidebarCollapsed && !narrow) return null;

	const title = t("chatView.newSessionButton.title");
	return (
		<Button
			variant="ghost"
			size="icon-sm"
			// 与展开侧边栏按钮保持 4px 紧邻，到标题再多让出 4px，让两枚图标读作一组。
			className="mr-1"
			title={title}
			aria-label={title}
			onClick={onNewChat}
		>
			<span className="icon-[solar--pen-new-square-linear] h-4 w-4" />
		</Button>
	);
}
