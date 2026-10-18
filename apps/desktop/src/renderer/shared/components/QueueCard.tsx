import { QueueCardView } from "@astravia-org/theme-ui/chat/QueueCardView";
import { useQueueCardModel } from "@domains/conversation/hooks/useQueueCardModel";

interface QueueCardProps {
	runtimeId: string;
	onSendNow: (id: string) => void;
}

export function QueueCard({ runtimeId, onSendNow }: QueueCardProps): JSX.Element {
	const model = useQueueCardModel(runtimeId);

	return (
		<QueueCardView
			items={model.items}
			labels={model.labels}
			onReorder={model.onReorder}
			onSendNow={onSendNow}
			onRemove={model.onRemove}
			onRecall={model.onRecall}
			paused={model.paused}
		/>
	);
}
