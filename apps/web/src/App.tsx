import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { AppLayout } from './components/layout/AppLayout';
import { LoginScreen } from './screens/LoginScreen';
import { AccessDeniedScreen } from './screens/AccessDeniedScreen';
import { TaskeePage } from './screens/TaskeePage';
import { BriefyPage } from './screens/BriefyPage';
import { RevyPage } from './screens/RevyPage';
import { Skeleton } from './components/ui/Skeleton';

function BootScreen() {
  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}

export function App() {
  const { session, loading, accessError } = useAuth();

  if (loading) return <BootScreen />;
  if (!session) return <LoginScreen />;
  if (accessError) return <AccessDeniedScreen kind={accessError} />;

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/taskee" element={<TaskeePage />} />
        <Route path="/briefy" element={<BriefyPage />} />
        <Route path="/revy" element={<RevyPage />} />
        <Route path="*" element={<Navigate to="/taskee" replace />} />
      </Route>
    </Routes>
  );
}
