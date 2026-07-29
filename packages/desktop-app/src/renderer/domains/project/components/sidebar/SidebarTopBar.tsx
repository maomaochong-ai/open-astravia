import { SidebarTopBar as ThemeSidebarTopBar } from "@vetta/theme-ui/sidebar";
import { useTranslation } from "react-i18next";
import { AgentModeBadgeDropdown } from "./AgentModeBadgeDropdown";
import { SidebarUpdateButton } from "./update/SidebarUpdateButton";

interface SidebarTopBarProps {
	className?: string;
	classNames?: {
		actions?: string;
		brand?: string;
		collapseButton?: string;
	};
	floating: boolean;
	onCollapse?: () => void;
}

/** Desktop adapter: i18n + connected update button slot + 工作模式徽章 popover。 */
export function SidebarTopBar({ className, classNames, floating, onCollapse }: SidebarTopBarProps): JSX.Element {
	const { t } = useTranslation("project");

	return (
		<ThemeSidebarTopBar
			agentModeSlot={<AgentModeBadgeDropdown />}
			brandTrailing={<SidebarUpdateButton />}
			className={className}
			classNames={classNames}
			floating={floating}
			labels={{
				hide: t("sidebar.hide"),
			}}
			onCollapse={onCollapse}
		/>
	);
}
