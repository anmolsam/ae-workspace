import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';

const ALLOWED_DOMAIN = 'attentive.ai';

export function LoginScreen() {
  const { signInWithEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const addr = email.trim().toLowerCase();
    if (!addr.endsWith(`@${ALLOWED_DOMAIN}`)) {
      setStatus('error');
      setError(`Please use your @${ALLOWED_DOMAIN} email.`);
      return;
    }
    setStatus('sending');
    setError('');
    try {
      await signInWithEmail(addr);
      setStatus('sent');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Could not send the sign-in link.');
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-8 shadow-card">
        <h1 className="text-lg font-semibold tracking-tight text-ink">AE Workspace</h1>

        {status === 'sent' ? (
          <div className="mt-3">
            <p className="text-sm text-ink-muted">
              Check <span className="font-medium text-ink">{email.trim().toLowerCase()}</span> — we sent a
              secure sign-in link. Open it on this device to continue.
            </p>
            <button
              type="button"
              onClick={() => { setStatus('idle'); setEmail(''); }}
              className="mt-4 text-sm font-medium text-accent hover:underline"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-ink-muted">
              Sign in with your work email to see your follow-ups, briefs, and pipeline.
            </p>
            <form onSubmit={submit} className="mt-6 space-y-3">
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={`you@${ALLOWED_DOMAIN}`}
                className="w-full rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-subtle focus:border-accent"
              />
              {status === 'error' && <p className="text-xs text-danger">{error}</p>}
              <button
                type="submit"
                disabled={status === 'sending'}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {status === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
              </button>
            </form>
            <p className="mt-4 text-xs text-ink-subtle">
              Only @{ALLOWED_DOMAIN} accounts can sign in. No password needed.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
