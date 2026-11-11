import { Navigate, Outlet, useLocation } from 'react-router';
import { FullPageLoader, FullPageMessage } from '../components/FullPage';
import { BOOTSTRAP_ERROR_MESSAGE } from './auth-errors';
import { AccountGate } from './AccountGate';
import { useAuth } from './auth-context';
import { rememberReturnTo } from './return-to';

/** Layout route guard: only renders children for a signed-in, bootstrapped user. */
export function RequireAuth() {
  const { status, accountStatus, retryBootstrap, signOut } = useAuth();
  const location = useLocation();

  switch (status) {
    case 'loading':
    case 'bootstrapping':
      return (
        <FullPageLoader label={status === 'loading' ? 'Loading…' : 'Setting up your workspace…'} />
      );
    case 'signedOut':
      rememberReturnTo(location.pathname, location.search, location.hash);
      return <Navigate to="/login" replace state={{ from: location }} />;
    case 'error':
      return (
        <FullPageMessage
          title="Account setup incomplete"
          description={BOOTSTRAP_ERROR_MESSAGE}
          primary={{ text: 'Try again', onClick: retryBootstrap }}
          secondary={{ text: 'Sign out', onClick: () => void signOut() }}
        />
      );
    case 'ready':
      // Only a pending or blocked account is gated; a missing status or `approved` goes straight in.
      if (accountStatus === 'pending' || accountStatus === 'blocked') {
        return <AccountGate status={accountStatus} />;
      }
      return <Outlet />;
  }
}
