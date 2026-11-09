import { Heading } from '@vibe/core';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { BrandMark } from '../../components/BrandMark';
import {
  PRIVACY_ABOUT,
  PRIVACY_CHANGES,
  PRIVACY_LAST_UPDATED,
  PRIVACY_SECTIONS,
} from './privacy-content';
import styles from './Privacy.module.css';

/**
 * `/privacy`: the privacy notice. Public by design: it reads nothing from Firebase, so it shows
 * for signed-out, pending and blocked visitors alike.
 */
export function PrivacyPage() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Privacy · Atrium';
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className={styles.page}>
      <main className={styles.column}>
        <Link to="/" className={styles.brand}>
          <BrandMark size={28} />
          <span>Atrium</span>
        </Link>
        <header>
          <Heading type="h1" className={styles.heading}>
            Privacy
          </Heading>
          <p className={styles.updated}>Last updated: {PRIVACY_LAST_UPDATED}</p>
        </header>

        <section className={styles.section} aria-labelledby="privacy-about">
          <Heading type="h2" id="privacy-about" className={styles.sectionTitle}>
            About Atrium
          </Heading>
          <p className={styles.text}>{PRIVACY_ABOUT}</p>
        </section>

        {PRIVACY_SECTIONS.map((section) => (
          <section
            key={section.id}
            className={styles.section}
            aria-labelledby={`privacy-${section.id}`}
          >
            <Heading type="h2" id={`privacy-${section.id}`} className={styles.sectionTitle}>
              {section.heading}
            </Heading>
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph} className={styles.text}>
                {paragraph}
              </p>
            ))}
            {section.items ? (
              <ul className={styles.list}>
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}

        <section className={styles.section} aria-labelledby="privacy-choices">
          <Heading type="h2" id="privacy-choices" className={styles.sectionTitle}>
            Your choices
          </Heading>
          <p className={styles.text}>
            If you have an account, you can see and change your settings in{' '}
            <Link to="/settings/privacy">Settings</Link>. Downloading your data and deleting your
            account in Settings are coming; until then, and for anything else, send a message from{' '}
            <Link to="/feedback?new=complaint">Send feedback, Complaint or data request</Link>. Only
            the site admins read it, and they answer in the same place. You can also complain to
            your country&apos;s data protection authority.
          </p>
          <p className={styles.text}>
            Atrium is private and invite-only. If you cannot sign in, or your account is still
            waiting for approval, there is no form for you here: ask the person who invited you.
            Anyone who tried to sign in without an invitation has only their Google name, email
            address and photo link stored, in a waiting account that the site admins can approve or
            block.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="privacy-changes">
          <Heading type="h2" id="privacy-changes" className={styles.sectionTitle}>
            Changes
          </Heading>
          <p className={styles.text}>{PRIVACY_CHANGES}</p>
        </section>

        <footer className={styles.footer}>
          <Link to="/">Back to Atrium</Link>
        </footer>
      </main>
    </div>
  );
}
