import type { DeployMode } from "@shared/lib/api";
import { atom } from "jotai";

export const deployModeAtom = atom<DeployMode>("enterprise");
export const isPersonalModeAtom = atom((get) => get(deployModeAtom) === "personal");
