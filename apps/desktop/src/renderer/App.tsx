import { RootLayoutView } from "./root-layout/RootLayoutView";
import { useRootLayoutModel } from "./root-layout/useRootLayoutModel";

export function RootLayout(): JSX.Element {
	const model = useRootLayoutModel();
	return <RootLayoutView model={model} />;
}
