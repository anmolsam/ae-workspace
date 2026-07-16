import { useMeetings } from '../hooks/useMeetings';
import { MeetingRow } from '../components/briefy/MeetingRow';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { Skeleton } from '../components/ui/Skeleton';

function MeetingsSkeleton() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-card border border-line bg-surface p-4 shadow-card">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="mt-2 h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}

export function BriefyPage() {
  const { data, loading, error, refetch } = useMeetings();
  const firstLoad = loading && !data;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Briefy</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Pre-call briefs for your upcoming meetings.
        </p>
      </header>

      {firstLoad && <MeetingsSkeleton />}

      {!firstLoad && error && (
        <ErrorState
          message="We couldn’t load your meetings."
          onRetry={refetch}
        />
      )}

      {!firstLoad && !error && data && !data.calendarConnected && (
        <EmptyState
          title="Connect Google Calendar to see upcoming meetings"
          description="Once connected, your upcoming meetings and their pre-call briefs will appear here."
        />
      )}

      {!firstLoad && !error && data && data.calendarConnected && data.meetings.length === 0 && (
        <EmptyState
          title="No upcoming meetings"
          description="You have no meetings scheduled. New meetings will show up here automatically."
        />
      )}

      {!firstLoad && !error && data && data.calendarConnected && data.meetings.length > 0 && (
        <div className="space-y-2.5">
          {data.meetings.map((m) => (
            <MeetingRow key={m.id} meeting={m} onGenerated={refetch} />
          ))}
        </div>
      )}
    </div>
  );
}
