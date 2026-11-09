import { ACTIVITY_LIMITS, INBOX_LIMITS, NOTIFICATION_LIMITS } from '@atrium/shared';

/**
 * The text of the privacy notice (`/privacy`), kept apart from the page so it is easy to review.
 * Every claim here is checked against the code and the infrastructure (PRIVACY-1,
 * docs/specs/PRIVACY-1-notice-and-complaints.md); change this file in the same PR as the behaviour.
 * No person's name, email or account URL belongs here (public repository).
 */

/** Shown at the top of the page; change it whenever the text changes. */
export const PRIVACY_LAST_UPDATED = '9 November 2026';

/** `purgeTrash` (functions/src/lib/purge.ts, `THIRTY_DAYS_MS`) removes deleted boards and items after 30 days. */
export const TRASH_RETENTION_DAYS = 30;
/** The Firestore scheduled backup of `atrium-1` keeps each backup 98 days (retention 8467200s). */
export const BACKUP_RETENTION_DAYS = 98;
/** Cloud Logging `_Default` bucket retention (`gcloud logging buckets describe _Default`). */
export const LOG_RETENTION_DAYS = 30;

export interface PrivacySection {
  id: string;
  heading: string;
  /** Plain paragraphs, shown before the list. */
  paragraphs?: string[];
  /** Bullet points. */
  items?: string[];
}

export const PRIVACY_ABOUT =
  'Atrium is a private, non-commercial work-management app run by one person for family and friends. It is invite-only, it is not a company and it does not sell anything. The people who run it are called "the site admins" below.';

export const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    id: 'stores',
    heading: 'What Atrium stores',
    items: [
      'From your Google account, when you sign in: your name, email address, profile photo link and an account id. Google tells Atrium nothing else. Firebase Authentication also keeps when your account was created and when you last signed in.',
      'What you create: workspaces, boards, items, updates, replies, likes, mentions, files and images, automations, dashboards, forms and views.',
      `A record of changes on each board (who changed what, with their name and photo), deleted after ${ACTIVITY_LIMITS.retentionDays} days.`,
      'Who is looking at a board right now (name and photo), gone after an hour.',
      'Your settings: theme, time zone, notification choices, favourite and recently visited boards.',
      `Notifications sent to you, deleted after ${NOTIFICATION_LIMITS.retentionDays} days.`,
      'Push notifications, only if you turn them on for a device: a device token, the browser and device type, and when it was last used.',
      `Messages you send to the site admins (feedback, appeals, complaints and data requests): the text, your name, email and photo link. Closed conversations are deleted after ${INBOX_LIMITS.retentionDays} days.`,
    ],
  },
  {
    id: 'who',
    heading: 'Who can see it',
    paragraphs: [
      "The members of a workspace see each other's name, photo and email address, and the boards they have access to. The site admins can see the list of accounts (name, email, status) and the messages you send them. Nobody else.",
    ],
  },
  {
    id: 'not',
    heading: 'What Atrium does not do',
    paragraphs: [
      'No ads, no analytics, no tracking, and no selling or sharing of your data. Atrium sends no email.',
    ],
  },
  {
    id: 'where',
    heading: 'Where it is kept',
    paragraphs: [
      "On Google Cloud and Firebase, in Europe: the database in Google's European multi-region (eur3), and files and server code in Belgium (europe-west1). The app's pages are served from Google's worldwide network. Push notifications pass through Firebase Cloud Messaging and your browser's push service (for example Apple's, Google's, Mozilla's or Microsoft's). Signing in happens on Google's own pages, and profile photos load from Google's servers, so your browser contacts Google when it shows a photo. Atrium's fonts are served by Atrium itself, not by Google Fonts.",
    ],
  },
  {
    id: 'device',
    heading: 'On your device',
    paragraphs: [
      "Atrium uses your browser's storage only to work, never to track you: to keep you signed in, to remember your theme and layout choices (sidebar, table settings, the last view of each board, recently used emoji, whether push is on for this device), and to keep a copy of the boards you opened so they load fast and work offline. That copy stays on the device until you clear your browser's site data, including after you sign out. A small background script (a service worker) shows push notifications and nothing else. There are no tracking cookies, so there is no cookie banner.",
    ],
  },
  {
    id: 'long',
    heading: 'How long it is kept',
    paragraphs: [
      `As long as your account exists, except: deleted items and boards are removed after ${TRASH_RETENTION_DAYS} days, the change record after ${ACTIVITY_LIMITS.retentionDays} days, notifications after ${NOTIFICATION_LIMITS.retentionDays} days, and closed messages to the site admins after ${INBOX_LIMITS.retentionDays} days. Daily backups keep a copy for up to ${BACKUP_RETENTION_DAYS} days, and server logs (which can include your account id and IP address) are kept for about ${LOG_RETENTION_DAYS} days.`,
    ],
  },
];

export const PRIVACY_CHANGES = 'If this notice changes, the date at the top changes too.';
