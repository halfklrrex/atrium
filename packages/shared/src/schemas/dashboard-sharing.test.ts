import { describe, expect, it } from 'vitest';
import { setDashboardAccessRequestSchema } from './dashboard-sharing';

describe('setDashboardAccessRequestSchema', () => {
  const parse = (v: unknown) => setDashboardAccessRequestSchema.safeParse(v).success;

  it('accepts a kind, a person role, a removal, or both', () => {
    expect(parse({ dashboardId: 'd1', kind: 'private' })).toBe(true);
    expect(parse({ dashboardId: 'd1', person: { uid: 'u1', role: 'editor' } })).toBe(true);
    expect(parse({ dashboardId: 'd1', person: { uid: 'u1', role: null } })).toBe(true);
    expect(
      parse({ dashboardId: 'd1', kind: 'shareable', person: { uid: 'u1', role: 'viewer' } }),
    ).toBe(true);
  });

  it('refuses an empty change, unknown values and extra keys', () => {
    expect(parse({ dashboardId: 'd1' })).toBe(false);
    expect(parse({ dashboardId: 'd1', kind: 'secret' })).toBe(false);
    expect(parse({ dashboardId: 'd1', person: { uid: 'u1', role: 'admin' } })).toBe(false);
    expect(parse({ dashboardId: 'd1', kind: 'main', extra: 1 })).toBe(false);
    expect(parse({ dashboardId: '', kind: 'main' })).toBe(false);
  });
});
