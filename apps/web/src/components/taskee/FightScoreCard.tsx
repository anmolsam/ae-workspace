import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { Skeleton } from '../ui/Skeleton';
import type { FightScoreResponse } from '../../lib/types';

interface FightScoreCardProps {
  data: FightScoreResponse | null;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-sm font-semibold text-ink">{value}</div>
      <div className="text-xs text-ink-subtle">{label}</div>
    </div>
  );
}

export function FightScoreCard({ data, loading, error, onRetry }: FightScoreCardProps) {
  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          Fight Score
        </h3>
        {data?.team && <Badge tone="neutral">{data.team}</Badge>}
      </div>

      {loading && (
        <div className="mt-4 space-y-4">
          <Skeleton className="h-12 w-24" />
          <div className="flex gap-6">
            <Skeleton className="h-8 w-12" />
            <Skeleton className="h-8 w-12" />
            <Skeleton className="h-8 w-12" />
          </div>
        </div>
      )}

      {!loading && error && (
        <ErrorState className="mt-4 border-0 py-6" onRetry={onRetry} />
      )}

      {!loading && !error && !data && (
        <EmptyState className="mt-4 border-0 py-6" title="No Fight Score yet" />
      )}

      {!loading && !error && data && (
        <>
          <div className="mt-4 flex items-baseline gap-1">
            <span className="text-4xl font-bold tracking-tight text-ink">{data.score}</span>
            <span className="text-base text-ink-subtle">/100</span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-4">
            <Stat label="Deals" value={data.deals} />
            <Stat label="Known" value={data.known} />
            <Stat label="Done" value={data.done} />
          </div>
          <p className="mt-4 text-xs text-ink-subtle">{data.period ?? 'from ROMA'}</p>
        </>
      )}
    </section>
  );
}
