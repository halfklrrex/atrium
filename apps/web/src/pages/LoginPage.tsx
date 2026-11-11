import { Button, Heading, Text } from '@vibe/core';
import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { clearReturnTo, peekReturnTo } from '../auth/return-to';
import {
  BOOTSTRAP_ERROR_MESSAGE,
  getErrorCode,
  isKnownSignInError,
  signInErrorMessage,
} from '../auth/auth-errors';
import {
  ACCOUNT_BLOCKED_NOTICE,
  clearBlockedNotice,
  hasBlockedNotice,
} from '../auth/blocked-notice';
import { BrandMark } from '../components/BrandMark';
import { FullPageLoader } from '../components/FullPage';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { SOURCE_REPO_URL } from '../lib/about';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const { status, redirectError, signInWithGoogle, signOut, retryBootstrap } = useAuth();
  const location = useLocation();
  const [pending, setPending] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  // Set when the app signed a blocked person out; read once, then cleared (also safe in StrictMode).
  const [blockedNotice] = useState(hasBlockedNotice);
  useEffect(() => {
    clearBlockedNotice();
  }, []);
  useEffect(() => {
    if (status === 'ready') clearReturnTo();
  }, [status]);

  if (status === 'loading') return <FullPageLoader label="Loading…" />;

  if (status === 'ready') {
    const from = (
      location.state as { from?: { pathname?: string; search?: string; hash?: string } } | null
    )?.from;
    const remembered = peekReturnTo();
    const target =
      from?.pathname && from.pathname !== '/login'
        ? `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`
        : (remembered ?? '/');
    return <Navigate to={target} replace />;
  }

  async function handleSignIn() {
    setPending(true);
    setSignInError(null);
    try {
      await signInWithGoogle();
      // Stay in the loading state: the session (or a redirect) takes over from here.
    } catch (e) {
      if (!isKnownSignInError(e)) console.error('Google sign-in failed', getErrorCode(e) ?? '', e);
      setSignInError(signInErrorMessage(e));
      setPending(false);
    }
  }

  const bootstrapFailed = status === 'error';
  const signingIn = pending || status === 'bootstrapping';
  const errorMessage = signInError ?? (redirectError ? signInErrorMessage(redirectError) : null);

  return (
    <div className={styles.page}>
      <aside className={styles.brandPanel} aria-hidden="true">
        <div className={styles.brandLockup}>
          <BrandMark size={32} />
          <span>Atrium</span>
        </div>
        <div className={styles.brandCopy}>
          <p className={styles.tagline}>One open space for all your work.</p>
          <p className={styles.taglineSub}>Boards, plans and people around a shared courtyard.</p>
        </div>
        <div className={styles.markWatermark}>
          <BrandMark size={360} />
        </div>
      </aside>

      <main className={styles.formPanel}>
        <div className={styles.card}>
          <div className={styles.cardMark}>
            <BrandMark variant="icon" size={64} title="Atrium" />
          </div>
          <Heading type="h1" className={styles.heading}>
            {bootstrapFailed ? 'Almost there' : 'Welcome to Atrium'}
          </Heading>

          {bootstrapFailed ? (
            <>
              <p className={styles.error} role="alert">
                {BOOTSTRAP_ERROR_MESSAGE}
              </p>
              <div className={styles.actions}>
                <Button onClick={retryBootstrap}>Try again</Button>
                <Button kind="tertiary" onClick={() => void signOut()}>
                  Sign out
                </Button>
              </div>
            </>
          ) : (
            <>
              <Text type="text1" color="secondary" ellipsis={false}>
                Sign in to open your workspaces.
              </Text>

              <GoogleSignInButton
                className={styles.google}
                onClick={() => void handleSignIn()}
                loading={signingIn}
              />

              {blockedNotice && !errorMessage ? (
                <p className={styles.error} role="status">
                  {ACCOUNT_BLOCKED_NOTICE}
                </p>
              ) : null}

              {errorMessage ? (
                <p className={styles.error} role="alert">
                  {errorMessage}
                </p>
              ) : null}
            </>
          )}

          <Text type="text3" color="secondary" className={styles.legal} ellipsis={false}>
            Atrium only uses your Google account to sign you in.{' '}
            <span>
              <a href={SOURCE_REPO_URL} target="_blank" rel="noopener noreferrer">
                Source code
              </a>
              {' · '}
              <Link to="/privacy">Privacy</Link>
            </span>
          </Text>
        </div>
      </main>
    </div>
  );
}
