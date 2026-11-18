import { lookup } from 'node:dns/promises';
import { isIPv4, isIPv6 } from 'node:net';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage, RequestOptions } from 'node:http';
import type { ClientRequest } from 'node:http';
import { WEBHOOK_RESPONSE_MAX_CHARS } from '@atrium/shared';

/**
 * The SSRF guard for outgoing webhooks (P8 section 6). A webhook URL is chosen by a board owner, so
 * the server must never be talked into reaching its own network, the metadata server or localhost.
 *
 * - `checkWebhookUrl`: the static rules (https, port 443, no credentials, no IP literal in any
 *   spelling, no `localhost`, `*.internal`, `*.local` and similar). Used when the webhook is saved
 *   and again at delivery.
 * - `resolvePublicAddress`: resolves the host at delivery time; EVERY returned address must be public.
 * - `httpsTransport`: connects to the resolved address (pinned, so DNS rebinding between the check
 *   and the connect cannot help) while keeping the original Host header and TLS server name. It never
 *   follows redirects, times out after 5 seconds and reads at most 500 characters of the response.
 */

export const DELIVERY_TIMEOUT_MS = 5_000;
export const WEBHOOK_PORT = 443;

// -- Addresses ---------------------------------------------------------------------------------

type Cidr4 = readonly [a: number, b: number, c: number, d: number, bits: number];

/** IPv4 ranges that are not the public internet. */
const BLOCKED_V4: readonly Cidr4[] = [
  [0, 0, 0, 0, 8], // "this network", includes 0.0.0.0
  [10, 0, 0, 0, 8], // private
  [100, 64, 0, 0, 10], // carrier-grade NAT
  [127, 0, 0, 0, 8], // loopback
  [169, 254, 0, 0, 16], // link-local, includes the metadata server 169.254.169.254
  [172, 16, 0, 0, 12], // private
  [192, 0, 0, 0, 24], // IETF protocol assignments
  [192, 0, 2, 0, 24], // documentation
  [192, 31, 196, 0, 24], // AS112
  [192, 52, 193, 0, 24], // AMT
  [192, 88, 99, 0, 24], // 6to4 relay (deprecated)
  [192, 168, 0, 0, 16], // private
  [192, 175, 48, 0, 24], // AS112
  [198, 18, 0, 0, 15], // benchmarking
  [198, 51, 100, 0, 24], // documentation
  [203, 0, 113, 0, 24], // documentation
  [224, 0, 0, 0, 4], // multicast
  [240, 0, 0, 0, 4], // reserved, includes 255.255.255.255
];

const v4ToInt = (o: readonly number[]): number =>
  (((o[0] ?? 0) << 24) | ((o[1] ?? 0) << 16) | ((o[2] ?? 0) << 8) | (o[3] ?? 0)) >>> 0;

function inCidr4(octets: readonly number[], cidr: Cidr4): boolean {
  const bits = cidr[4];
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (v4ToInt(octets) & mask) >>> 0 === (v4ToInt(cidr) & mask) >>> 0;
}

/** Strict dotted-decimal IPv4 (what `net.isIPv4` accepts); null for any other spelling. */
export function parseIPv4(text: string): number[] | null {
  if (!isIPv4(text)) return null;
  return text.split('.').map(Number);
}

export function isPublicIPv4(octets: readonly number[]): boolean {
  return !BLOCKED_V4.some((cidr) => inCidr4(octets, cidr));
}

/** Eight 16-bit groups, or null when the text is not a valid IPv6 address (zone ids included). */
export function parseIPv6(text: string): number[] | null {
  if (!isIPv6(text) || text.includes('%')) return null;
  let head = text;
  let tail4: number[] = [];
  const lastColon = text.lastIndexOf(':');
  const last = text.slice(lastColon + 1);
  if (last.includes('.')) {
    const v4 = parseIPv4(last);
    if (!v4) return null;
    tail4 = [((v4[0] ?? 0) << 8) | (v4[1] ?? 0), ((v4[2] ?? 0) << 8) | (v4[3] ?? 0)];
    head = `${text.slice(0, lastColon + 1)}0:0`;
  }
  const halves = head.split('::');
  if (halves.length > 2) return null;
  const groups = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const g of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const first = groups(halves[0] ?? '');
  const second = halves.length === 2 ? groups(halves[1] ?? '') : [];
  if (!first || !second) return null;
  let all: number[];
  if (halves.length === 2) {
    const missing = 8 - first.length - second.length;
    if (missing < 1) return null;
    all = [...first, ...new Array<number>(missing).fill(0), ...second];
  } else {
    all = first;
  }
  if (all.length !== 8) return null;
  if (tail4.length === 2) all = [...all.slice(0, 6), ...tail4];
  return all;
}

