import { ToasterView } from "@vetta/theme-ui/overlays";
import { useToasterModel } from "../../hooks/useToasterModel";

export function Toaster(): JSX.Element {
	return <ToasterView {...useToasterModel()} />;
}
