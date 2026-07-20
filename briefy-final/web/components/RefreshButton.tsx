'use client';

import { useState } from 'react';
import { Button } from './ui/button';
import type { BriefStatus } from '../types/briefy';

const IN_FLIGHT: BriefStatus[] = ['Generating', 'Refreshing'];

export function RefreshButton({
  briefId,
  briefStatus,
  onRefreshed,
}: {
  briefId: string;
  briefStatus: BriefStatus;
  onRefreshed: () => void;
}) {
  const [pending, setPending] = useState(false);
  const disabled = pending || IN_FLIGHT.includes(briefStatus);

  async function handleClick() {
    setPending(true);
    try {
      const res = await fetch(`/api/briefs/${briefId}/refresh`, { method: 'POST' });
      if (res.ok) onRefreshed();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button onClick={handleClick} disabled={disabled}>
      {IN_FLIGHT.includes(briefStatus) ? 'Refreshing…' : 'Refresh brief'}
    </Button>
  );
}
