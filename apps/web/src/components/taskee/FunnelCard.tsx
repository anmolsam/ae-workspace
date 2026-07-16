import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { Skeleton } from '../ui/Skeleton';
import type { FunnelResponse } from '../../lib/types';

interface FunnelCardProps {
  data: FunnelResponse | null;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function FunnelCard({ data, loading, error, onRetry }: FunnelCardProps) {
  const maxCount = data
    ? Math.max(1, ...data.stages.map((s) => s.count))
    : 1;

  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
        Your Funnel
      </h3>

      {loading && (
        <div className="mt-4 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {!loading && error && <ErrorState className="mt-4 border-0 py-6" onRetry={onRetry} />}

      {!loading && !error && (!data || data.stages.length === 0) && (
        <EmptyState className="mt-4 border-0 py-6" title="No funnel data yet" />
      )}

      {!loading && !error && data && data.stages.length > 0 && (
        <>
          <ol className="mt-4 space-y-2">
            {data.stages.map((stage) => {
              const width = Math.max(8, Math.round((stage.count / maxCount) * 100));
              return (
                <li key={stage.key}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium text-ink">{stage.label}</span>
                    <span className="tabular-nums text-ink">{stage.count}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-canvas">
                    <div
                      className="h-full rounded-full bg-accent/70"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                  <div className="mt-1 text-xs text-ink-subtle">
                    {stage.pct !== null ? `${stage.pct}% ${stage.basisLabel}` : stage.basisLabel}
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="mt-4 text-xs text-ink-subtle">from ROMA</p>
        </>
      )}
    </section>
  );
}