const octetsOfGroups = (hi: number, lo: number): number[] => [
  hi >> 8,
  hi & 0xff,
  lo >> 8,
  lo & 0xff,
];

/** True only for an address on the public internet. Unparseable text is never public. */
export function isPublicAddress(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4) return isPublicIPv4(v4);
  const g = parseIPv6(address);
  if (!g) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  // IPv4-mapped (::ffff:a.b.c.d): judged by the embedded address.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return isPublicIPv4(octetsOfGroups(g6, g7));
  }
  // NAT64 well-known prefix 64:ff9b::/96: judged by the embedded address. The local-use prefix
  // 64:ff9b:1::/48 is never public.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPublicIPv4(octetsOfGroups(g6, g7));
  }
  // 6to4 (2002::/16): the next 32 bits are an IPv4 address; judged by it.
  if (g0 === 0x2002) return isPublicIPv4(octetsOfGroups(g1, g2));
  // Only global unicast 2000::/3 can be public. That drops ::/8 (unspecified, loopback, compatible),
  // 100::/64 discard, fc00::/7 unique local, fe80::/10 link-local, fec0::/10, ff00::/8 multicast.
  if ((g0 & 0xe000) !== 0x2000) return false;
  if (g0 === 0x2001) {
    if (g1 === 0) return false; // Teredo 2001::/32
    if (g1 === 0x0db8) return false; // documentation 2001:db8::/32
    if (g1 === 0x0002 && g2 === 0) return false; // benchmarking 2001:2::/48
    if (g1 >= 0x0010 && g1 <= 0x002f) return false; // ORCHID and similar 2001:10::/28, 2001:20::/28
  }
  if (g0 === 0x3fff && (g1 & 0xf000) === 0) return false; // documentation 3fff::/20
  return true;
}

// -- URL ---------------------------------------------------------------------------------------

/** Host names that always stay inside a network, whatever they resolve to. */
const BLOCKED_SUFFIXES = [
  'localhost',
  'internal',
  'local',
  'localdomain',
  'lan',
  'home.arpa',
  'intranet',
  'corp',
  'private',
] as const;

export type UrlCheck =
  { ok: true; url: URL; hostname: string; path: string } | { ok: false; reason: string };

const refuse = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/**
 * The static rules for a webhook URL. `new URL` already turns decimal, octal, hex and short IPv4
 * spellings (`2130706433`, `0177.1`, `0x7f.1`) into dotted form, so one dotted check covers them all.
 */
export function checkWebhookUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return refuse('That is not a valid web address.');
  }
  if (url.protocol !== 'https:') return refuse('Webhooks must use https://.');
  if (url.username || url.password)
    return refuse('The address must not contain a user name or password.');
  if (url.port !== '' && Number(url.port) !== WEBHOOK_PORT) {
    return refuse('Webhooks can only use the standard https port (443).');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return refuse('That is not a valid web address.');
  if (host.startsWith('[') || isIPv6(host) || isIPv4(host)) {
    return refuse('Use a host name, not an IP address.');
  }
  // Anything whose last label is numeric would be an IP spelling; the URL parser has rejected or
  // rewritten them all, so this is a second net.
  const labels = host.split('.');
  const lastLabel = labels[labels.length - 1] ?? '';
  if (/^(0x[0-9a-f]*|[0-9]+)$/i.test(lastLabel))
    return refuse('Use a host name, not an IP address.');
  if (labels.length < 2 || labels.some((l) => l === '')) {
    return refuse('Use a full public host name such as hooks.example.com.');
  }
  if (host.length > 253) return refuse('That host name is too long.');
  if (BLOCKED_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) {
    return refuse('That host name points at a private network.');
  }
  return { ok: true, url, hostname: host, path: `${url.pathname}${url.search}` };
}

// -- DNS ---------------------------------------------------------------------------------------

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

/** The system resolver: every address, in the order the system returns them. */
export const systemResolver: Resolver = async (hostname) => {
  const found = await lookup(hostname, { all: true, verbatim: true });
  return found.map((f) => ({ address: f.address, family: f.family === 6 ? 6 : 4 }));
};

export type ResolveResult =
  { ok: true; address: ResolvedAddress } | { ok: false; kind: 'dns' | 'blocked'; reason: string };

/**
 * Resolves `hostname` and requires EVERY returned address to be public (one private address among
 * public ones is refused). Returns one address to connect to, preferring IPv4.
 */
