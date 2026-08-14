import ReactDOM from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { getRouter } from './router'
import { startAppearance } from './lib/appearance'

// Before the first render, not in an effect: an author who writes on paper
// should never see the dark ground flash past on the way to it.
startAppearance()

const router = getRouter()

const rootElement = document.getElementById('app')!

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(<RouterProvider router={router} />)
}
