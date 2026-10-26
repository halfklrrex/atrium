import { Button, Heading, Text } from '@vibe/core';
import { useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth/auth-context';
import {
  BOOTSTRAP_ERROR_MESSAGE,
  getErrorCode,
  isKnownSignInError,
  signInErrorMessage,
} from '../auth/auth-errors';
import { AtriumLogo, AtriumMark } from '../components/AtriumLogo';
import { FullPageLoader } from '../components/FullPage';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { SOURCE_REPO_URL } from '../lib/about';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const { status, redirectError, signInWithGoogle, signOut, retryBootstrap } = useAuth();
  const location = useLocation();
  const [pending, setPending] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  if (status === 'loading') return <FullPageLoader label="Loading…" />;

  if (status === 'ready') {
    const from = (
      location.state as { from?: { pathname?: string; search?: string; hash?: string } } | null
    )?.from;
    const target =
      from?.pathname && from.pathname !== '/login'
        ? `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`
        : '/';
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
        <AtriumLogo variant="onDark" size={32} />
        <div className={styles.brandCopy}>
          <p className={styles.tagline}>One open space for all your work.</p>
          <p className={styles.taglineSub}>Boards, plans and people around a shared courtyard.</p>
        </div>
        <div className={styles.markWatermark}>
          <AtriumMark size={360} />
        </div>
      </aside>

      <main className={styles.formPanel}>
        <div className={styles.card}>
          <div className={styles.cardMark}>
            <AtriumMark size={48} title="Atrium" />
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
              <Text type="text1" color="secondary">
                Sign in to open your workspaces.
              </Text>

              <GoogleSignInButton
                className={styles.google}
                onClick={() => void handleSignIn()}
                loading={signingIn}
              />

              {errorMessage ? (
                <p className={styles.error} role="alert">
                  {errorMessage}
                </p>
              ) : null}
            </>
          )}

          <Text type="text3" color="secondary" className={styles.legal}>
            Atrium only uses your Google account to sign you in.{' '}
            <a href={SOURCE_REPO_URL} target="_blank" rel="noopener noreferrer">
              Source code
            </a>
          </Text>
        </div>
      </main>
    </div>
  );
}
