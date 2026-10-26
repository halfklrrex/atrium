import type { ButtonHTMLAttributes } from 'react';
import styles from './GoogleSignInButton.module.css';

/** The standard four-colour Google "G" (Google Identity branding guidelines). */
function GoogleLogo() {
  return (
    <svg
      className={styles.icon}
      data-testid="google-logo"
      width="20"
      height="20"
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <path
        // eslint-disable-next-line no-restricted-syntax -- Google brand colour
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        // eslint-disable-next-line no-restricted-syntax -- Google brand colour
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        // eslint-disable-next-line no-restricted-syntax -- Google brand colour
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        // eslint-disable-next-line no-restricted-syntax -- Google brand colour
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

interface GoogleSignInButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'type' | 'children'
> {
  /** Sign-in or account setup is in progress: disables the button and shows a spinner. */
  loading?: boolean;
}

export function GoogleSignInButton({
  loading = false,
  disabled,
  className,
  ...rest
}: GoogleSignInButtonProps) {
  return (
    <button
      {...rest}
      type="button"
      className={className ? `${styles.button} ${className}` : styles.button}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <span className={styles.spinner} data-testid="google-button-spinner" aria-hidden="true" />
      ) : (
        <GoogleLogo />
      )}
      <span className={styles.label}>{loading ? 'Signing in…' : 'Continue with Google'}</span>
    </button>
  );
}
