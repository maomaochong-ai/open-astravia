import { DrawerCard, type DrawerTab } from "@shared/components/DrawerCard";
import { QueueCard } from "@shared/components/QueueCard";
import { TodoCard } from "@shared/components/TodoCard";
import { useThemeComponent } from "@vetta/theme-sdk";
import { memo, useMemo } from "react";
import type { InputBarDrawerItem, InputBarLabels } from "./types";
import { SandboxPermissionCard } from "./SandboxPermissionCard";

interface InputBarDrawerProps {
	activeTabId: string | null;
	items: InputBarDrawerItem[];
	onActiveTabChange: (tabId: string | null) => void;
	permissionLabels: InputBarLabels["permission"];
}

export const InputBarDrawer = memo(function InputBarDrawer({
	activeTabId,
	items,
	onActiveTabChange,
	permissionLabels,
}: InputBarDrawerProps): JSX.Element {
	const ThemedDrawerCard = useThemeComponent("chat.inputDrawer", DrawerCard);
	const tabs = useMemo(
		(): DrawerTab[] =>
			items.map((item) => {
				if (item.kind === "sandbox-permission") {
					return {
						id: item.id,
						label: item.label,
						color: "bg-amber-500",
						desc: item.desc,
						pulsing: item.pulsing,
						content: <SandboxPermissionCard labels={permissionLabels} request={item.request} />,
					};
				}
				if (item.kind === "queue") {
					return {
						id: item.id,
						label: item.label,
						color: "bg-primary",
						desc: item.desc,
						content: <QueueCard runtimeId={item.runtimeId} onSendNow={item.onSendNow} />,
					};
				}
				return {
					id: item.id,
					label: item.label,
					color: "bg-emerald-500",
					desc: item.desc,
					pulsing: item.pulsing,
					content: <TodoCard items={item.items} compact onViewMore={item.onViewMore} />,
				};
			}),
		[items, permissionLabels],
	);

	return <ThemedDrawerCard tabs={tabs} activeTabId={activeTabId} onActiveTabChange={onActiveTabChange} />;
});
