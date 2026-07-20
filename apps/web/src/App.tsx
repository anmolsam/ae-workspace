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

  const devBypass = import.meta.env.VITE_DEV_BYPASS === 'true';

  return (
    <>
      {devBypass && (
        <div style={{ background: '#fde68a', color: '#78350f', padding: '6px 16px', textAlign: 'center', fontSize: 12, fontWeight: 500 }}>
          Dev preview - Google sign-in bypassed, showing {import.meta.env.VITE_DEV_EMAIL ?? 'a test AE'}'s data. Not real auth.
        </div>
      )}
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/taskee" element={<TaskeePage />} />
          <Route path="/briefy" element={<BriefyPage />} />
          <Route path="/revy" element={<RevyPage />} />
          <Route path="*" element={<Navigate to="/taskee" replace />} />
        </Route>
      </Routes>
    </>
  );
}
