/** Follow the OS light/dark preference by toggling the `dark` class used by shadcn/ui. */
export function followSystemTheme(): void {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => document.documentElement.classList.toggle("dark", query.matches);
  apply();
  query.addEventListener("change", apply);
}
