import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/fira-code/300.css'
import '@fontsource/fira-code/400.css'
import '@fontsource/fira-code/600.css'
import './styles/base.css'
import './styles/app.css'
import App from './App'
import { WorkspaceProvider } from './lib/workspace'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkspaceProvider>
      <App />
    </WorkspaceProvider>
  </StrictMode>,
)
