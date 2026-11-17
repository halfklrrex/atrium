import { PROFILE_LIMITS, type UserProfile } from '@atrium/shared';
import { Button, TextArea, TextField, Toggle } from '@vibe/core';
import { useId, useState } from 'react';
import { showToast } from '../../components/toast-store';
import { profileCalls } from '../../lib/callables';
import {
  MONTH_NAMES,
  formFromProfile,
  parseProfileForm,
  sameProfile,
  type ProfileForm,
} from './profile-form';
import styles from './Settings.module.css';
import { SettingsCard } from './SettingsCard';

/** Settings > Profile > "About you": optional fields people in your workspaces see on your card. */
export function AboutYouCard({ saved }: { saved: UserProfile | undefined }) {
  const baseline = formFromProfile(saved);
  // Local edits only; undefined means "no edits, follow the saved profile".
  const [edits, setEdits] = useState<ProfileForm | null>(null);
  const [saving, setSaving] = useState(false);
  const form = edits ?? baseline;
  const dirty = edits !== null && !sameProfile(edits, baseline);
  const parsed = parseProfileForm(form);
  const timeId = useId();
  const monthId = useId();
  const dayId = useId();
  const errorId = useId();
  const titleId = useId();
  const locationId = useId();

  const change = (patch: Partial<ProfileForm>) => setEdits({ ...form, ...patch });

  const save = async () => {
    if (!parsed.ok || saving) return;
    setSaving(true);
    try {
      await profileCalls.setMyProfile(parsed.value);
      setEdits(null);
      showToast('Profile saved.', { type: 'positive' });
    } catch (error) {
      const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
      showToast(`Couldn't save your profile.${detail}`, { type: 'negative' });
    } finally {
      setSaving(false);
    }
  };

  const showError = !parsed.ok && dirty;

  return (
    <SettingsCard
      title="About you"
      hint="People in your workspaces see this on your profile card. Every field is optional."
    >
      <form
        className={styles.formStack}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        noValidate
      >
        <TextField
          id={titleId}
          title="Title"
          inputAriaLabel="Title"
          placeholder="Mom, Treasurer, Designer"
          value={form.title}
          onChange={(value: string) => change({ title: value })}
          maxLength={PROFILE_LIMITS.title}
          size="medium"
        />
        <div className={styles.formField}>
          <TextArea
            label="About"
            aria-label="About"
            value={form.about}
            rows={3}
            placeholder="A line or two about you"
            maxLength={PROFILE_LIMITS.about}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
              change({ about: e.target.value })
            }
          />
          <span className={styles.counter} aria-live="off">
            {form.about.length}/{PROFILE_LIMITS.about}
          </span>
        </div>
        <TextField
          id={locationId}
          title="Location"
          inputAriaLabel="Location"
          placeholder="City or region"
          value={form.location}
          onChange={(value: string) => change({ location: value })}
          maxLength={PROFILE_LIMITS.location}
          size="medium"
        />

        <div className={styles.formField}>
          <span className={styles.rowTitle}>Birthday</span>
          <div className={styles.birthdayRow}>
            <select
              id={monthId}
              className={styles.select}
              aria-label="Birthday month"
              value={form.month}
              onChange={(e) => change({ month: e.target.value })}
            >
              <option value="">Month</option>
              {MONTH_NAMES.map((name, i) => (
                <option key={name} value={String(i + 1)}>
                  {name}
                </option>
              ))}
            </select>
            <select
              id={dayId}
              className={styles.select}
              aria-label="Birthday day"
              value={form.day}
              onChange={(e) => change({ day: e.target.value })}
            >
              <option value="">Day</option>
              {Array.from({ length: 31 }, (_, i) => (
                <option key={i + 1} value={String(i + 1)}>
                  {i + 1}
                </option>
              ))}
            </select>
            <Button
              kind="tertiary"
              size="small"
              disabled={!form.month && !form.day}
              onClick={() => change({ month: '', day: '' })}
            >
              Clear
            </Button>
          </div>
          <span className={styles.cardHint}>Only the day and month are shown, never the year.</span>
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <label htmlFor={timeId} className={styles.rowTitle}>
              Show my local time to people in my workspaces
            </label>
            <span className={styles.rowValue}>Uses the time zone below.</span>
          </div>
          <Toggle
            id={timeId}
            isSelected={form.showLocalTime}
            onChange={(on: boolean) => change({ showLocalTime: on })}
            aria-label="Show my local time to people in my workspaces"
            areLabelsHidden
          />
        </div>

        {showError ? (
          <p id={errorId} className={styles.errorText} role="alert">
            {parsed.message}
          </p>
        ) : null}

        <div className={styles.formActions}>
          <Button
            kind="primary"
            size="medium"
            type="submit"
            disabled={!dirty || !parsed.ok || saving}
            loading={saving}
          >
            Save
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}
