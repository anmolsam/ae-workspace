import type { ReactNode } from 'react';
import type { SectionStatusValue } from '../types/briefy';
import { Card } from './ui/card';

const STATUS_LABEL_COLOR: Record<SectionStatusValue, string> = {
  ready: 'text-status-ready',
  pending: 'text-status-pending',
  error: 'text-status-error',
  unavailable: 'text-status-unavailable',
};

export function SectionPanel({
  title,
  status,
  children,
}: {
  title: string;
  status: SectionStatusValue;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium text-neutral-900">{title}</h3>
        <span className={`text-xs font-medium uppercase tracking-wide ${STATUS_LABEL_COLOR[status]}`}>
          {status}
        </span>
      </div>
      {status === 'ready' && children}
      {status === 'pending' && (
        <div data-testid="section-shimmer" className="h-16 animate-pulse rounded-md bg-neutral-100" />
      )}
      {status === 'error' && (
        <p className="text-sm text-neutral-500">
          This section failed to load. It will retry on the next refresh.
        </p>
      )}
      {status === 'unavailable' && <p className="text-sm text-neutral-400">Not available</p>}
    </Card>
  );
}
