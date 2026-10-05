import { createBrowserRouter } from "react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { CharacterPage } from "@/pages/CharacterPage";
import { HomePage } from "@/pages/HomePage";
import { PracticePage } from "@/pages/PracticePage";
import { ProfilePickerPage } from "@/pages/ProfilePickerPage";
import { ReviewPage } from "@/pages/ReviewPage";
import { DecksPage, NotFoundPage, SettingsPage, StatsPage } from "@/pages/SimplePages";
import { WordDetailPage } from "@/pages/WordDetailPage";
import { WordEditorPage } from "@/pages/WordEditorPage";
import { WordLibraryPage } from "@/pages/WordLibraryPage";

// Screen numbers refer to SPEC §6.
export const router = createBrowserRouter([
  { path: "/", element: <ProfilePickerPage /> }, // 1
  {
    element: <AppLayout />,
    children: [
      { path: "home", element: <HomePage /> }, // 2
      { path: "review", element: <ReviewPage /> }, // 3
      { path: "words", element: <WordLibraryPage /> }, // 4
      { path: "words/new", element: <WordEditorPage /> }, // 5
      { path: "words/:id", element: <WordDetailPage /> }, // 6
      { path: "words/:id/edit", element: <WordEditorPage /> }, // 5
      { path: "practice/:wordId?", element: <PracticePage /> }, // 7
      { path: "chars/:char", element: <CharacterPage /> }, // 8
      { path: "decks", element: <DecksPage /> }, // 9
      { path: "settings", element: <SettingsPage /> }, // 10
      { path: "stats", element: <StatsPage /> }, // 11
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
