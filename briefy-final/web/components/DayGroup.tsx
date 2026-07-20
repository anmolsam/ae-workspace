import type { MeetingSummary } from '../types/briefy';
import { MeetingListItem } from './MeetingListItem';

export function DayGroup({ label, meetings }: { label: string; meetings: MeetingSummary[] }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">{label}</h2>
      {meetings.length === 0 ? (
        <p className="text-sm text-neutral-400">No meetings</p>
      ) : (
        <div className="flex flex-col gap-2">
          {meetings.map(m => (
            <MeetingListItem key={m.id} meeting={m} />
          ))}
        </div>
      )}
    </section>
  );
}
