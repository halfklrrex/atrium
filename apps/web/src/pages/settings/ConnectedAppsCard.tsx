import { Button } from '@vibe/core';
import { useState } from 'react';
import { useAuth } from '../../auth/auth-context';
import { ConfirmDialog } from '../../components/board-table/ConfirmDialog';
import { useMcpGrants, type McpGrantDoc } from '../../data';
import { describeCallableError, mcpCalls } from '../../lib/callables';
import styles from './Settings.module.css';
import { describeGrant } from './connected-apps';
import { SettingsCard } from './SettingsCard';

/** Settings > Account: the apps (Claude connectors) the person has allowed into Atrium. */
export function ConnectedAppsCard() {
  const { user } = useAuth();
  const { data: grants, loading, error } = useMcpGrants(user?.uid);
  const [confirming, setConfirming] = useState<McpGrantDoc | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const disconnect = async (grant: McpGrantDoc) => {
    setFailure(null);
    try {
      await mcpCalls.revokeGrant({ grantId: grant.id });
    } catch (e) {
      setFailure(describeCallableError(e, `Could not disconnect ${grant.clientName}.`));
    }
  };

  return (
    <SettingsCard
      title="Connected apps"
      hint="Apps you have allowed to use your Atrium data. Disconnect one to stop it right away."
    >
      {loading ? null : error ? (
        <p className={styles.rowValue} role="alert">
          Could not load your connected apps.
        </p>
      ) : grants.length === 0 ? (
        <p className={styles.rowValue}>
          No apps are connected. Add Atrium as a connector in Claude to see it here.
        </p>
      ) : (
        <ul className={styles.rows}>
          {grants.map((grant) => (
            <li key={grant.id} className={styles.row}>
              <span className={styles.rowText}>
                <span className={styles.rowTitle}>{grant.clientName}</span>
                <span className={styles.rowValue}>{describeGrant(grant)}</span>
              </span>
              <Button
                kind="secondary"
                aria-label={`Disconnect ${grant.clientName}`}
                onClick={() => setConfirming(grant)}
              >
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      )}
      {failure ? (
        <p className={styles.rowValue} role="alert">
          {failure}
        </p>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          title={`Disconnect ${confirming.clientName}?`}
          message="It will lose access to your Atrium data right away. You can connect it again from Claude."
          confirmLabel="Disconnect"
          onConfirm={() => disconnect(confirming)}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </SettingsCard>
  );
}
