import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';

function decode(segment: string | undefined): string | undefined {
  try {
    return segment === undefined ? undefined : decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Renders nothing. Once a page has loaded its document, swaps the route param (second path
 * segment: `/boards/<param>/...`) for the canonical `<slug>-<id>` with one `replace` navigation,
 * keeping the rest of the path, query, hash and router state. A param that already matches (the
 * state after the replace) does nothing, so there is no loop.
 */
export function CanonicalUrl({
  param,
  canonical,
}: {
  param: string | undefined;
  canonical: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (!param || param === canonical) return;
    const parts = location.pathname.split('/');
    if (decode(parts[2]) !== param) return;
    parts[2] = canonical;
    void navigate(
      { pathname: parts.join('/'), search: location.search, hash: location.hash },
      { replace: true, state: location.state },
    );
  }, [param, canonical, navigate, location]);
  return null;
}
