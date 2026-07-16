import { useMemo } from 'react';
import { useMe } from '../hooks/useMe';
import { useFollowUps } from '../hooks/useFollowUps';
import { useFightScore, useFunnel } from '../hooks/useRoma';
import { greeting } from '../lib/format';
import type { FollowUp } from '../lib/types';
import { SummaryCounters } from '../components/taskee/SummaryCounters';
import { FollowUpGroup } from '../components/taskee/FollowUpGroup';
import { FightScoreCard } from '../components/taskee/FightScoreCard';
import { FunnelCard } from '../components/taskee/FunnelCard';
import { EmptyState } from '../components/ui/EmptyState';
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
    switch (fu.bucket) {
      case 'overdue':
        g.overdue.push(fu);
        break;
      case 'today':
        g.today.push(fu);
        break;
      case 'tomorrow':
        g.tomorrow.push(fu);
        break;
      default:
        g.week.push(fu);
    }
  }
  return g;
}

function TaskeeSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="flex gap-3">
            <Skeleton className="h-5 w-5 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        </div>
      ))}
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

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {greeting()}, {aeName}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Here’s what needs your attention this week.
        </p>
      </header>

      {followUps.data && <SummaryCounters summary={followUps.data.summary} />}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-subtle">
          Your Follow-ups
        </h2>

        {firstLoad && <TaskeeSkeleton />}

        {!firstLoad && followUps.error && (
          <ErrorState
            message="We couldn’t load your follow-ups."
            onRetry={() => void followUps.refetch()}
          />
        )}

        {!firstLoad && !followUps.error && total === 0 && (
          <EmptyState
            title="You’re all caught up"
            description="No follow-ups need your attention right now."
          />
        )}

        {!firstLoad && !followUps.error && groups && total > 0 && (
          <div className="space-y-6">
            <FollowUpGroup
              title="Overdue"
              items={groups.overdue}
              pendingIds={followUps.pendingIds}
              onCheck={followUps.check}
              onUncheck={followUps.uncheck}
              danger
            />
            <FollowUpGroup
              title="Today"
              items={groups.today}
              pendingIds={followUps.pendingIds}
              onCheck={followUps.check}
              onUncheck={followUps.uncheck}
            />
            <FollowUpGroup
              title="Tomorrow"
              items={groups.tomorrow}
              pendingIds={followUps.pendingIds}
              onCheck={followUps.check}
              onUncheck={followUps.uncheck}
            />
            <FollowUpGroup
              title="This Week"
              items={groups.week}
              pendingIds={followUps.pendingIds}
              onCheck={followUps.check}
              onUncheck={followUps.uncheck}
            />
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FightScoreCard
          data={fightScore.data}
          loading={fightScore.loading}
          error={fightScore.error}
          onRetry={fightScore.refetch}
        />
        <FunnelCard
          data={funnel.data}
          loading={funnel.loading}
          error={funnel.error}
          onRetry={funnel.refetch}
        />
      </section>
    </div>
  );
}
