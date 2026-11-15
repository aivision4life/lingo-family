import { createBrowserRouter } from "react-router";
import { AppLayout, FocusLayout } from "@/components/layout/AppLayout";
import { RequireProfile, RootRedirect } from "@/features/profiles/guards";
import { AlbumPage } from "@/pages/AlbumPage";
import { AddWordPage } from "@/pages/AddWordPage";
import { CharacterPage } from "@/pages/CharacterPage";
import { HomePage } from "@/pages/HomePage";
import { PracticePage } from "@/pages/PracticePage";
import { ProfileEditorPage } from "@/pages/ProfileEditorPage";
import { PronProbePage } from "@/pages/PronProbePage";
import { ProfilePickerPage } from "@/pages/ProfilePickerPage";
import { ReviewPage } from "@/pages/ReviewPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { DecksPage, NotFoundPage, StatsPage } from "@/pages/SimplePages";
import { TopikBlockPickerPage } from "@/pages/TopikBlockPickerPage";
import { TopikTestPage } from "./pages/TopikTestPage";
import { TopikTestPickerPage } from "./pages/TopikTestPickerPage";
import { TopikPracticePage } from "@/pages/TopikPracticePage";
import { WordDetailPage } from "@/pages/WordDetailPage";
import { WordLibraryPage } from "@/pages/WordLibraryPage";

// Screen numbers refer to SPEC §6.
export const router = createBrowserRouter([
  // Opens the last used profile, or the picker if there is none.
  { path: "/", element: <RootRedirect /> },
  { path: "profiles", element: <ProfilePickerPage /> }, // 1
  { path: "profiles/new", element: <ProfileEditorPage /> },
  { path: "profiles/:id/edit", element: <ProfileEditorPage /> },
  {
    element: <RequireProfile />,
    children: [
      // Review hides the navigation to keep the learner focused (only an Exit button).
      {
        element: <FocusLayout />,
        children: [
          { path: "review", element: <ReviewPage /> }, // 3
          { path: "topik/practice", element: <TopikPracticePage /> },
          // A sitting owns the screen the way review does: no nav to wander off into mid-tape.
          { path: "topik/tests/:id", element: <TopikTestPage /> },
        ],
      },
      {
        element: <AppLayout />,
        children: [
          { path: "home", element: <HomePage /> }, // 2
          { path: "words", element: <WordLibraryPage /> }, // 4
          { path: "words/new", element: <AddWordPage /> }, // 5
          { path: "albums/:id", element: <AlbumPage /> }, // 4 (album, or the virtual "Unsorted")
          { path: "words/:id", element: <WordDetailPage /> }, // 6
          { path: "practice/:wordId?", element: <PracticePage /> }, // 7
          // Scaffolding for M3.0 (microphone capture + Azure's raw answer); no link points here.
          { path: "practice/probe", element: <PronProbePage /> },
          { path: "chars/:char", element: <CharacterPage /> }, // 8
          { path: "decks", element: <DecksPage /> }, // 9
          { path: "topik", element: <TopikBlockPickerPage /> },
          // The review/management screen and the audio probe are adult-only tools opened now and
          // then, and they drag the whole question editor in with them: both are loaded on demand
          // so they stay out of the entry chunk, which is near its ceiling
          // (`scripts/viteGuards/buildIntegrity.ts`).
          { path: "topik/manage", lazy: async () => ({ Component: (await import("@/pages/TopikManagePage")).TopikManagePage }) },
          { path: "topik/tests", element: <TopikTestPickerPage /> },
          // Static, so it is ranked above "topik/tests/:id" and never read as a test id.
          // Loaded on demand: it is opened now and then, and the entry chunk is near its ceiling
          // (`scripts/viteGuards/buildIntegrity.ts`).
          {
            path: "topik/tests/history",
            lazy: async () => ({ Component: (await import("./pages/TopikTestHistoryPage")).TopikTestHistoryPage }),
          },
          // Scaffolding for the M6.5 mixed tape; removed once that mode lands.
          {
            path: "topik/tests/audio-probe",
            lazy: async () => ({ Component: (await import("./pages/TopikAudioProbePage")).TopikAudioProbePage }),
          },
          { path: "settings", element: <SettingsPage /> }, // 10
          { path: "stats", element: <StatsPage /> }, // 11
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
