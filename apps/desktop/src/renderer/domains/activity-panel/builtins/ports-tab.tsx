import { useTranslation } from "react-i18next";
import { PortsTabPanel } from "../components/PortsTabPanel";
import { useActivityWorkspace } from "../registry/context";
import type { ActivityTabDefinition } from "../registry/types";
import { useRemoteProjectHostId, useSshPortForwards } from "../hooks/useSshPortForwards";

function PortsActivityTab(): JSX.Element {
	return <PortsTabPanel />;
}

export const portsTabDefinition: ActivityTabDefinition = {
	id: "ports",
	order: 25,
	removable: true,
	source: "builtin",
	useMeta: () => {
		const { t } = useTranslation("chat");
		const workspace = useActivityWorkspace();
		const hostId = useRemoteProjectHostId(workspace.cwd);
		const forwards = useSshPortForwards(hostId);
		// 本机项目没有「远端端口」这回事，整个 tab 不上栏；远程项目下始终在，因为它同时是
		// 手动添加端口的入口——没有转发时也需要它。
		if (!hostId) return null;
		return {
			label: t("activityPanel.tabs.ports"),
			icon: "icon-[solar--link-round-linear]",
			badge: forwards.length || undefined,
		};
	},
	component: PortsActivityTab,
};
