import { Button, Heading, Loader, Text } from '@vibe/core';
import type { ReactNode } from 'react';
import { AtriumMark } from './AtriumLogo';
import styles from './FullPage.module.css';

export function FullPageLoader({ label }: { label: string }) {
  return (
    <div className={styles.page} role="status" aria-live="polite">
      <Loader size="medium" />
      <Text type="text2" color="secondary">
        {label}
      </Text>
    </div>
  );
}

interface Action {
  text: string;
  onClick: () => void;
}

export function FullPageMessage({
  title,
  description,
  primary,
  secondary,
  children,
}: {
  title: string;
  description: string;
  primary?: Action;
  secondary?: Action;
  children?: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.message}>
        <AtriumMark size={40} />
        <Heading type="h2">{title}</Heading>
        <Text type="text1" color="secondary">
          {description}
        </Text>
        {children}
        <div className={styles.actions}>
          {primary ? <Button onClick={primary.onClick}>{primary.text}</Button> : null}
          {secondary ? (
            <Button kind="tertiary" onClick={secondary.onClick}>
              {secondary.text}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
