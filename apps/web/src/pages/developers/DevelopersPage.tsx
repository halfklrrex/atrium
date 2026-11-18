import { Heading } from '@vibe/core';
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import { BrandMark } from '../../components/BrandMark';
import {
  API_BASE_URL,
  API_CALLS_PER_MINUTE,
  API_DAILY_CALLS,
  API_DAILY_WRITES,
  API_ERROR_CODES,
  API_ROUTES,
  CURL_INCOMING_HOOK,
  CURL_READ,
  CURL_WRITE,
  ERROR_EXAMPLE,
  IDEMPOTENCY_HOURS,
  INCOMING_HOOK_FACTS,
  INCOMING_HOOK_FIELDS,
  INCOMING_HOOK_PATH,
  INCOMING_HOOK_RESPONSE_EXAMPLE,
  INCOMING_HOOK_RESPONSES,
  OPENAPI_PATH,
  VERIFY_NODE,
  VERIFY_PYTHON,
  VERIFY_SHELL,
  WEBHOOK_FACTS,
  WEBHOOK_HEADERS,
  WEBHOOK_PAYLOAD_EXAMPLE,
  WEBHOOK_RETRY_LABELS,
  WEBHOOK_TIMESTAMP_TOLERANCE_MINUTES,
} from './developers-content';
import styles from './Developers.module.css';

const SECTIONS = [
  ['authentication', 'Authentication'],
  ['quick-start', 'Quick start'],
  ['routes', 'Routes'],
  ['errors', 'Errors'],
  ['limits', 'Limits'],
  ['idempotency', 'Idempotency'],
  ['webhooks', 'Webhooks'],
  ['incoming-webhooks', 'Incoming webhooks'],
  ['openapi', 'OpenAPI'],
] as const;

function Code({ label, children }: { label: string; children: string }) {
  return (
    <pre className={styles.code} tabIndex={0} aria-label={label}>
      <code>{children}</code>
    </pre>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className={styles.section} aria-labelledby={`dev-${id}`}>
      <Heading type="h2" id={`dev-${id}`} className={styles.sectionTitle}>
        <a href={`#dev-${id}`} className={styles.anchor}>
          {title}
        </a>
      </Heading>
      {children}
    </section>
  );
}

