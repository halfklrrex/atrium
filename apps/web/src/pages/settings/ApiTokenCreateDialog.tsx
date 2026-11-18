import { API_TOKEN_NAME_MAX } from '@atrium/shared';
import {
  Button,
  Checkbox,
  Modal,
  ModalBasicLayout,
  ModalContent,
  ModalFooter,
  ModalHeader,
  RadioButton,
  TextField,
} from '@vibe/core';
import { useId, useState } from 'react';
import type { WorkspaceDoc } from '../../data';
import { apiTokenCalls, describeCallableError } from '../../lib/callables';
import {
  EMPTY_CREATE_FORM,
  EXPIRY_OPTIONS,
  parseCreateForm,
  type AccessChoice,
  type CreateForm,
  type ExpiryDays,
} from './api-tokens';
import styles from './Settings.module.css';

/**
 * "Create token": a form, then the new token shown once. The token only ever lives in this
 * component's state, so closing the dialog discards it (never stored, logged or put in the URL).
 */
export function ApiTokenCreateDialog({
  workspaces,
  onClose,
}: {
  workspaces: readonly WorkspaceDoc[];
  onClose: () => void;
}) {
  const [form, setForm] = useState<CreateForm>(EMPTY_CREATE_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const groupId = useId();
  const nameErrorId = useId();

  const change = (patch: Partial<CreateForm>) => {
    setError(null);
    setForm((current) => ({ ...current, ...patch }));
  };

  const toggleWorkspace = (id: string) =>
    change({
      workspaceIds: form.workspaceIds.includes(id)
        ? form.workspaceIds.filter((w) => w !== id)
        : [...form.workspaceIds, id],
    });

  const submit = async () => {
    if (submitting) return;
    const parsed = parseCreateForm(form);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiTokenCalls.create(parsed.request);
      setToken(result.token);
    } catch (e) {
      setError(describeCallableError(e, 'Could not create the token. Try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      setError('Could not copy. Select the token and copy it yourself.');
    }
  };

  if (token) {
    return (
      <Modal id="api-token-created-dialog" show size="medium" onClose={onClose}>
        <ModalBasicLayout>
          <ModalHeader title="Your new API token" />
          <ModalContent>
            <div className={styles.dialogStack}>
              <p className={styles.dialogWarning} role="alert">
                Copy this token now. You won&apos;t be able to see it again.
              </p>
              <div className={styles.tokenBox}>
                <div className={styles.tokenValue}>
                  <TextField
                    inputAriaLabel="API token"
                    title="API token"
                    value={token}
                    readonly
                    autoFocus
                    size="medium"
                    onChange={() => undefined}
                  />
                </div>
                <Button kind="secondary" onClick={() => void copy()}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              {error ? (
                <p className={styles.errorText} role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </ModalContent>
        </ModalBasicLayout>
        <ModalFooter primaryButton={{ text: 'Done', onClick: onClose }} />
      </Modal>
    );
  }

  return (
    <Modal id="api-token-create-dialog" show size="medium" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title="Create API token" />
        <ModalContent>
          <form
            className={styles.dialogStack}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <TextField
              title="Name"
              inputAriaLabel="Name"
              placeholder="Shortcuts on my phone"
              value={form.name}
              onChange={(value: string) => change({ name: value })}
              maxLength={API_TOKEN_NAME_MAX}
              required
              autoFocus
              size="medium"
            />

            <div
              role="radiogroup"
              aria-labelledby={`${groupId}-access`}
              className={styles.formField}
            >
              <span id={`${groupId}-access`} className={styles.rowTitle}>
                Access
              </span>
              <div className={styles.radioRow}>
                {(
                  [
                    ['read', 'Read only'],
                    ['write', 'Read and write'],
                  ] as const
                ).map(([value, label]) => (
                  <RadioButton
                    key={value}
                    name={`${groupId}-access`}
                    text={label}
                    value={value}
                    checked={form.access === value}
                    onSelect={() => change({ access: value as AccessChoice })}
                  />
                ))}
              </div>
            </div>

            <div
              role="radiogroup"
              aria-labelledby={`${groupId}-workspaces`}
              className={styles.formField}
            >
              <span id={`${groupId}-workspaces`} className={styles.rowTitle}>
                Workspaces
              </span>
              <div className={styles.radioRow}>
                <RadioButton
                  name={`${groupId}-workspaces`}
                  text="All workspaces"
                  value="all"
                  checked={!form.restrict}
                  onSelect={() => change({ restrict: false })}
                />
                <RadioButton
                  name={`${groupId}-workspaces`}
                  text="Only some workspaces"
                  value="some"
                  checked={form.restrict}
                  onSelect={() => change({ restrict: true })}
                />
              </div>
              {form.restrict ? (
                workspaces.length === 0 ? (
                  <p className={styles.rowValue}>You are not in any workspace yet.</p>
                ) : (
                  <ul className={styles.checkList} aria-label="Workspaces the token can use">
                    {workspaces.map((workspace) => (
                      <li key={workspace.id}>
                        <Checkbox
                          label={workspace.name}
                          checked={form.workspaceIds.includes(workspace.id)}
                          onChange={() => toggleWorkspace(workspace.id)}
                        />
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </div>

            <div className={styles.formField}>
              <label htmlFor={`${groupId}-expiry`} className={styles.rowTitle}>
                Expires after
              </label>
              <select
                id={`${groupId}-expiry`}
                className={styles.select}
                value={form.expiresInDays}
                onChange={(e) => change({ expiresInDays: Number(e.target.value) as ExpiryDays })}
              >
                {EXPIRY_OPTIONS.map((option) => (
                  <option key={option.days} value={option.days}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {error ? (
              <p id={nameErrorId} className={styles.errorText} role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" hidden />
          </form>
        </ModalContent>
      </ModalBasicLayout>
      <ModalFooter
        primaryButton={{
          text: 'Create token',
          onClick: () => void submit(),
          disabled: submitting,
          loading: submitting,
        }}
        secondaryButton={{ text: 'Cancel', onClick: onClose, disabled: submitting }}
      />
    </Modal>
  );
}
