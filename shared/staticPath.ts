/**
 * Whether a path is one the browser expects a *file* at: its last segment has an extension.
 *
 * The Worker answers 404 for these and `index.html` for everything else (M7.4, `worker/app.ts`),
 * which is what makes a missing stylesheet a missing stylesheet instead of an HTML page pretending
 * to be one. A deliberate shape test, never a list of asset folders or app routes: a list has to be
 * updated every time one is added, and the once it is forgotten the app loses navigation. Every
 * route of this app has no extension by construction ("/topik/tests/:id", "/words/new"), and every
 * built file has one.
 */
export const isStaticFilePath = (pathname: string) => /\/[^/]+\.[a-z0-9]+$/i.test(pathname);
