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

  it('renders the icon as PNGs with a 1x, 2x and 3x srcset', () => {
    const { container } = render(<BrandMark variant="icon" size={64} title="Atrium" />);
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(2);
    for (const img of imgs) {
      expect(img.getAttribute('srcset')).toMatch(/ 1x, .* 2x, .* 3x$/);
      expect(img.getAttribute('src')).toMatch(/\.png$/);
    }
  });
});
