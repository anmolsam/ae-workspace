import type { FollowUpSummary } from '../../lib/types';

interface SummaryCountersProps {
  summary: FollowUpSummary;
}

function Counter({ n, label, tone }: { n: number; label: string; tone?: 'danger' }) {
  return (
    <div className="flex-1 rounded-card border border-line bg-surface px-4 py-3 shadow-card">
      <div
        className={`text-2xl font-semibold tabular-nums ${
          tone === 'danger' && n > 0 ? 'text-danger' : 'text-ink'
        }`}
      >
        {n}
      </div>
      <div className="mt-0.5 text-xs font-medium text-ink-subtle">{label}</div>
    </div>
  );
}

export function SummaryCounters({ summary }: SummaryCountersProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Counter n={summary.dueToday} label="Due Today" />
      <Counter n={summary.overdue} label="Overdue" tone="danger" />
      <Counter n={summary.thisWeek} label="This Week" />
    </div>
  );
}
