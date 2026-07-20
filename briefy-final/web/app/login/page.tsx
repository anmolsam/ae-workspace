'use client';

import { Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Button } from '../../components/ui/button';

const ERROR_MESSAGES: Record<string, string> = {
  NotMapped: "You're not set up in Briefy yet — ask an admin to add you to the owner map.",
  AccessDenied: 'Only @attentive.ai Google accounts can sign in to Briefy.',
};

function LoginContent() {
  const params = useSearchParams();
  const error = params.get('error');
  const message = error ? ERROR_MESSAGES[error] ?? 'Sign-in failed — please try again.' : null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-neutral-900">Briefy</h1>
        <p className="mt-1 text-sm text-neutral-500">Pre-call briefs for account executives</p>
      </div>
      {message && (
        <p className="max-w-sm text-center text-sm text-red-600" role="alert">
          {message}
        </p>
      )}
      <Button onClick={() => signIn('google', { callbackUrl: '/meetings' })}>
        Sign in with Google
      </Button>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}
