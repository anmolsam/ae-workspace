import { ExaResearchProvider } from './exa.js';
import { ZoomInfoProvider } from './zoominfo.js';
import { JinaResearchProvider } from './jina.js';
import { SeamlessProvider } from './seamless.js';

/**
 * ResearchProviderAdapter — the registry BriefGenerationService fans out over.
 * Add a provider by dropping a file next to these and registering it here.
 */
const providers = [
  new ExaResearchProvider(),
  new ZoomInfoProvider(),
  new JinaResearchProvider(),
  new SeamlessProvider(),
];

export const allProviders = () => providers;
export const availableProviders = () => providers.filter((p) => p.available);

/** Fan out company enrichment across all available providers. */
export async function enrichCompanyAll(input) {
  const active = availableProviders();
  return Promise.all(active.map((p) => p.enrichCompany(input)));
}

export async function enrichPersonAll(input) {
  const active = availableProviders();
  return Promise.all(active.map((p) => p.enrichPerson(input)));
}
