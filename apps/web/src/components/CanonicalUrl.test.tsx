import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router';
import { describe, expect, it } from 'vitest';
import { CanonicalUrl } from './CanonicalUrl';

function Probe({ log }: { log: string[] }) {
  const location = useLocation();
  const type = useNavigationType();
  log.push(`${type} ${location.pathname}${location.search}${location.hash}`);
  return null;
}

function setup(entry: string, canonical = 'new-name-b1') {
  const log: string[] = [];
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Probe log={log} />
      <Routes>
        <Route
          path="boards/:boardId/*"
          element={
            <CanonicalUrl param={entry.split('/')[2]?.split(/[?#]/)[0]} canonical={canonical} />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return log;
}

describe('CanonicalUrl', () => {
  it('replaces an old slug once, keeping suffix, query and hash', () => {
    const log = setup('/boards/old-name-b1/items/i1?x=1#h');
    expect(log.filter((l) => l.startsWith('REPLACE'))).toEqual([
      'REPLACE /boards/new-name-b1/items/i1?x=1#h',
    ]);
  });
  it('canonicalises a bare id', () => {
    const log = setup('/boards/b1/views/v1');
    expect(log.at(-1)).toBe('REPLACE /boards/new-name-b1/views/v1');
  });
  it('does nothing when already canonical', () => {
    const log = setup('/boards/new-name-b1');
    expect(log.every((l) => l.startsWith('POP'))).toBe(true);
  });
});
