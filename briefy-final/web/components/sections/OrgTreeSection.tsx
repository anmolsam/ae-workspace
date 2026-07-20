import { SectionPanel } from '../SectionPanel';
import type { BriefDetail, OrgTreeContact } from '../../types/briefy';

function ContactList({ label, contacts }: { label: string; contacts: OrgTreeContact[] }) {
  if (!contacts.length) return null;
  return (
    <div className="mb-3 last:mb-0">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <ul className="space-y-1 text-sm text-neutral-700">
        {contacts.map((c, i) => (
          <li key={i}>
            {c.name || 'Unnamed'} — {c.title || 'Unknown title'}
            {c.email ? ` · ${c.email}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OrgTreeSection({ brief }: { brief: BriefDetail }) {
  const { estimators, programManagers, upperManagement } = brief.orgTree;
  const isEmpty = !estimators.length && !programManagers.length && !upperManagement.length;

  return (
    <SectionPanel title="Org Tree" status={brief.sectionStatus.orgTree}>
      {isEmpty ? (
        <p className="text-sm text-neutral-400">No contacts found.</p>
      ) : (
        <>
          <ContactList label="Upper Management" contacts={upperManagement} />
          <ContactList label="Program / Project Managers" contacts={programManagers} />
          <ContactList label="Estimators" contacts={estimators} />
        </>
      )}
    </SectionPanel>
  );
}
