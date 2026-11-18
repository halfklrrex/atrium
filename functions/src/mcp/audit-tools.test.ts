import { describe, expect, it } from 'vitest';
import { auditTarget } from './audit-tools';

describe('auditTarget', () => {
  it('takes the first of fileId, boardId, docId, dashboardId, teamId and viewId', () => {
    expect(auditTarget({ boardId: 'b1', viewId: 'v1' })).toEqual({
      targetKind: 'board',
      targetId: 'b1',
    });
    expect(auditTarget({ boardId: 'b1', itemId: 'i1', fileId: 'f1', dataBase64: 'AAAA' })).toEqual({
      targetKind: 'file',
      targetId: 'f1',
    });
    expect(auditTarget({ docId: 'd1' })).toEqual({ targetKind: 'doc', targetId: 'd1' });
    expect(auditTarget({ dashboardId: 'x' })).toEqual({ targetKind: 'dashboard', targetId: 'x' });
    expect(auditTarget({ teamId: 't' })).toEqual({ targetKind: 'team', targetId: 't' });
    expect(auditTarget({ viewId: 'v' })).toEqual({ targetKind: 'view', targetId: 'v' });
  });

  it('cuts the id to 64 characters and records nothing else', () => {
    const target = auditTarget({ docId: 'd'.repeat(100), markdown: 'secret text' });
    expect(target).toEqual({ targetKind: 'doc', targetId: 'd'.repeat(64) });
    expect(JSON.stringify(target)).not.toContain('secret');
  });

  it('has no target when no id is named, or the value is not a string', () => {
    expect(auditTarget(undefined)).toBeUndefined();
    expect(auditTarget({})).toBeUndefined();
    expect(auditTarget({ boardId: 5, docId: '' })).toBeUndefined();
  });
});
