import { ToasterView } from "@vetta-org/theme-ui/overlays/ToasterView";
import { useToasterModel } from "../../hooks/useToasterModel";

export function Toaster(): JSX.Element {
	return <ToasterView {...useToasterModel()} />;
}
