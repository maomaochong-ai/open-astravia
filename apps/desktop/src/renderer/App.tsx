import { CloudAuthBoot } from "@shared/components/cloud-slots";
import { RootLayoutView } from "./root-layout/RootLayoutView";
import { useRootLayoutModel } from "./root-layout/useRootLayoutModel";

export function RootLayout(): JSX.Element {
	const model = useRootLayoutModel();
	return (
		<>
			{/* 云会话生命周期：全树只挂这一处；lite 构建渲染 null */}
			<CloudAuthBoot />
			<RootLayoutView model={model} />
		</>
	);
}
