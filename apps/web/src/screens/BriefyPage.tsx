import { useMemo } from 'react';
import { useMeetings } from '../hooks/useMeetings';
import type { Meeting } from '../lib/types';
import { CompactMeetingRow } from '../components/briefy/CompactMeetingRow';
import { CollapsibleSection } from '../components/taskee/CollapsibleSection';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { Skeleton } from '../components/ui/Skeleton';

interface Groups {
  doneThisWeek: Meeting[]; // this week, already happened (most recent first)
  thisWeek: Meeting[];     // this week, upcoming (soonest first)
  later: Meeting[];        // after this week (soonest first)
  earlier: Meeting[];      // before this week (most recent first)
}

function startOfWeek(now: Date): number {
  const d = new Date(now);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}

function groupMeetings(meetings: Meeting[], now = new Date()): Groups {
  const weekStart = startOfWeek(now);
  const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000;
  const nowMs = now.getTime();
  const g: Groups = { doneThisWeek: [], thisWeek: [], later: [], earlier: [] };
  for (const m of meetings) {
    const t = m.startsAt ? new Date(m.startsAt).getTime() : NaN;
    if (Number.isNaN(t)) { g.earlier.push(m); continue; }
    if (t >= weekStart && t < weekEnd) {
      (t < nowMs ? g.doneThisWeek : g.thisWeek).push(m); // split this week at "now"
    } else if (t >= weekEnd) g.later.push(m);
    else g.earlier.push(m);
  }
  const asc = (a: Meeting, b: Meeting) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
  const desc = (a: Meeting, b: Meeting) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime();
  g.thisWeek.sort(asc);          // next upcoming first
  g.later.sort(asc);
  g.doneThisWeek.sort(desc);     // most recently completed first
  return g;
}

export function BriefyPage() {
  const { data, loading, error, refetch } = useMeetings();
  const firstLoad = loading && !data;
  const groups = useMemo(
    () => (data?.meetings ? groupMeetings(data.meetings) : null),
    [data?.meetings],
  );

  const row = (m: Meeting) => <CompactMeetingRow key={m.id} meeting={m} onGenerated={refetch} />;

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100dvh-8rem)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-ink">Briefy</h1>
          <p className="text-xs text-ink-muted">Pre-call briefs for your meetings.</p>
        </div>
        {groups && (
          <div className="flex items-baseline gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5">
            <span className="text-lg font-semibold tabular-nums text-ink">{groups.thisWeek.length}</span>
            <span className="text-xs font-medium text-ink-subtle">This Week</span>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:overflow-y-auto lg:pr-1">
        {firstLoad && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-md" />)}
          </div>
        )}

        {!firstLoad && error && <ErrorState message="We couldn’t load your meetings." onRetry={refetch} />}

        {!firstLoad && !error && data && !data.calendarConnected && (
          <EmptyState
            title="Connect Google Calendar to see upcoming meetings"
            description="Once connected, your meetings and their pre-call briefs will appear here."
          />
        )}

        {!firstLoad && !error && data?.calendarConnected && groups && (
          <>
            {/* THIS WEEK — always on top, always open */}
            <section className="rounded-card border border-line bg-surface">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-ink">This Week</h2>
                <span className="rounded-full bg-accent-soft px-1.5 text-xs font-medium tabular-nums text-accent">
                  {groups.thisWeek.length}
                </span>
              </div>
              <div className="space-y-1.5 border-t border-line px-2 pb-2 pt-2">
                {groups.thisWeek.length > 0 ? (
                  groups.thisWeek.map(row)
                ) : (
                  <p className="px-1 py-4 text-center text-sm text-ink-subtle">No meetings this week.</p>
                )}
              </div>
            </section>

            {groups.doneThisWeek.length > 0 && (
              <CollapsibleSection title="Done this week" count={groups.doneThisWeek.length}>
                {groups.doneThisWeek.map(row)}
              </CollapsibleSection>
            )}
            {groups.later.length > 0 && (
              <CollapsibleSection title="Upcoming" count={groups.later.length}>
                {groups.later.map(row)}
              </CollapsibleSection>
            )}
            {groups.earlier.length > 0 && (
              <CollapsibleSection title="Earlier Meetings" count={groups.earlier.length}>
                {groups.earlier.map(row)}
              </CollapsibleSection>
            )}
          </>
        )}
      </div>
    </div>
  );
}
