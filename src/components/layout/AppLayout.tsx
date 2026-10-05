import { Outlet } from "react-router";
import { BottomNav } from "./BottomNav";
import { TopBar } from "./TopBar";

/** Shell for every screen after the profile picker: top bar, page content, bottom nav. */
export function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />
      <main className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
