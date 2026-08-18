import { PetSettingsView } from "./PetSettingsView";
import { usePetSettingsModel } from "./usePetSettingsModel";

export function PetSettings(): JSX.Element {
	const model = usePetSettingsModel();
	return <PetSettingsView model={model} />;
}
