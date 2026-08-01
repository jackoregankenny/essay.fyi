import { Outlet, createRootRoute } from '@tanstack/react-router'

import '../styles.css'

export const Route = createRootRoute({
  component: RootComponent,
})

// No devtools overlay: the floating badge sits on top of the writing surface,
// which is exactly where chrome must not be. Re-import
// `@tanstack/react-devtools` here if a debugging session ever needs it.
function RootComponent() {
  return <Outlet />
}
