import { describe, it, expect } from 'vitest';
import { resolveOwner } from '../../lib/resolve-owner';

describe('resolveOwner', () => {
  it('rejects a non-attentive.ai email before even checking the owner map', () => {
    expect(resolveOwner('someone@gmail.com')).toEqual({ ok: false, reason: 'not_attentive_domain' });
  });

  it('rejects a null/undefined email', () => {
    expect(resolveOwner(null)).toEqual({ ok: false, reason: 'not_attentive_domain' });
    expect(resolveOwner(undefined)).toEqual({ ok: false, reason: 'not_attentive_domain' });
  });

  it('rejects an attentive.ai email with no owner-map entry', () => {
    expect(resolveOwner('nobody-real@attentive.ai')).toEqual({ ok: false, reason: 'not_mapped' });
  });

  it('is case-insensitive on domain matching', () => {
    expect(resolveOwner('nobody-real@ATTENTIVE.AI')).toEqual({ ok: false, reason: 'not_mapped' });
  });

  it('returns ok:true with the mapped Deal Owner for a mapped attentive.ai email', () => {
    const fakeLookup = (email: string) => (email === 'varun@attentive.ai' ? 'Varun Sharma' : null);
    expect(resolveOwner('varun@attentive.ai', fakeLookup)).toEqual({ ok: true, dealOwner: 'Varun Sharma' });
  });
});
