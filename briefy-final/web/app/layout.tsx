import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Briefy',
  description: 'Pre-call briefs for Attentive.ai account executives',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
