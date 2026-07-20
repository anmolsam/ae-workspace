import { SectionPanel } from '../SectionPanel';
import type { BriefDetail } from '../../types/briefy';

export function HubspotSignalsSection({ brief }: { brief: BriefDetail }) {
  return (
    <SectionPanel title="HubSpot Signals" status={brief.sectionStatus.hubspotSignals}>
      <p className="text-sm text-neutral-700">
        Last page visited: {brief.lastPageVisited || 'Unknown'}
        {brief.lastPageVisitedAt ? ` (${new Date(brief.lastPageVisitedAt).toLocaleString()})` : ''}
      </p>
      {brief.priorDeals.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Prior Deals</p>
          <ul className="space-y-1 text-sm text-neutral-700">
            {brief.priorDeals.map((d, i) => (
              <li key={i}>
                <a href={d.dealLink} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                  {d.dealName}
                </a>{' '}
                — {d.dealOwner}
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionPanel>
  );
}
