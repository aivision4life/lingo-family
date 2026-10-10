import { createContext, useContext } from "react";

export const FocusContext = createContext<((key: string) => void) | null>(null);

/** The function that opens an item in the Focus view, or null outside a FocusLayer (nothing to open). */
export const useOpenFocus = () => useContext(FocusContext);
