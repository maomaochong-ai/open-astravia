import { QueueCardView } from "@vetta/theme-ui/chat";
import { useQueueCardModel } from "@domains/chat/hooks/useQueueCardModel";

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
			paused={model.paused}
		/>
	);
}
