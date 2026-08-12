import { SidebarTopBar as ThemeSidebarTopBar } from "@vetta/theme-ui/sidebar";
import { useTranslation } from "react-i18next";

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

/** Desktop adapter: 只做 i18n 文案注入。 */
export function SidebarTopBar({ className, classNames, floating, onCollapse }: SidebarTopBarProps): JSX.Element {
	const { t } = useTranslation("project");

	return (
		<ThemeSidebarTopBar
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
