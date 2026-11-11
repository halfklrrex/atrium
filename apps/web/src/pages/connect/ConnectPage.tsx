import { MCP_READ_SCOPE, type McpAuthRequestInfoResult, type McpScope } from '@atrium/shared';
import { Button, Checkbox } from '@vibe/core';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { BrandMark } from '../../components/BrandMark';
import { FullPageLoader, FullPageMessage } from '../../components/FullPage';
import { describeCallableError, mcpCalls } from '../../lib/callables';
import styles from './ConnectPage.module.css';

const SCOPE_COPY: Record<McpScope, { label: string; hint: string }> = {
  'atrium:read': {
    label: 'Read',
    hint: 'See your workspaces, boards, items and updates.',
  },
  'atrium:write': {
    label: 'Write',
    hint: 'Create and change items, updates and boards you can edit.',
  },
};

type State =
  | { kind: 'loading' }
  | { kind: 'notFound' }
  | { kind: 'error'; message: string }
  | { kind: 'consent'; info: McpAuthRequestInfoResult }
  | { kind: 'done' };

/** Leaves the app for another address. Split out so it is one obvious call. */
function goTo(url: string) {
  window.location.assign(url);
}

const NOT_FOUND_CODES = ['not-found', 'invalid-argument', 'failed-precondition'];

/**
 * `/connect?request=<id>` - the consent screen of the hosted MCP connector (OPS4). Sign-in and the
 * account gate are enforced above. The client name is untrusted text and is only ever rendered as text.
 */
export function ConnectPage() {
  const [params] = useSearchParams();
  const requestId = params.get('request') ?? '';
  const [state, setState] = useState<State>(requestId ? { kind: 'loading' } : { kind: 'notFound' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!requestId) return;
    let cancelled = false;
    mcpCalls.authRequestInfo({ requestId }).then(
      (info) => {
        if (!cancelled) setState({ kind: 'consent', info });
      },
      (e: unknown) => {
        if (cancelled) return;
        const code = (e as { code?: string } | null)?.code ?? '';
        setState(
          NOT_FOUND_CODES.some((c) => code.endsWith(c))
            ? { kind: 'notFound' }
            : { kind: 'error', message: describeCallableError(e, 'Could not load this request.') },
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [requestId, attempt]);

  switch (state.kind) {
    case 'loading':
      return <FullPageLoader label="Loading…" />;
    case 'done':
      return <FullPageLoader label="Returning to Claude…" />;
    case 'notFound':
      return (
        <FullPageMessage
          title="This request has expired"
          description="This connection request was not found or has expired. Start again from Claude."
          primary={{ text: 'Go to Atrium', onClick: () => goTo('/') }}
        />
      );
    case 'error':
      return (
        <FullPageMessage
          title="Something went wrong"
          description={state.message}
          primary={{
            text: 'Try again',
            onClick: () => {
              setState({ kind: 'loading' });
              setAttempt((n) => n + 1);
            },
          }}
        />
      );
    case 'consent':
      return (
        <Consent
          requestId={requestId}
          info={state.info}
          onRedirect={(redirectUrl) => {
            setState({ kind: 'done' });
            goTo(redirectUrl);
          }}
        />
      );
  }
}

function Consent({
  requestId,
  info,
  onRedirect,
}: {
  requestId: string;
  info: McpAuthRequestInfoResult;
  onRedirect: (redirectUrl: string) => void;
}) {
  const scopes = info.requestedScopes.includes(MCP_READ_SCOPE)
    ? info.requestedScopes
    : [MCP_READ_SCOPE, ...info.requestedScopes];
  const [granted, setGranted] = useState<McpScope[]>(scopes);
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: 'allow' | 'deny') => {
    setBusy(decision);
    setError(null);
    try {
      const { redirectUrl } = await mcpCalls.authorize(
        decision === 'allow' ? { requestId, decision, scopes: granted } : { requestId, decision },
      );
      onRedirect(redirectUrl);
    } catch (e) {
      setBusy(null);
      setError(
        describeCallableError(e, 'Could not complete this request. Start again from Claude.'),
      );
    }
  };

  const toggle = (scope: McpScope) =>
    setGranted((current) =>
      current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope],
    );

  return (
    <div className={styles.page}>
      <main className={styles.card} aria-labelledby="connect-title">
        <div className={styles.header}>
          <BrandMark size={40} />
          <h1 id="connect-title" className={styles.title}>
            Connect to Atrium
          </h1>
          <p className={styles.lead}>
            <span className={styles.clientName}>{info.clientName}</span> wants to access your Atrium
            workspaces.
          </p>
        </div>
        <p className={styles.destination}>
          After you choose, you will be sent to{' '}
          <span className={styles.host}>{info.redirectHost}</span>.
        </p>
        {info.loopback ? (
          <p className={styles.warning} role="alert">
            The code will be sent to a program on this computer. Only continue if you started this
            connection yourself.
          </p>
        ) : null}
        <fieldset className={styles.scopes}>
          <legend className={styles.scopesLabel}>Allow this app to</legend>
          {scopes.map((scope) => (
            <div key={scope}>
              <Checkbox
                label={SCOPE_COPY[scope].label}
                checked={granted.includes(scope)}
                disabled={scope === MCP_READ_SCOPE || busy !== null}
                onChange={() => toggle(scope)}
              />
              <p className={styles.scopeHint}>{SCOPE_COPY[scope].hint}</p>
            </div>
          ))}
        </fieldset>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.actions}>
          <Button
            kind="tertiary"
            disabled={busy !== null}
            loading={busy === 'deny'}
            onClick={() => void decide('deny')}
          >
            Deny
          </Button>
          <Button
            disabled={busy !== null}
            loading={busy === 'allow'}
            onClick={() => void decide('allow')}
          >
            Allow
          </Button>
        </div>
      </main>
    </div>
  );
}