export async function resolvePublicAddress(
  hostname: string,
  resolver: Resolver = systemResolver,
): Promise<ResolveResult> {
  let found: ResolvedAddress[];
  try {
    found = await resolver(hostname);
  } catch {
    return { ok: false, kind: 'dns', reason: 'The host name could not be found.' };
  }
  if (found.length === 0) {
    return { ok: false, kind: 'dns', reason: 'The host name could not be found.' };
  }
  if (!found.every((f) => isPublicAddress(f.address))) {
    return {
      ok: false,
      kind: 'blocked',
      reason: 'That host name points at a private or reserved address.',
    };
  }
  const chosen = found.find((f) => f.family === 4) ?? (found[0] as ResolvedAddress);
  return { ok: true, address: chosen };
}

export interface DeliveryTarget {
  hostname: string;
  address: string;
  family: 4 | 6;
  /** Path and query, sent as the request target. */
  path: string;
}

export type PrepareResult =
  | { ok: true; target: DeliveryTarget }
  | { ok: false; kind: 'invalid' | 'dns' | 'blocked'; reason: string };

/** The static rules plus the DNS check: what runs on save and right before every delivery. */
export async function prepareDelivery(
  rawUrl: string,
  resolver: Resolver = systemResolver,
): Promise<PrepareResult> {
  const checked = checkWebhookUrl(rawUrl);
  if (!checked.ok) return { ok: false, kind: 'invalid', reason: checked.reason };
  const resolved = await resolvePublicAddress(checked.hostname, resolver);
  if (!resolved.ok) return resolved;
  return {
    ok: true,
    target: {
      hostname: checked.hostname,
      address: resolved.address.address,
      family: resolved.address.family,
      path: checked.path,
    },
  };
}

// -- Transport ---------------------------------------------------------------------------------

export interface TransportRequest {
  target: DeliveryTarget;
  /** Extra headers; `Host` and `Content-Length` are set by the transport. */
  headers: Record<string, string>;
  body: string;
}
export interface TransportResponse {
  status: number;
  /** At most `WEBHOOK_RESPONSE_MAX_CHARS` characters of the response body. */
  bodyText: string;
}
/** Sends one request. Resolves with the response (any status), rejects on network errors. */
export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

/** `https.request` options: `servername` belongs to the TLS layer, which `RequestOptions` omits. */
type HttpsOptions = RequestOptions & { servername?: string };
type RequestFn = (options: HttpsOptions) => ClientRequest;

/** Control characters out, so a hostile response can't smuggle terminal or log tricks. */
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
export const cleanText = (text: string): string => text.replace(CONTROL, ' ');

/**
 * The real transport. Connects to `target.address` (not the host name) with `servername` and the
 * `Host` header set to the original name, so the certificate is checked against the name the owner
 * typed while DNS can no longer change where the bytes go. `request` is injectable for tests.
 */
export function createHttpsTransport(
  options: {
    request?: RequestFn;
    timeoutMs?: number;
    port?: number;
  } = {},
): Transport {
  const send = options.request ?? (httpsRequest as RequestFn);
  const timeoutMs = options.timeoutMs ?? DELIVERY_TIMEOUT_MS;
  const port = options.port ?? WEBHOOK_PORT;
  return ({ target, headers, body }) =>
    new Promise<TransportResponse>((resolve, reject) => {
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        fn();
      };
      const req = send({
        host: target.address,
        family: target.family,
        port,
        method: 'POST',
        path: target.path,
        servername: target.hostname,
        headers: { ...headers, Host: target.hostname, 'Content-Length': Buffer.byteLength(body) },
        // Fresh connection, never a pooled one that was pinned to another address.
        agent: false,
        timeout: timeoutMs,
      });
      const deadline = setTimeout(() => {
        req.destroy(new Error('timeout'));
        done(() => reject(new Error('timeout')));
      }, timeoutMs);
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', (error) => done(() => reject(error)));
      req.on('response', (res: IncomingMessage) => {
        // Redirects are not followed: the status is reported as it is.
        const chunks: Buffer[] = [];
        let size = 0;
        const limit = WEBHOOK_RESPONSE_MAX_CHARS * 4; // enough bytes for the character limit
        const finish = () => {
          const text = Buffer.concat(chunks).toString('utf8').slice(0, WEBHOOK_RESPONSE_MAX_CHARS);
          done(() => resolve({ status: res.statusCode ?? 0, bodyText: cleanText(text) }));
        };
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          size += chunk.length;
          if (size >= limit) {
            res.destroy();
            finish();
          }
        });
        res.on('end', finish);
        res.on('close', finish);
        res.on('error', () => finish());
      });
      req.end(body);
    });
}

export const httpsTransport: Transport = createHttpsTransport();
