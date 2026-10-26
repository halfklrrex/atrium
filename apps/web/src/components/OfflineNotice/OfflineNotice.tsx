import { AlertBanner, AlertBannerText } from '@vibe/core';
import { useState } from 'react';
import styles from './OfflineNotice.module.css';
import { useOnlineStatus } from './useOnlineStatus';

export interface OfflineNoticeProps {
  message?: string;
  isCloseable?: boolean;
}

const DEFAULT_OFFLINE_MESSAGE = "You're offline. Changes will sync when you reconnect.";

export function OfflineNotice({
  message = DEFAULT_OFFLINE_MESSAGE,
  isCloseable = false,
}: OfflineNoticeProps) {
  const isOnline = useOnlineStatus();
  const [dismissed, setDismissed] = useState(false);
  const [prevOnline, setPrevOnline] = useState(isOnline);

  // Reset dismissed state whenever network transitions back online
  if (prevOnline !== isOnline) {
    setPrevOnline(isOnline);
    if (isOnline) {
      setDismissed(false);
    }
  }

  if (isOnline || dismissed) {
    return null;
  }

  return (
    <div
      className={styles.noticeContainer}
      role="status"
      aria-live="polite"
      data-testid="offline-notice"
    >
      <AlertBanner
        backgroundColor="warning"
        isCloseHidden={!isCloseable}
        onClose={() => setDismissed(true)}
        className={styles.banner}
        aria-label="Offline status notification"
      >
        <AlertBannerText text={message} />
      </AlertBanner>
    </div>
  );
}
