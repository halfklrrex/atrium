import { Button, Icon, type SubIcon } from '@vibe/core';
import {
  Add,
  Archive,
  Bolt,
  ButtonIndicator,
  Calendar,
  Comment,
  Edit,
  Email,
  Person,
} from '@vibe/icons';
import { Fragment } from 'react';
import {
  AVAILABILITY_LABELS,
  AVAILABILITY_TITLES,
  plainSentence,
  type CatalogTemplate,
  type TemplateIcon,
} from './starter-recipes';
import styles from './TemplateCard.module.css';

const ICONS: Record<TemplateIcon, SubIcon> = {
  plus: Add,
  bolt: Bolt,
  calendar: Calendar,
  chat: Comment,
  cursor: ButtonIndicator,
  archive: Archive,
  edit: Edit,
  person: Person,
  mail: Email,
};

/** The sentence with the asterisked words in bold. */
function Sentence({ sentence }: { sentence: string }) {
  return (
    <p className={styles.sentence}>
      {sentence.split('*').map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className={styles.key}>
            {part}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </p>
  );
}

export interface TemplateCardProps {
  template: CatalogTemplate;
  /** Only owners can use a template; everyone else browses. */
  isOwner: boolean;
  /** Shown under the sentence when the board has nothing this template fits. */
  noFit?: boolean;
  onUse: (template: CatalogTemplate) => void;
}

/** One template in the Create tab: icon tile, availability badge, sentence and a full-width button. */
export function TemplateCard({ template, isOwner, noFit, onUse }: TemplateCardProps) {
  const unavailable = template.availability !== 'ready';
  const plain = plainSentence(template);
  const longLabel =
    template.availability === 'ready' ? undefined : AVAILABILITY_TITLES[template.availability];
  return (
    <li className={styles.card} data-unavailable={unavailable || undefined}>
      <div className={styles.top}>
        <span className={styles.tile} aria-hidden="true">
          <Icon icon={ICONS[template.icon]} size={18} />
        </span>
        {unavailable ? (
          <span
            className={styles.badge}
            data-availability={template.availability}
            title={longLabel}
          >
            {AVAILABILITY_LABELS[template.availability]}
          </span>
        ) : null}
      </div>
      <Sentence sentence={template.sentence} />
      {noFit ? (
        <p className={styles.noFit} role="status">
          This board has no column or group that fits this template.
        </p>
      ) : null}
      <Button
        kind="secondary"
        size="small"
        className={styles.use}
        disabled={unavailable || !isOwner}
        aria-label={`Use template: ${plain}${longLabel ? ` (${longLabel})` : ''}`}
        onClick={() => onUse(template)}
      >
        {unavailable ? 'Coming soon' : 'Use template'}
      </Button>
    </li>
  );
}
