import { PortsTabPanelView } from "@vetta-org/theme-ui/activity";
import { usePortsTabPanelModel } from "../hooks/usePortsTabPanelModel";

/**
 * 端口面板：远程项目里把远端的服务接到本机来看。只在远程项目下上栏（见 ports-tab.tsx）。
 */
export function PortsTabPanel(): JSX.Element {
	const model = usePortsTabPanelModel();
	return <PortsTabPanelView {...model} />;
}
