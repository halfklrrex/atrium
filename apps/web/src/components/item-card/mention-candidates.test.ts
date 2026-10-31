import { describe, expect, it } from 'vitest';
import type { MemberDoc } from '../../data/model';
import { makeBoard, makeWorkspace, ts } from '../../test/fixtures';
import { mentionCandidates } from './mention-candidates';

const member = (id: string, displayName: string, email: string): MemberDoc => ({
  id,
  displayName,
  photoURL: null,
  email,
  role: 'member',
  joinedAt: ts(),
  updatedAt: ts(),
});

const members = [
  member('u1', 'Jordan Lee', 'jordan.lee@example.com'),
  member('u2', 'Jordan Quinn Ames', 'jq@example.com'),
  member('u3', 'Avery Quinn', 'avery@example.com'),
];
const board = makeBoard({ id: 'b1', workspaceId: 'w1' });
const workspace = makeWorkspace({ id: 'w1', roles: { u1: 'member', u2: 'member', u3: 'member' } });

const find = (query: string) =>
  mentionCandidates({ board, workspace, members, query }).map((c) => c.uid);

describe('mentionCandidates multi-word search', () => {
  it('matches a full name typed with a space', () => {
    expect(find('Jordan Lee')).toEqual(['u1']);
  });
  it('matches words in any order and by partial word', () => {
    expect(find('lee jor')).toEqual(['u1']);
    expect(find('quinn jordan')).toEqual(['u2']);
  });
  it('matches words that are not adjacent in the name', () => {
    expect(find('jordan ames')).toEqual(['u2']);
  });
  it('matches email words', () => {
    expect(find('jordan.lee')).toEqual(['u1']);
    expect(find('quinn avery@')).toEqual([]);
    expect(find('avery quinn')).toEqual(['u3']);
  });
  it('requires every word to match', () => {
    expect(find('jordan zzz')).toEqual([]);
  });
  it('ignores trailing and repeated spaces, and an empty query lists everyone', () => {
    expect(find('jordan lee ')).toEqual(['u1']);
    expect(find('')).toHaveLength(3);
  });
});
