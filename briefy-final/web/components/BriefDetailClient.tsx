'use client';

import { useEffect, useState, useCallback } from 'react';
import type { BriefDetail } from '../types/briefy';
import { RefreshButton } from './RefreshButton';
import { OverviewSection } from './sections/OverviewSection';
import { PortfolioSection } from './sections/PortfolioSection';
import { OrgTreeSection } from './sections/OrgTreeSection';
import { RevenueSection } from './sections/RevenueSection';
import { HubspotSignalsSection } from './sections/HubspotSignalsSection';
import { HiringSignalsSection } from './sections/HiringSignalsSection';
import { IntentSection } from './sections/IntentSection';

const POLL_MS = 12_000;
const IN_FLIGHT_STATUSES: BriefDetail['briefStatus'][] = ['Generating', 'Refreshing'];

export function BriefDetailClient({ initialBrief }: { initialBrief: BriefDetail }) {
  const [brief, setBrief] = useState(initialBrief);

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/briefs/${brief.id}`);
    if (res.ok) setBrief(await res.json());
  }, [brief.id]);

  useEffect(() => {
    if (!IN_FLIGHT_STATUSES.includes(brief.briefStatus)) return;
    refetch();
    const interval = setInterval(refetch, POLL_MS);
    return () => clearInterval(interval);
  }, [brief.briefStatus, refetch]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">{brief.companyName}</h1>
          <p className="text-sm text-neutral-500">
            {brief.dealName} · {new Date(brief.meetingDateTime).toLocaleString()}
          </p>
        </div>
        <RefreshButton
          briefId={brief.id}
          briefStatus={brief.briefStatus}
          onRefreshed={() => setBrief(b => ({ ...b, briefStatus: 'Refreshing' }))}
        />
      </header>
      {IN_FLIGHT_STATUSES.includes(brief.briefStatus) && (
        <p className="mb-4 text-sm text-status-pending">
          {brief.briefStatus === 'Refreshing' ? 'Refreshing…' : 'Generating…'}
        </p>
      )}
      <div className="flex flex-col gap-4">
        <OverviewSection brief={brief} />
        <PortfolioSection brief={brief} />
        <OrgTreeSection brief={brief} />
        <RevenueSection brief={brief} />
        <HubspotSignalsSection brief={brief} />
        <HiringSignalsSection brief={brief} />
        <IntentSection brief={brief} />
      </div>
    </main>
  );
}
