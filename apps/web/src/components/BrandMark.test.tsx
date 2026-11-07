import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandMark } from './BrandMark';

describe('BrandMark', () => {
  it('names the transparent mark for assistive tech', () => {
    render(<BrandMark title="Atrium" />);
    expect(screen.getByRole('img', { name: 'Atrium' })).toBeInTheDocument();
  });

  it('names the full icon once, although it ships a light and a dark image', () => {
    render(<BrandMark variant="icon" size={64} title="Atrium" />);
    expect(screen.getAllByRole('img', { name: 'Atrium' })).toHaveLength(1);
  });

  it('is decorative without a title', () => {
    render(<BrandMark variant="icon" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
