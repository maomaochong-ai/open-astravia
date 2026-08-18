import type { ReactNode } from "react";
import { SubscriptionCardsView } from "./SubscriptionCardsView";
import { useSubscriptionCardsModel } from "./useSubscriptionCardsModel";

export function SubscriptionCards({
	beforeWindows,
	children,
}: {
	beforeWindows?: ReactNode;
	children?: ReactNode;
}): JSX.Element | null {
	const model = useSubscriptionCardsModel();
	return (
		<SubscriptionCardsView model={model} beforeWindows={beforeWindows}>
			{children}
		</SubscriptionCardsView>
	);
}
