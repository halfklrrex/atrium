import { describe, expect, it } from 'vitest';
import {
  canReply,
  emptyMessage,
  formatInboxCount,
  kindLabel,
  senderEmailLine,
  senderLabel,
} from './inbox';

describe('inbox helpers', () => {
  it('caps the badge at 99+', () => {
    expect(formatInboxCount(0)).toBe('0');
    expect(formatInboxCount(99)).toBe('99');
    expect(formatInboxCount(100)).toBe('99+');
  });

  it('labels the kind with the category for feedback', () => {
    expect(kindLabel({ kind: 'appeal', category: null })).toBe('Appeal');
    expect(kindLabel({ kind: 'feedback', category: 'bug' })).toBe('Feedback · Bug');
    expect(kindLabel({ kind: 'feedback', category: null })).toBe('Feedback');
  });

  it('falls back from name to email to a neutral word', () => {
    expect(senderLabel({ senderName: 'Avery Quinn', senderEmail: 'avery@example.com' })).toBe(
      'Avery Quinn',
    );
    expect(senderLabel({ senderName: ' ', senderEmail: 'avery@example.com' })).toBe(
      'avery@example.com',
    );
    expect(senderLabel({ senderName: '', senderEmail: null })).toBe('Someone');
  });

  it('leaves the email line out when it repeats the name or is missing', () => {
    expect(senderEmailLine({ senderName: 'Avery Quinn', senderEmail: 'avery@example.com' })).toBe(
      'avery@example.com',
    );
    expect(
      senderEmailLine({ senderName: 'avery@example.com', senderEmail: 'avery@example.com' }),
    ).toBe(null);
    expect(senderEmailLine({ senderName: 'Avery', senderEmail: null })).toBeNull();
  });

  it('has an empty-state text per filter', () => {
    expect(emptyMessage('open', 'all')).toMatch(/waiting for you/);
    expect(emptyMessage('open', 'appeal')).toMatch(/open appeals/);
    expect(emptyMessage('answered', 'feedback')).toBe('No answered feedback yet.');
    expect(emptyMessage('closed', 'all')).toBe('No closed messages.');
    expect(emptyMessage('all', 'all')).toBe('No messages yet.');
    expect(emptyMessage('all', 'appeal')).toBe('No appeals yet.');
  });

  it('only a closed thread cannot be replied to', () => {
    expect(canReply({ status: 'open' })).toBe(true);
    expect(canReply({ status: 'answered' })).toBe(true);
    expect(canReply({ status: 'closed' })).toBe(false);
  });
});
