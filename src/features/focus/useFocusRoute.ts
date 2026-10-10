import { useLocation, useNavigate, useSearchParams } from "react-router";
import { closeAction, focusKey, indexOfKey, parseFocusKey, withFocus, withoutFocus, type FocusItem } from "./focusItems";

export type FocusRoute = {
  /** Index of the open item in `items`, or -1 when the view is closed. */
  activeIndex: number;
  /** Opens an item: pushes a history entry, so Back closes the view and stays on this screen. */
  open: (key: string) => void;
  /** Moves to another item: replaces the entry, so Back does not step through items. */
  change: (key: string) => void;
  close: () => void;
};

/** The Focus view lives in the URL (`?focus=example:<id>`), so it works with Back and reloads. */
export function useFocusRoute(items: readonly FocusItem[]): FocusRoute {
  const [params] = useSearchParams();
  const { search, state } = useLocation();
  const navigate = useNavigate();
  const wanted = parseFocusKey(params.get("focus"));
  const activeIndex = indexOfKey(items, wanted ? focusKey(wanted.kind, wanted.id) : null);

  return {
    activeIndex,
    open: (key) => void navigate({ search: withFocus(search, key) }, { state: { focusPushed: true } }),
    change: (key) => void navigate({ search: withFocus(search, key) }, { replace: true, state }),
    close: () => {
      if (closeAction(state) === "back") void navigate(-1);
      else void navigate({ search: withoutFocus(search) }, { replace: true, state: null });
    },
  };
}
