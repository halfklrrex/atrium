import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { InboxMessageDoc } from '../../data/inbox';
import { MessageList } from './MessageList';

const thread = {
  senderName: 'Casey Morgan',
  senderEmail: 'casey@example.com',
  senderPhotoURL: null,
};
const at = { toMillis: () => Date.now() } as never;

function msg(over: Partial<InboxMessageDoc>): InboxMessageDoc {
  return {
    id: 'm',
    seq: 1,
    authorRole: 'sender',
    authorUid: 'u',
    authorName: 'Casey Morgan',
    authorPhotoURL: null,
    text: 'hi',
    createdAt: at,
    ...over,
  } as InboxMessageDoc;
}

describe('MessageList', () => {
  it('shows admin messages as Site Administrator, never a name', () => {
    render(
      <MessageList
        thread={thread}
        messages={[
          msg({ id: 'a' }),
          msg({ id: 'b', authorRole: 'admin', authorUid: null, authorName: null, text: 'Reply' }),
        ]}
      />,
    );
    expect(screen.getByLabelText('Admin message')).toHaveTextContent('Site Administrator');
    expect(screen.getByLabelText('Message')).toHaveTextContent('Casey Morgan');
  });

  it('renders message text as plain text', () => {
    render(
      <MessageList
        thread={thread}
        messages={[msg({ text: '<b>bold</b> <img src=x onerror=1>' })]}
      />,
    );
    expect(screen.getByText('<b>bold</b> <img src=x onerror=1>')).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
  });
});
