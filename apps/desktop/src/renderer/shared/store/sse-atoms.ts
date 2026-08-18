import { createSSEClient, type SSEConnectionState } from "@shared/lib/sse-client";
import { atom } from "jotai";

export const sseClientAtom = atom(createSSEClient());
export const sseConnectionStateAtom = atom<SSEConnectionState>("disconnected");
