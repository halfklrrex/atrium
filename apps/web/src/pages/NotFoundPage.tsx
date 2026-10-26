import { EmptyState } from '../components/EmptyState/EmptyState';
import { NotFound } from '../components/illustrations';

/**
 * The catch-all 404. Unknown board and workspace ids, and ones the user cannot read, land here too:
 * they look the same on purpose.
 */
export function NotFoundPage() {
  return (
    <EmptyState
      size="page"
      illustration={<NotFound />}
      title="We couldn't find that page"
      body="The link may be broken, or the page may have been removed or made private."
      primaryAction={{ label: 'Go to Home', to: '/', variant: 'link' }}
    />
  );
}
