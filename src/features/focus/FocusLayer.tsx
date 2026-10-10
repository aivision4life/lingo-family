import type { ReactNode } from "react";
import type { UiLang } from "@shared/enums";
import { FocusContext } from "./focusContext";
import type { FocusItem } from "./focusItems";
import { FocusView } from "./FocusView";
import type { FocusRoute } from "./useFocusRoute";

type Props = { items: FocusItem[]; route: FocusRoute; glossLang: UiLang; children: ReactNode };

/** Provides `open` to the items below and renders the Focus view while an item is open. */
export function FocusLayer({ items, route, glossLang, children }: Props) {
  return (
    <FocusContext.Provider value={items.length > 0 ? route.open : null}>
      {children}
      {route.activeIndex >= 0 && <FocusView items={items} index={route.activeIndex} glossLang={glossLang} onChange={route.change} onClose={route.close} />}
    </FocusContext.Provider>
  );
}
