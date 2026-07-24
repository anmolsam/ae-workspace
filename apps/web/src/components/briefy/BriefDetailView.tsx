import type { Brief, CompanyInfo, OrgTreeContact, SectionStatusValue } from '../../lib/types';

/**
 * Faithful port of briefy-final's brief output (shashank's components/sections
 * + SectionPanel). Same 7 sections, same order, same titles, same empty-state
 * strings, same per-section status chip. Rendered from the BriefDetail fields
 * the API returns inline on the Brief.
 */
const STATUS_COLOR: Record<SectionStatusValue, string> = {
  ready: 'text-emerald-600',
  pending: 'text-amber-600',
  error: 'text-red-600',
  unavailable: 'text-ink-subtle',
};

function SectionPanel({
  title,
  status,
  children,
}: {
  title: string;
  status: SectionStatusValue;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <span className={`text-xs font-medium uppercase tracking-wide ${STATUS_COLOR[status]}`}>{status}</span>
      </div>
      {status === 'ready' && children}
      {status === 'pending' && <div className="h-16 animate-pulse rounded-md bg-canvas" />}
      {status === 'error' && (
        <p className="text-sm text-ink-muted">This section failed to load. It will retry on the next refresh.</p>
      )}
      {status === 'unavailable' && <p className="text-sm text-ink-subtle">Not available</p>}
    </div>
  );
}

function ContactList({ label, contacts }: { label: string; contacts: OrgTreeContact[] }) {
  if (!contacts.length) return null;
  return (
    <div className="mb-3 last:mb-0">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">{label}</p>
      <ul className="space-y-1.5 text-sm text-ink-muted">
        {contacts.map((c, i) => (
          <li key={i}>
            <span className="text-ink">{c.name || 'Unnamed'}</span> — {c.title || 'Unknown title'}
            {(c.email || c.phone || c.linkedin) && (
              <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-ink-subtle">
                {c.email && <a href={`mailto:${c.email}`} className="hover:text-accent">{c.email}</a>}
                {c.phone && <span>{c.phone}</span>}
                {c.linkedin && <a href={c.linkedin} target="_blank" rel="noreferrer" className="hover:text-accent">LinkedIn</a>}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CompanyFacts({ company }: { company?: CompanyInfo | null }) {
  if (!company) return null;
  const facts: Array<[string, string]> = [];
  if (company.employeeCount) facts.push(['Employees', String(company.employeeCount)]);
  if (company.foundedYear) facts.push(['Founded', String(company.foundedYear)]);
  if (company.industry) facts.push(['Industry', company.industry]);
  if (company.location) facts.push(['HQ', company.location]);
  if (company.phone) facts.push(['Phone', company.phone]);
  const website = company.website;
  if (!facts.length && !website) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
      {facts.map(([k, v]) => (
        <span key={k}><span className="text-ink-subtle">{k}:</span> {v}</span>
      ))}
      {website && (
        <a href={website.startsWith('http') ? website : `https://${website}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
          {website.replace(/^https?:\/\//, '')}
        </a>
      )}
    </div>
  );
}

const isSentinel = (v: string) => v === 'pending' || v === 'not configured';

export function BriefDetailView({ brief }: { brief: Brief }) {
  const ss = brief.sectionStatus;
  if (!ss) return null;
  const org = brief.orgTree ?? { estimators: [], programManagers: [], upperManagement: [] };
  const orgEmpty = !org.estimators.length && !org.programManagers.length && !org.upperManagement.length;
  const priorDeals = brief.priorDeals ?? [];
  const openRoles = brief.openRoles ?? [];

  return (
    <div className="flex flex-col gap-3">
      {/* Company + revenue on top, full width */}
      <SectionPanel title="Company" status={ss.revenue}>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-lg font-semibold tabular-nums text-ink">{brief.zoomInfoRevenue || 'Unknown'}</span>
          <span className="text-xs text-ink-subtle">revenue (ZoomInfo)</span>
        </div>
        <CompanyFacts company={brief.company} />
        <p className={`mt-1.5 text-xs ${isSentinel(brief.clayRevenue || '') ? 'text-ink-subtle' : 'text-ink-muted'}`}>
          Clay: {brief.clayRevenue || 'not configured'}
        </p>
      </SectionPanel>

      {/* Overview spans full width (it's the meatiest); the rest flow 2-up. */}
      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <SectionPanel title="Overview" status={ss.overview}>
            <p className="whitespace-pre-line text-sm text-ink-muted">{brief.overview || 'No overview found.'}</p>
          </SectionPanel>
        </div>

        <SectionPanel title="Portfolio / Projects" status={ss.portfolio}>
          <p className="whitespace-pre-line text-sm text-ink-muted">
            {brief.portfolio || 'No portfolio/project links found on their site.'}
          </p>
        </SectionPanel>

        <SectionPanel title="Org Tree" status={ss.orgTree}>
          {orgEmpty ? (
            <p className="text-sm text-ink-subtle">No contacts found.</p>
          ) : (
            <>
              <ContactList label="Upper Management" contacts={org.upperManagement} />
              <ContactList label="Program / Project Managers" contacts={org.programManagers} />
              <ContactList label="Estimators" contacts={org.estimators} />
            </>
          )}
        </SectionPanel>

        <SectionPanel title="HubSpot Signals" status={ss.hubspotSignals}>
          <p className="text-sm text-ink-muted">
            Last page visited: {brief.lastPageVisited || 'Unknown'}
            {brief.lastPageVisitedAt ? ` (${new Date(brief.lastPageVisitedAt).toLocaleString()})` : ''}
          </p>
          {priorDeals.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">Prior Deals</p>
              <ul className="space-y-1 text-sm text-ink-muted">
                {priorDeals.map((d, i) => (
                  <li key={i}>
                    <a href={d.dealLink} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      {d.dealName}
                    </a>{' '}
                    — {d.dealOwner}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SectionPanel>

        <SectionPanel title="Hiring Signals" status={ss.hiringSignals}>
          {openRoles.length === 0 ? (
            <p className="text-sm text-ink-subtle">No open roles found.</p>
          ) : (
            <ul className="space-y-1 text-sm text-ink-muted">
              {openRoles.map((r, i) => (
                <li key={i}>
                  <a href={r.link} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    {r.title}
                  </a>{' '}
                  <span className="text-xs text-ink-subtle">({r.source})</span>
                </li>
              ))}
            </ul>
          )}
        </SectionPanel>

        <SectionPanel title="Buying Intent" status={ss.intent}>
          <p className="text-sm text-ink-muted">{brief.zoomInfoIntentScore || 'No score'}</p>
        </SectionPanel>
      </div>
    </div>
  );
}