/** `/developers`: the public API and webhooks guide. Reads nothing from Firebase, so it shows signed out too. */
export function DevelopersPage() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Developers · Atrium';
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
        <header className={styles.header}>
          <Heading type="h1" className={styles.heading}>
            Developers
          </Heading>
          <p className={styles.text}>
            Use Atrium from scripts, Shortcuts and other tools with a personal token, and get a
            signed message at your own address when something changes on a board.
          </p>
          <nav aria-label="On this page">
            <ul className={styles.toc}>
              {SECTIONS.map(([id, title]) => (
                <li key={id}>
                  <a href={`#dev-${id}`}>{title}</a>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        <Section id="authentication" title="Authentication">
          <p className={styles.text}>
            Create a token in <Link to="/settings/account">Settings, Account, API tokens</Link>.
            Choose Read, or Read and Write, and optionally the workspaces it may use. The token is
            shown once; copy it then. Send it on every call as{' '}
            <code>Authorization: Bearer &lt;token&gt;</code>. A token acts as you, with your roles:
            it can never do more than you can in the app. Revoke it in the same card and it stops
            working right away.
          </p>
        </Section>

        <Section id="quick-start" title="Quick start">
          <p className={styles.text}>The base address is {API_BASE_URL}. List your workspaces:</p>
          <Code label="curl: read">{CURL_READ}</Code>
          <p className={styles.text}>Add an item to a board (needs a token with Write):</p>
          <Code label="curl: write">{CURL_WRITE}</Code>
        </Section>

        <Section id="routes" title="Routes">
          <p className={styles.text}>
            Every answer is JSON. Paths are relative to the base address; <code>{'{id}'}</code> is
            the board, workspace or item id. For items, <code>?board=</code> is an optional hint
            that skips the search for the item. Lists are paged with <code>limit</code> and{' '}
            <code>cursor</code>: pass the <code>nextCursor</code> you got back.
          </p>
          <div className={styles.tableBox} role="region" aria-label="Route table" tabIndex={0}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Method</th>
                  <th scope="col">Path</th>
                  <th scope="col">Needs</th>
                  <th scope="col">What it does</th>
                </tr>
              </thead>
              <tbody>
                {API_ROUTES.map((route) => (
                  <tr key={`${route.method} ${route.path}`}>
                    <td>
                      <code>{route.method}</code>
                    </td>
                    <td>
                      <code>{route.path}</code>
                    </td>
                    <td>{route.scope === 'write' ? 'Write' : 'Read'}</td>
                    <td>{route.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.text}>
            There is no hard delete and no way to change a board&apos;s structure through the API.
            Archive an item instead; you can restore it in the app.
          </p>
        </Section>

        <Section id="errors" title="Errors">
          <p className={styles.text}>
            A failed call answers with a status code and this shape. Branch on <code>code</code>,
            not on the message.
          </p>
          <Code label="error body">{ERROR_EXAMPLE}</Code>
          <div className={styles.tableBox} role="region" aria-label="Error code table" tabIndex={0}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Status</th>
                  <th scope="col">Meaning</th>
                </tr>
              </thead>
              <tbody>
                {API_ERROR_CODES.map((entry) => (
                  <tr key={entry.code}>
                    <td>
                      <code>{entry.code}</code>
                    </td>
                    <td>{entry.status}</td>
                    <td>{entry.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="limits" title="Limits">
          <ul className={styles.list}>
            <li>{API_CALLS_PER_MINUTE} calls a minute per token.</li>
            <li>
              {API_DAILY_CALLS.toLocaleString('en-US')} calls and{' '}
              {API_DAILY_WRITES.toLocaleString('en-US')} writes a day per token. The day ends at
              00:00 UTC.
            </li>
            <li>Request bodies up to 256 KB; at most 50 items per create call.</li>
          </ul>
          <p className={styles.text}>
            Going over answers 429 with <code>rate_limited</code> and a <code>Retry-After</code>{' '}
            header in seconds.
          </p>
        </Section>

        <Section id="idempotency" title="Idempotency">
          <p className={styles.text}>
            Add an <code>Idempotency-Key</code> header (1 to 64 letters, digits, - or _) to a POST
            so a retry cannot create twice. The first successful answer is kept for{' '}
            {IDEMPOTENCY_HOURS} hours; repeating the same request with the same key returns it again
            with <code>Idempotency-Replayed: true</code>. The same key with a different request is
            refused with 422, and a twin that arrives while the first is still running gets 409.
            Failed requests are not stored, so you can retry them.
          </p>
        </Section>

        <Section id="webhooks" title="Webhooks">
          <p className={styles.text}>
            Webhooks are set up per board by its owners, in Board menu &gt; Integrations: an
            address, and which events to send. Atrium then sends a POST with a JSON body (up to{' '}
            {WEBHOOK_FACTS.payloadMaxKb} KB) every time one of those events happens. The address
            must start with https://.
          </p>
          <Heading type="h3" className={styles.subTitle}>
            Payload
          </Heading>
          <Code label="webhook payload">{WEBHOOK_PAYLOAD_EXAMPLE}</Code>
          <Heading type="h3" className={styles.subTitle}>
            Headers
          </Heading>
          <dl className={styles.defs}>
            {WEBHOOK_HEADERS.map((header) => (
              <div key={header.name} className={styles.def}>
                <dt>
                  <code>{header.name}</code>
                </dt>
                <dd>{header.value}</dd>
              </div>
            ))}
          </dl>
          <Heading type="h3" className={styles.subTitle}>
            Verify the signature
          </Heading>
          <p className={styles.text}>
            Each webhook has a secret that starts with <code>whsec_</code>. Atrium signs{' '}
            <code>&lt;timestamp&gt;.&lt;body&gt;</code> with HMAC-SHA256 and sends the hex digest as{' '}
            <code>Atrium-Signature: {WEBHOOK_FACTS.signatureVersion}=&lt;hex&gt;</code>. Compute it
            over the raw body, compare in constant time, and reject a timestamp more than{' '}
            {WEBHOOK_TIMESTAMP_TOLERANCE_MINUTES} minutes old.
          </p>
          <Code label="verify in Node">{VERIFY_NODE}</Code>
          <Code label="verify in Python">{VERIFY_PYTHON}</Code>
          <Code label="verify in a shell">{VERIFY_SHELL}</Code>
          <Heading type="h3" className={styles.subTitle}>
            Retries
          </Heading>
          <p className={styles.text}>
            Answer with any 2xx within a few seconds. A timeout, a network error, 408, 429 or a 5xx
            is retried after {WEBHOOK_RETRY_LABELS.join(', ')} (five attempts in all). Other 4xx
            answers and redirects are not retried. After {WEBHOOK_FACTS.disableAfterFailures} failed
            deliveries in a row Atrium switches the webhook off and tells the board owner. Use{' '}
            <code>Atrium-Event-Id</code> to ignore a delivery you have already handled.
          </p>
        </Section>

        <Section id="incoming-webhooks" title="Incoming webhooks">
          <p className={styles.text}>
            An incoming webhook is a secret address that creates one item on a board when something
            sends it a POST. Use it from a form tool, a payment service or a script that cannot hold
            a personal token. Board owners create the address in Board menu &gt; Integrations. It is
            shown once, so copy it then; treat the whole address like a password. You can turn it
            off, replace its secret or delete it in the same place. Items it creates belong to the
            person who made the hook, and the activity log shows them as{' '}
            <code>Webhook: &lt;name&gt;</code>. The route is <code>POST {INCOMING_HOOK_PATH}</code>{' '}
            on the site root, not under the base address above, and it needs no Authorization
            header.
          </p>
          <Code label="curl: incoming webhook">{CURL_INCOMING_HOOK}</Code>
          <Heading type="h3" className={styles.subTitle}>
            Body
          </Heading>
          <p className={styles.text}>
            Send JSON. Other keys are refused. Locked columns, calculated columns and columns Atrium
            fills in itself (such as files and time tracking) cannot be set.
          </p>
          <dl className={styles.defs}>
            {INCOMING_HOOK_FIELDS.map((field) => (
              <div key={field.name} className={styles.def}>
                <dt>
                  <code>{field.name}</code>
                </dt>
                <dd>{field.meaning}</dd>
              </div>
            ))}
          </dl>
          <Heading type="h3" className={styles.subTitle}>
            Answers
          </Heading>
          <Code label="incoming webhook answer">{INCOMING_HOOK_RESPONSE_EXAMPLE}</Code>
          <div
            className={styles.tableBox}
            role="region"
            aria-label="Incoming webhook answers"
            tabIndex={0}
          >
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Meaning</th>
                </tr>
              </thead>
              <tbody>
                {INCOMING_HOOK_RESPONSES.map((entry) => (
                  <tr key={entry.status}>
                    <td>{entry.status}</td>
                    <td>{entry.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Heading type="h3" className={styles.subTitle}>
            Limits and retries
          </Heading>
          <ul className={styles.list}>
            <li>
              {INCOMING_HOOK_FACTS.callsPerMinute} calls a minute and{' '}
              {INCOMING_HOOK_FACTS.dailyCalls.toLocaleString('en-US')} a day per hook. The day ends
              at 00:00 UTC.
            </li>
            <li>The body can be {INCOMING_HOOK_FACTS.bodyMaxKb} KB at most.</li>
            <li>
              Add an <code>Idempotency-Key</code> header, as above, so a retry cannot create the
              item twice. It is kept per hook for {IDEMPOTENCY_HOURS} hours.
            </li>
          </ul>
        </Section>

        <Section id="openapi" title="OpenAPI">
          <p className={styles.text}>
            The machine-readable description of every route is{' '}
            <a href={OPENAPI_PATH}>{OPENAPI_PATH}</a> (OpenAPI 3.1). It needs no token. It also
            describes the incoming webhook route.
          </p>
        </Section>

        <footer className={styles.footer}>
          <Link to="/">Back to Atrium</Link>
        </footer>
      </main>
    </div>
  );
}
