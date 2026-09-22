import { activeSessionAtom, promptPredictingAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { AssistantRenderingProvider } from "./message-list/AssistantRendering";

const runtimeIdAtom = selectAtom(activeSessionAtom, (session) => session?.runtimeId ?? null);

export function SessionAssistantRendering({ children }: { children: ReactNode }) {
	const runtimeId = useAtomValue(runtimeIdAtom);
	const prediction = useMemo(
		() => selectAtom(promptPredictingAtom, (map) => (runtimeId ? Boolean(map[runtimeId]) : false)),
		[runtimeId],
	);
	const predicting = useAtomValue(prediction);
	const value = useMemo(() => ({ predicting }), [predicting]);
	return <AssistantRenderingProvider value={value}>{children}</AssistantRenderingProvider>;
}
