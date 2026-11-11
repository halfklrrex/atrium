import { Route, Routes } from 'react-router';
import { RequireAuth } from './auth/RequireAuth';
import { AppShell } from './components/AppShell/AppShell';
import { DashboardPage } from './components/dashboard/DashboardPage';
import { ConnectPage } from './pages/connect/ConnectPage';
import { AdminPage } from './pages/admin/AdminPage';
import { BoardPage } from './pages/BoardPage';
import { FeedbackThreadView } from './pages/feedback/FeedbackThreadView';
import { MyFeedbackPage } from './pages/feedback/MyFeedbackPage';
import { FormPage } from './pages/FormPage';
import { HomePage } from './pages/HomePage';
import { InvitePage } from './pages/InvitePage';
import { LoginPage } from './pages/LoginPage';
import { MyWorkPage } from './pages/MyWorkPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PrivacyPage } from './pages/privacy/PrivacyPage';
import { SettingsIndexRoute } from './pages/settings/SettingsIndex';
import { SettingsPage } from './pages/settings/SettingsPage';
import { TrashPage } from './pages/TrashPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { WorkspacesPage } from './pages/WorkspacesPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route element={<RequireAuth />}>
        <Route path="forms/:boardId/:viewId" element={<FormPage />} />
        <Route path="connect" element={<ConnectPage />} />
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="invite/:workspaceId/:inviteId" element={<InvitePage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="admin/inbox" element={<AdminPage tab="inbox" />} />
          <Route path="admin/inbox/:threadId" element={<AdminPage tab="inbox" />} />
          <Route path="feedback" element={<MyFeedbackPage />} />
          <Route path="feedback/:threadId" element={<FeedbackThreadView />} />
          <Route path="settings" element={<SettingsIndexRoute />} />
          <Route path="settings/:tab" element={<SettingsPage />} />
          <Route path="my-work" element={<MyWorkPage />} />
          <Route path="workspaces" element={<WorkspacesPage />} />
          <Route path="workspaces/:workspaceId" element={<WorkspacePage />} />
          <Route path="workspaces/:workspaceId/trash" element={<TrashPage />} />
          <Route path="boards/:boardId" element={<BoardPage />} />
          <Route path="boards/:boardId/items/:itemId" element={<BoardPage />} />
          <Route path="boards/:boardId/views/:viewId" element={<BoardPage />} />
          <Route path="boards/:boardId/views/:viewId/items/:itemId" element={<BoardPage />} />
          <Route path="dashboards/:dashboardId" element={<DashboardPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
