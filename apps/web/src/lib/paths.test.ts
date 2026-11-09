import { describe, expect, it } from 'vitest';
import { boardPath, dashboardPath, idFromSlugParam, workspacePath } from './paths';

describe('idFromSlugParam', () => {
  it('returns a bare id as is', () => {
    expect(idFromSlugParam('8fK2xQabc')).toBe('8fK2xQabc');
  });
  it('takes the text after the last dash', () => {
    expect(idFromSlugParam('q4-roadmap-8fK2xQabc')).toBe('8fK2xQabc');
    expect(idFromSlugParam('a-b-c-d-e-id1')).toBe('id1');
  });
  it('returns an empty id for a trailing dash, empty or missing input', () => {
    expect(idFromSlugParam('q4-')).toBe('');
    expect(idFromSlugParam('')).toBe('');
    expect(idFromSlugParam(undefined)).toBe('');
  });
  it('does not trust junk: the id is whatever follows the last dash', () => {
    expect(idFromSlugParam('--')).toBe('');
    expect(idFromSlugParam('../x-abc')).toBe('abc');
  });
});

describe('paths', () => {
  it('prefixes the slug of the name', () => {
    expect(boardPath({ id: 'b1', name: 'Q4 Roadmap' })).toBe('/boards/q4-roadmap-b1');
    expect(workspacePath({ id: 'w1', name: 'Café' }, '/trash')).toBe('/workspaces/cafe-w1/trash');
    expect(dashboardPath({ id: 'd1', name: 'Sales' })).toBe('/dashboards/sales-d1');
  });
  it('uses the fallback word for names without Latin letters', () => {
    expect(boardPath({ id: 'b1', name: '🚀' }, '/items/i1')).toBe('/boards/board-b1/items/i1');
    expect(workspacePath({ id: 'w1', name: '日本' })).toBe('/workspaces/workspace-w1');
    expect(dashboardPath({ id: 'd1', name: '!!' })).toBe('/dashboards/dashboard-d1');
  });
  it('builds the bare-id form without a name', () => {
    expect(boardPath({ id: 'b1' }, '/views/v1')).toBe('/boards/b1/views/v1');
  });
  it('round-trips through idFromSlugParam', () => {
    const p = boardPath({ id: 'AbC123', name: 'a-b -- c' }).split('/')[2];
    expect(idFromSlugParam(p)).toBe('AbC123');
  });
});
