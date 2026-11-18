import { Button } from '@vibe/core';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { ConfirmDialog } from '../../components/board-table/ConfirmDialog';
import { useApiTokens, useWorkspaces, type ApiTokenDoc } from '../../data';
import { apiTokenCalls, describeCallableError } from '../../lib/callables';
import { ApiTokenCreateDialog } from './ApiTokenCreateDialog';
import { describePrefix, describeToken, isExpired } from './api-tokens';
import styles from './Settings.module.css';
import { SettingsCard } from './SettingsCard';

/** Settings > Account: personal access tokens for scripts and Shortcuts (P8). */
export function ApiTokensCard() {
  const { user } = useAuth();
  const { data: tokens, loading, error } = useApiTokens(user?.uid);
  const { data: workspaces } = useWorkspaces(user?.uid ?? null);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<ApiTokenDoc | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const names = useMemo(() => new Map(workspaces.map((w) => [w.id, w.name])), [workspaces]);

  const revoke = async (token: ApiTokenDoc) => {
    setFailure(null);
    try {
      await apiTokenCalls.revoke({ tokenId: token.id });
    } catch (e) {
      setFailure(describeCallableError(e, `Could not revoke ${token.name}.`));
    }
  };

  return (
    <SettingsCard
      title="API tokens"
      hint="Personal tokens let scripts and Shortcuts use Atrium as you. Revoke one to stop it right away."
      headerEnd={
        <Button kind="secondary" size="small" onClick={() => setCreating(true)}>
          Create token
        </Button>
      }
    >
      {loading ? null : error ? (
        <p className={styles.rowValue} role="alert">
          Could not load your API tokens.
        </p>
      ) : tokens.length === 0 ? (
        <p className={styles.rowValue}>
          No API tokens. Create one to use Atrium from scripts and Shortcuts.
        </p>
      ) : (
        <ul className={styles.rows}>
          {tokens.map((token) => {
            const expired = isExpired(token);
            return (
              <li
                key={token.id}
                className={expired ? `${styles.row} ${styles.rowDim}` : styles.row}
              >
                <span className={styles.rowText}>
                  <span className={styles.rowTitle}>
                    {token.name}
                    {expired ? ' (Expired)' : ''}
                  </span>
                  <span className={styles.rowValue}>{describePrefix(token.prefix)}</span>
                  <span className={styles.rowValue}>{describeToken(token, names)}</span>
                </span>
                <Button
                  kind="secondary"
                  aria-label={`Revoke ${token.name}`}
                  onClick={() => setConfirming(token)}
                >
                  Revoke
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <p className={styles.rowValue}>
        <Link to="/developers">API and webhooks guide</Link>
      </p>
      {failure ? (
        <p className={styles.rowValue} role="alert">
          {failure}
        </p>
      ) : null}
      {creating ? (
        <ApiTokenCreateDialog workspaces={workspaces} onClose={() => setCreating(false)} />
      ) : null}
      {confirming ? (
        <ConfirmDialog
          title={`Revoke ${confirming.name}?`}
          message="Anything using this token stops working right away. This can't be undone."
          confirmLabel="Revoke"
          onConfirm={() => revoke(confirming)}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </SettingsCard>
  );
}
