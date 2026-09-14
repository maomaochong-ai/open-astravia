import { SubscriptionActionsView } from "@vetta-org/theme-ui/settings";
import { useSubscriptionCardsModel } from "./useSubscriptionCardsModel";

export function SubscriptionActions(): JSX.Element {
	const model = useSubscriptionCardsModel();
	return <SubscriptionActionsView model={model} />;
}
