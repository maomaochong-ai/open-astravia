import type { NotificationVO } from "@shared/lib/api";
import { atom } from "jotai";

export const notificationsAtom = atom<NotificationVO[]>([]);
export const notificationUnreadAtom = atom<number>(0);
