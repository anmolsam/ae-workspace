'use client';

import { useEffect, useState } from 'react';
import type { MeetingSummary } from '../types/briefy';
import { groupByDay } from '../lib/briefs';
import { DayGroup } from './DayGroup';

type Groups = ReturnType<typeof groupByDay>;

export function MeetingList({ meetings }: { meetings: MeetingSummary[] }) {
  const [groups, setGroups] = useState<Groups | null>(null);

  useEffect(() => {
    setGroups(groupByDay(meetings, Date.now()));
  }, [meetings]);

  if (!groups) return null;

  return (
    <>
      {groups.map(g => (
        <DayGroup key={g.label} label={g.label} meetings={g.meetings} />
      ))}
    </>
  );
}
