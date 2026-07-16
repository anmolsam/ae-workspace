import { useAuth } from '../auth/AuthProvider';
import type { AuthErrorKind } from '../lib/api';

const COPY: Record<string, { title: string; body: string }> = {
  no_matching_ae: {
    title: 'Your Google account isn’t a mapped AE',
    body: 'We couldn’t match your account to an Account Executive in the system. Ask your admin to map your email, then try again.',
  },
  domain_not_allowed: {
    title: 'This workspace is restricted',
    body: 'Your Google account’s domain isn’t allowed to access AE Workspace. Sign in with your company account.',
  },
};

export function AccessDeniedScreen({ kind }: { kind: AuthErrorKind }) {
  const { signOut } = useAuth();
  const copy = COPY[kind] ?? {
    title: 'Access denied',
    body: 'Your account doesn’t have access to this workspace.',
  };

  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="w-full max-w-md rounded-card border border-line bg-surface p-8 text-center shadow-card">
        <h1 className="text-lg font-semibold tracking-tight text-ink">{copy.title}</h1>
        <p className="mt-2 text-sm text-ink-muted">{copy.body}</p>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-6 rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas"
        >
          Sign in with a different account
        </button>
      </div>
    </div>
  );
}
