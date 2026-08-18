export type MessageCenterTab = "all" | "notifications";

export type MessageCenterTabConfig = {
	value: MessageCenterTab;
	icon: string;
};

export const MESSAGE_CENTER_TABS: MessageCenterTabConfig[] = [
	{ value: "all", icon: "icon-[solar--inbox-linear]" },
	{ value: "notifications", icon: "icon-[solar--bell-linear]" },
];

export const MESSAGE_CENTER_SPRING = { type: "spring" as const, stiffness: 420, damping: 32 };
