import { atom } from "jotai";

/** Sticky for the renderer lifetime, including subsequent route transitions. */
export const initialRoutePaintedAtom = atom(false);
