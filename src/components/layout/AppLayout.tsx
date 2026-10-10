import { Outlet } from "react-router";
import { AddWordFab } from "./AddWordFab";
import { BottomNav } from "./BottomNav";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

/**
 * Shell for every screen after the profile picker.
 * Desktop (≥ 768px): collapsible sidebar + content. Phones: top bar, content, bottom tab bar.
 * The review screen uses FocusLayout instead; the profile picker is outside both layouts.
 */
export function AppLayout() {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        {/* Extra bottom space on phones: the tab bar plus the floating "+" must not cover the last row. */}
        <main className="flex-1 pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-8">
          <Outlet />
        </main>
      </div>
      <BottomNav />
      <AddWordFab />
    </div>
  );
}

/** No navigation, for focused screens (review): the page provides its own Exit button. */
export function FocusLayout() {
  return (
    <main className="min-h-dvh pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <Outlet />
    </main>
  );
}
