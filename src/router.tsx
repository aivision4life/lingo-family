import { createBrowserRouter } from "react-router";
import { AppLayout, FocusLayout } from "@/components/layout/AppLayout";
import { RequireProfile, RootRedirect } from "@/features/profiles/guards";
import { AddWordPage } from "@/pages/AddWordPage";
import { CharacterPage } from "@/pages/CharacterPage";
import { HomePage } from "@/pages/HomePage";
import { PracticePage } from "@/pages/PracticePage";
import { ProfileEditorPage } from "@/pages/ProfileEditorPage";
import { ProfilePickerPage } from "@/pages/ProfilePickerPage";
import { ReviewPage } from "@/pages/ReviewPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { DecksPage, NotFoundPage, StatsPage } from "@/pages/SimplePages";
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
      { element: <FocusLayout />, children: [{ path: "review", element: <ReviewPage /> }] }, // 3
      {
        element: <AppLayout />,
        children: [
          { path: "home", element: <HomePage /> }, // 2
          { path: "words", element: <WordLibraryPage /> }, // 4
          { path: "words/new", element: <AddWordPage /> }, // 5
          { path: "words/:id", element: <WordDetailPage /> }, // 6
          { path: "practice/:wordId?", element: <PracticePage /> }, // 7
          { path: "chars/:char", element: <CharacterPage /> }, // 8
          { path: "decks", element: <DecksPage /> }, // 9
          { path: "settings", element: <SettingsPage /> }, // 10
          { path: "stats", element: <StatsPage /> }, // 11
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
