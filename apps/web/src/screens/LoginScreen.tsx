import { useAuth } from '../auth/AuthProvider';

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

export function LoginScreen() {
  const { signInWithGoogle } = useAuth();

  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-8 shadow-card">
        <h1 className="text-lg font-semibold tracking-tight text-ink">AE Workspace</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Sign in with your work Google account to see your follow-ups, briefs, and
          pipeline.
        </p>
        <button
          type="button"
          onClick={() => void signInWithGoogle()}
          className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-md border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-canvas"
        >
          <GoogleGlyph />
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
