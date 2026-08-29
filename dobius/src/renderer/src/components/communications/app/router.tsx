import { createMemoryHistory, createRouter } from "@tanstack/react-router";

import { routeTree } from "@comms/app/routeTree.gen";

// Memory history, not hash: this router is mounted inside the Communications
// tab of the Dobius+ window, and hash history would claim window.location.hash
// globally and fight the app's own routes (the voice orb uses #/orb).
export const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ["/"] }),
  scrollRestoration: true,
  getScrollRestorationKey: (location: { pathname: string }) =>
    location.pathname,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
