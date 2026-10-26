import { Route, Routes } from 'react-router';
import { RequireAuth } from './auth/RequireAuth';
import { AppShell } from './components/AppShell/AppShell';
import { BoardPage } from './pages/BoardPage';
import { HomePage } from './pages/HomePage';
import { InvitePage } from './pages/InvitePage';
import { LoginPage } from './pages/LoginPage';
import { MyWorkPage } from './pages/MyWorkPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { TrashPage } from './pages/TrashPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { WorkspacesPage } from './pages/WorkspacesPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="invite/:workspaceId/:inviteId" element={<InvitePage />} />
          <Route path="my-work" element={<MyWorkPage />} />
          <Route path="workspaces" element={<WorkspacesPage />} />
          <Route path="workspaces/:workspaceId" element={<WorkspacePage />} />
          <Route path="workspaces/:workspaceId/trash" element={<TrashPage />} />
          <Route path="boards/:boardId" element={<BoardPage />} />
          <Route path="boards/:boardId/items/:itemId" element={<BoardPage />} />
          <Route path="boards/:boardId/views/:viewId" element={<BoardPage />} />
          <Route path="boards/:boardId/views/:viewId/items/:itemId" element={<BoardPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
