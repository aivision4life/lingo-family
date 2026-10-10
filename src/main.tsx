import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import "@fontsource/noto-sans-kr/400.css";
import "@fontsource/noto-sans-kr/700.css";
import "./i18n";
import "./index.css";
import { ProfileProvider } from "./features/profiles/ProfileProvider";
import { ConnectionBanner } from "./features/pwa/ConnectionBanner";
import { initInstallPrompt } from "./features/pwa/installPrompt";
import { UpdateBanner } from "./features/pwa/UpdateBanner";
import { followSystemTheme } from "./lib/theme";
import { router } from "./router";

followSystemTheme();
initInstallPrompt();

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ProfileProvider>
        <RouterProvider router={router} />
        <ConnectionBanner />
        {/* The service worker exists only in the production build; `npm run dev` never registers one. */}
        {import.meta.env.PROD && <UpdateBanner />}
      </ProfileProvider>
    </QueryClientProvider>
  </StrictMode>,
);
