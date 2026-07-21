import { useMemo } from 'react';
import { useMe } from '../hooks/useMe';
import { useFollowUps } from '../hooks/useFollowUps';
import { useFightScore, useFunnel } from '../hooks/useRoma';
import { greeting } from '../lib/format';
import type { FollowUp } from '../lib/types';
import { CompactFollowUpRow } from '../components/taskee/CompactFollowUpRow';
import { CollapsibleSection } from '../components/taskee/CollapsibleSection';
import { FightScoreCard } from '../components/taskee/FightScoreCard';
import { FunnelCard } from '../components/taskee/FunnelCard';
import { ErrorState } from '../components/ui/ErrorState';
import { Skeleton } from '../components/ui/Skeleton';

interface Groups {
  overdue: FollowUp[];
  today: FollowUp[];
  tomorrow: FollowUp[];
  week: FollowUp[];
}

function groupFollowUps(items: FollowUp[]): Groups {
  const g: Groups = { overdue: [], today: [], tomorrow: [], week: [] };
  for (const fu of items) {
    if (fu.bucket === 'overdue') g.overdue.push(fu);
    else if (fu.bucket === 'today') g.today.push(fu);
    else if (fu.bucket === 'tomorrow') g.tomorrow.push(fu);
    else g.week.push(fu);
  }
  return g;
}

/** Compact inline stat chip for the header summary. */
function Stat({ n, label, danger }: { n: number; label: string; danger?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5">
      <span className={`text-lg font-semibold tabular-nums ${danger && n > 0 ? 'text-danger' : 'text-ink'}`}>{n}</span>
      <span className="text-xs font-medium text-ink-subtle">{label}</span>
    </div>
  );
}

export function TaskeePage() {
  const { data: me } = useMe();
  const followUps = useFollowUps();
  const funnel = useFunnel();
  const fightScore = useFightScore();

  const groups = useMemo(
    () => (followUps.data ? groupFollowUps(followUps.data.followUps) : null),
    [followUps.data],
  );

  const aeName = me?.aeName ?? 'there';
  const total = followUps.data?.followUps.length ?? 0;
  const firstLoad = followUps.loading && !followUps.data;
  const summary = followUps.data?.summary;

  const rowProps = (fu: FollowUp) => ({
    key: fu.id,
    followUp: fu,
    pending: followUps.pendingIds.has(fu.id),
    onCheck: followUps.check,
    onUncheck: followUps.uncheck,
  });

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100dvh-8rem)]">
      {/* Header + summary — compact, single glance */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-ink">{greeting()}, {aeName}</h1>
          <p className="text-xs text-ink-muted">Here’s what needs your attention today.</p>
        </div>
        {summary && (
          <div className="flex gap-2">
            <Stat n={summary.dueToday} label="Due Today" />
            <Stat n={summary.overdue} label="Overdue" danger />
            <Stat n={summary.thisWeek} label="This Week" />
          </div>
        )}
      </div>

      {/* Main: follow-ups (left) + ROMA always-visible (right). Fills the screen. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Follow-ups — internal scroll so the page itself never scrolls */}
        <div className="flex min-h-0 flex-col gap-3 lg:col-span-2 lg:overflow-y-auto lg:pr-1">
          {firstLoad && (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-md" />)}
            </div>
          )}

          {!firstLoad && followUps.error && (
            <ErrorState message="We couldn’t load your follow-ups." onRetry={() => void followUps.refetch()} />
          )}

          {!firstLoad && !followUps.error && groups && (
            <>
              {/* TODAY — always on top, always open */}
              <section className="rounded-card border border-line bg-surface">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-ink">Today</h2>
                  <span className="rounded-full bg-accent-soft px-1.5 text-xs font-medium tabular-nums text-accent">
                    {groups.today.length}
                  </span>
                </div>
                <div className="space-y-1.5 border-t border-line px-2 pb-2 pt-2">
                  {groups.today.length > 0 ? (
                    groups.today.map((fu) => <CompactFollowUpRow {...rowProps(fu)} />)
                  ) : (
                    <p className="px-1 py-4 text-center text-sm text-ink-subtle">
                      {total > 0 ? 'Nothing due today — you’re ahead.' : 'You’re all caught up.'}
                    </p>
                  )}
                </div>
              </section>

              {/* Everything else — dropdowns. Overdue opens by default (it matters). */}
              {groups.overdue.length > 0 && (
                <CollapsibleSection title="Overdue" count={groups.overdue.length} danger defaultOpen>
                  {groups.overdue.map((fu) => <CompactFollowUpRow {...rowProps(fu)} />)}
                </CollapsibleSection>
              )}
              {groups.tomorrow.length > 0 && (
                <CollapsibleSection title="Tomorrow" count={groups.tomorrow.length}>
                  {groups.tomorrow.map((fu) => <CompactFollowUpRow {...rowProps(fu)} />)}
                </CollapsibleSection>
              )}
              {groups.week.length > 0 && (
                <CollapsibleSection title="This Week" count={groups.week.length}>
                  {groups.week.map((fu) => <CompactFollowUpRow {...rowProps(fu)} />)}
                </CollapsibleSection>
              )}
            </>
          )}
        </div>

        {/* ROMA — always visible */}
        <div className="flex min-h-0 flex-col gap-3 lg:overflow-y-auto">
          <FightScoreCard data={fightScore.data} loading={fightScore.loading} error={fightScore.error} onRetry={fightScore.refetch} />
          <FunnelCard data={funnel.data} loading={funnel.loading} error={funnel.error} onRetry={funnel.refetch} />
        </div>
      </div>
    </div>
  );
}
