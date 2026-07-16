import type { BriefListItem, BriefSection } from '../../lib/types';

function MarkdownContent({ content }: { content: string }) {
  const paragraphs = content.split(/\n{2,}/).filter((p) => p.trim());
  return (
    <div className="space-y-2">
      {paragraphs.map((p, i) => (
        <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">
          {p}
        </p>
      ))}
    </div>
  );
}

function ListContent({ items }: { items: BriefListItem[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="text-sm">
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-accent hover:underline"
            >
              {item.title ?? item.url} ↗
            </a>
          ) : (
            item.title && <span className="font-medium text-ink">{item.title}</span>
          )}
          {item.snippet && (
            <p className="mt-0.5 text-sm text-ink-muted">{item.snippet}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function KeyValueContent({ content }: { content: Record<string, string> }) {
  const entries = Object.entries(content);
  return (
    <dl className="divide-y divide-line">
      {entries.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
          <dt className="w-40 flex-none text-sm font-medium text-ink-subtle">{k}</dt>
          <dd className="text-sm text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function BriefSectionView({ section }: { section: BriefSection }) {
  return (
    <section>
      <h4 className="text-sm font-semibold text-ink">{section.title}</h4>
      <div className="mt-2">
        {section.kind === 'markdown' && typeof section.content === 'string' && (
          <MarkdownContent content={section.content} />
        )}
        {section.kind === 'list' && Array.isArray(section.content) && (
          <ListContent items={section.content} />
        )}
        {section.kind === 'keyvalue' &&
          section.content &&
          !Array.isArray(section.content) &&
          typeof section.content === 'object' && (
            <KeyValueContent content={section.content as Record<string, string>} />
          )}
      </div>
    </section>
  );
}
