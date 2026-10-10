// Captures the browser's "install app" prompt (`beforeinstallprompt`, Android Chrome and desktop
// Chrome/Edge). The event can fire before Settings is open, so it is listened for from startup
// (initInstallPrompt in main.tsx) and kept until the user installs.
import { useSyncExternalStore } from "react";
import { installMode, isIos, isStandalone, type InstallMode } from "./platform";

type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: InstallPromptEvent | null = null;
let installed = false;
let version = 0; // changes on every update, so useSyncExternalStore sees a new snapshot
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

export function initInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep it for our own button
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
}

/** Shows the browser's install dialog. Resolves with the user's choice (null: nothing to show). */
export async function promptInstall(): Promise<"accepted" | "dismissed" | null> {
  const event = deferred;
  if (!event) return null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  deferred = null; // a prompt can be used only once
  emit();
  return outcome;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function currentMode(): InstallMode {
  return installMode({
    standalone:
      installed ||
      isStandalone({
        displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
        navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
      }),
    hasPrompt: deferred !== null,
    ios: isIos(navigator),
  });
}

export function useInstallMode(): InstallMode {
  useSyncExternalStore(subscribe, () => version);
  return currentMode();
}
