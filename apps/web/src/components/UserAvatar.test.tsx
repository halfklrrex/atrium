import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UserAvatar } from './UserAvatar';

vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('../auth/auth-context', () => ({
  useAuth: () => ({ user: { uid: 'u1', displayName: 'Ada Lovelace' } }),
}));

describe('UserAvatar', () => {
  it('gives an automation id the automation avatar even with a photo and a name', () => {
    const { container } = render(
      <UserAvatar uid="automation:abc" name="Someone" photoURL="https://example.com/x.png" />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('avatar-content').tagName.toLowerCase()).toBe('svg');
    expect(screen.queryByText('SO')).not.toBeInTheDocument();
  });

  it('keeps initials for a normal user', () => {
    render(<UserAvatar uid="u2" name="Jordan Lee" photoURL={null} />);
    expect(screen.getByText('JL')).toBeInTheDocument();
  });
});
