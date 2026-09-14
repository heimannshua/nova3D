import { BrowserRouter } from 'react-router-dom'
import { WorkspaceProvider } from '@/store/workspace'
import { AppRoutes } from '@/routes'

export default function App() {
  return (
    <WorkspaceProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </WorkspaceProvider>
  )
}
