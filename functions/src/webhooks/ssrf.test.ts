import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
  checkWebhookUrl,
  cleanText,
  createHttpsTransport,
  isPublicAddress,
  parseIPv6,
  prepareDelivery,
  resolvePublicAddress,
  type DeliveryTarget,
  type Resolver,
} from './ssrf';

const resolverOf =
  (...addresses: string[]): Resolver =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

describe('isPublicAddress: IPv4', () => {
  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.15.255.255',
    '172.32.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '11.0.0.1',
    '192.169.0.1',
    '198.17.255.255',
    '198.20.0.1',
    '223.255.255.255',
  ])('accepts %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    ['this network', '0.0.0.0'],
    ['this network', '0.255.255.255'],
    ['private 10/8', '10.0.0.1'],
    ['private 10/8', '10.255.255.255'],
    ['CGNAT', '100.64.0.1'],
    ['CGNAT', '100.127.255.255'],
    ['loopback', '127.0.0.1'],
    ['loopback', '127.255.255.254'],
    ['link-local', '169.254.0.1'],
    ['metadata server', '169.254.169.254'],
    ['private 172.16/12', '172.16.0.1'],
    ['private 172.16/12', '172.31.255.255'],
    ['IETF assignments', '192.0.0.1'],
    ['documentation', '192.0.2.10'],
    ['6to4 relay', '192.88.99.1'],
    ['private 192.168/16', '192.168.1.1'],
    ['benchmarking', '198.18.0.1'],
    ['benchmarking', '198.19.255.255'],
    ['documentation', '198.51.100.7'],
    ['documentation', '203.0.113.7'],
    ['multicast', '224.0.0.1'],
    ['multicast', '239.255.255.255'],
    ['reserved', '240.0.0.1'],
    ['broadcast', '255.255.255.255'],
  ])('rejects %s %s', (_label, address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

describe('isPublicAddress: IPv6', () => {
  it.each(['2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4001:81b::200e'])(
    'accepts %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it.each([
    ['unspecified', '::'],
    ['loopback', '::1'],
    ['loopback, long form', '0:0:0:0:0:0:0:1'],
    ['unique local', 'fc00::1'],
    ['unique local', 'fd12:3456:789a::1'],
    ['link-local', 'fe80::1'],
    ['link-local', 'febf::1'],
    ['site-local', 'fec0::1'],
    ['multicast', 'ff02::1'],
    ['discard', '100::1'],
    ['IPv4-compatible', '::8.8.8.8'],
    ['IPv4-compatible hex', '::808:808'],
    ['documentation', '2001:db8::1'],
    ['Teredo', '2001:0:4136:e378:8000:63bf:3fff:fdd2'],
    ['benchmarking', '2001:2::1'],
    ['ORCHID', '2001:10::1'],
    ['documentation', '3fff::1'],
    ['NAT64 local-use', '64:ff9b:1::1'],
    ['outside global unicast', '4000::1'],
    ['zone id', 'fe80::1%eth0'],
    ['not an address', 'not-an-ip'],
    ['empty', ''],
  ])('rejects %s %s', (_label, address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    ['mapped loopback', '::ffff:127.0.0.1'],
    ['mapped loopback hex', '::ffff:7f00:1'],
    ['mapped private', '::ffff:10.0.0.1'],
    ['mapped metadata', '::ffff:169.254.169.254'],
    ['mapped metadata hex', '::ffff:a9fe:a9fe'],
    ['mapped private, expanded', '0:0:0:0:0:ffff:c0a8:101'],
    ['NAT64 of loopback', '64:ff9b::127.0.0.1'],
    ['NAT64 of private hex', '64:ff9b::a00:1'],
    ['NAT64 of metadata', '64:ff9b::a9fe:a9fe'],
    ['6to4 of loopback', '2002:7f00:1::1'],
    ['6to4 of 10.0.0.1', '2002:a00:1::'],
    ['6to4 of 192.168.1.1', '2002:c0a8:101::1'],
    ['6to4 of metadata', '2002:a9fe:a9fe::1'],
  ])('rejects %s %s (private IPv4 inside)', (_label, address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it('accepts the mapped, NAT64 and 6to4 forms of a public IPv4 address', () => {
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true);
    expect(isPublicAddress('64:ff9b::808:808')).toBe(true);
    expect(isPublicAddress('2002:808:808::1')).toBe(true);
  });

  it('parses compressed, expanded and embedded-IPv4 forms', () => {
    expect(parseIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('1::')).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIPv6('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parseIPv6('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x102, 0x304]);
    expect(parseIPv6('1:2::7:8')).toEqual([1, 2, 0, 0, 0, 0, 7, 8]);
    expect(parseIPv6('1:2:3')).toBeNull();
    expect(parseIPv6('1::2::3')).toBeNull();
    expect(parseIPv6('g::1')).toBeNull();
  });
});

describe('checkWebhookUrl: accepted', () => {
  it.each([
    'https://hooks.example.com/atrium',
    'https://hooks.example.com:443/atrium?x=1',
    'https://EXAMPLE.com/',
    'https://a.b.c.example.co.uk/path/to/it',
    'https://xn--bcher-kva.example/hook',
    'https://example.com./x',
  ])('accepts %s', (raw) => {
    expect(checkWebhookUrl(raw).ok).toBe(true);
  });

  it('returns the host name without a trailing dot and the path with its query', () => {
    const r = checkWebhookUrl('https://Hooks.Example.com:443/a/b?x=1#frag');
    expect(r).toMatchObject({ ok: true, hostname: 'hooks.example.com', path: '/a/b?x=1' });
  });
});

describe('checkWebhookUrl: refused', () => {
  it.each([
    ['plain http', 'http://example.com/x'],
    ['ftp', 'ftp://example.com/x'],
    ['file', 'file:///etc/passwd'],
    ['javascript', 'javascript:alert(1)'],
    ['no scheme', 'example.com/x'],
    ['empty', ''],
    ['garbage', 'https://'],
    ['port 8443', 'https://example.com:8443/x'],
    ['port 80', 'https://example.com:80/x'],
    ['port 444', 'https://example.com:444/'],
    ['user name', 'https://user@example.com/'],
    ['user and password', 'https://user:pass@example.com/'],
    ['password only', 'https://:pass@example.com/'],
    ['localhost', 'https://localhost/'],
    ['LOCALHOST', 'https://LOCALHOST/'],
    ['localhost dot', 'https://localhost./'],
    ['sub.localhost', 'https://app.localhost/'],
    ['.internal', 'https://db.internal/'],
    ['metadata server name', 'https://metadata.google.internal/computeMetadata/v1/'],
    ['.local', 'https://printer.local/'],
    ['.localdomain', 'https://host.localdomain/'],
    ['.lan', 'https://nas.lan/'],
    ['.home.arpa', 'https://nas.home.arpa/'],
    ['single label', 'https://intranet/'],
    ['single label with a dot', 'https://intranet./'],
    ['IPv4 literal', 'https://8.8.8.8/'],
    ['IPv4 loopback', 'https://127.0.0.1/'],
    ['IPv4 metadata', 'https://169.254.169.254/latest/meta-data/'],
    ['IPv4 private', 'https://10.0.0.5/'],
    ['IPv4 decimal', 'https://2130706433/'],
    ['IPv4 decimal metadata', 'https://2852039166/'],
    ['IPv4 octal', 'https://0177.0.0.1/'],
    ['IPv4 full octal', 'https://017700000001/'],
    ['IPv4 hex', 'https://0x7f000001/'],
    ['IPv4 hex dotted', 'https://0x7f.0x0.0x0.0x1/'],
    ['IPv4 short form', 'https://127.1/'],
    ['IPv4 short form 10', 'https://10.1/'],
    ['IPv4 mixed spelling', 'https://0xa9.254.0251.0376/'],
    ['IPv4 zero', 'https://0/'],
    ['IPv4 0.0.0.0', 'https://0.0.0.0/'],
    ['IPv4 with a trailing dot', 'https://127.0.0.1./'],
    ['too many numeric labels', 'https://1.2.3.4.5/'],
    ['IPv6 loopback', 'https://[::1]/'],
    ['IPv6 public', 'https://[2606:4700:4700::1111]/'],
    ['IPv6 mapped', 'https://[::ffff:127.0.0.1]/'],
    ['IPv6 mapped hex', 'https://[::ffff:7f00:1]/'],
    ['IPv6 ULA', 'https://[fd00::1]/'],
    ['IPv6 with port', 'https://[::1]:443/'],
    ['empty label', 'https://a..example.com/'],
  ])('refuses %s: %s', (_label, raw) => {
    expect(checkWebhookUrl(raw).ok).toBe(false);
  });

  it('gives a readable reason', () => {
    const r = checkWebhookUrl('http://example.com');
    expect(r).toEqual({ ok: false, reason: 'Webhooks must use https://.' });
  });
});

describe('resolvePublicAddress', () => {
  it('returns a public address, preferring IPv4', async () => {
    const r = await resolvePublicAddress(
      'example.com',
      resolverOf('2606:4700:4700::1111', '93.184.216.34'),
    );
    expect(r).toEqual({ ok: true, address: { address: '93.184.216.34', family: 4 } });
  });

  it('uses IPv6 when there is no IPv4', async () => {
    const r = await resolvePublicAddress('example.com', resolverOf('2606:4700:4700::1111'));
    expect(r).toMatchObject({ ok: true, address: { family: 6 } });
  });

  it.each([
    ['one private among public', ['93.184.216.34', '10.0.0.1']],
    ['a private first', ['192.168.0.9', '93.184.216.34']],
    ['IPv6 loopback among public', ['93.184.216.34', '::1']],
    ['only loopback', ['127.0.0.1']],
    ['metadata server', ['169.254.169.254']],
    ['mapped private', ['::ffff:10.0.0.1']],
    ['garbage', ['not-an-ip']],
    ['an empty-looking address', ['']],
  ])('refuses when %s is returned', async (_label, addresses) => {
    const r = await resolvePublicAddress('example.com', resolverOf(...addresses));
    expect(r).toMatchObject({ ok: false, kind: 'blocked' });
  });

  it('reports a failed or empty lookup as dns', async () => {
    const failing: Resolver = async () => {
      throw new Error('ENOTFOUND');
    };
    expect(await resolvePublicAddress('nope.example.com', failing)).toMatchObject({
      ok: false,
      kind: 'dns',
    });
    expect(await resolvePublicAddress('nope.example.com', async () => [])).toMatchObject({
      ok: false,
      kind: 'dns',
    });
  });
});

describe('prepareDelivery', () => {
  it('returns the pinned target', async () => {
    const r = await prepareDelivery('https://Hooks.example.com/a?b=1', resolverOf('93.184.216.34'));
    expect(r).toEqual({
      ok: true,
      target: {
        hostname: 'hooks.example.com',
        address: '93.184.216.34',
        family: 4,
        path: '/a?b=1',
      },
    });
  });

  it('does not even resolve a URL the static rules refuse', async () => {
    const resolver = vi.fn(resolverOf('93.184.216.34'));
    const r = await prepareDelivery('https://localhost/', resolver);
    expect(r).toMatchObject({ ok: false, kind: 'invalid' });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('refuses a name that resolves to a private address, at any call (rebinding)', async () => {
    let answer = ['93.184.216.34'];
    const resolver: Resolver = async () =>
      answer.map((address) => ({ address, family: 4 as const }));
    expect((await prepareDelivery('https://rebind.example.com/', resolver)).ok).toBe(true);
    answer = ['127.0.0.1'];
    expect(await prepareDelivery('https://rebind.example.com/', resolver)).toMatchObject({
      ok: false,
      kind: 'blocked',
    });
  });
});

// -- The transport -----------------------------------------------------------------------------

const TARGET: DeliveryTarget = {
  hostname: 'hooks.example.com',
  address: '93.184.216.34',
  family: 4,
  path: '/x?y=1',
};

class FakeResponse extends EventEmitter {
  statusCode: number;
  destroyed = false;
  constructor(statusCode: number) {
    super();
    this.statusCode = statusCode;
  }
  destroy() {
    this.destroyed = true;
    this.emit('close');
  }
}
class FakeRequest extends EventEmitter {
  written = '';
  destroyed: Error | boolean = false;
  end(body: string) {
    this.written = body;
  }
  destroy(error?: Error) {
    this.destroyed = error ?? true;
    if (error) this.emit('error', error);
  }
}

function fakeRequestFn() {
  const calls: RequestOptions[] = [];
  const req = new FakeRequest();
  const fn = (options: RequestOptions) => {
    calls.push(options);
    return req as unknown as ClientRequest;
  };
  return { fn, calls, req };
}

describe('createHttpsTransport', () => {
  it('connects to the resolved address with the original Host header and TLS server name', async () => {
    const { fn, calls, req } = fakeRequestFn();
    const send = createHttpsTransport({ request: fn });
    const pending = send({
      target: TARGET,
      headers: { 'Content-Type': 'application/json' },
      body: '{"a":1}',
    });
    const res = new FakeResponse(200);
    req.emit('response', res as unknown as IncomingMessage);
    res.emit('data', Buffer.from('ok'));
    res.emit('end');
    expect(await pending).toEqual({ status: 200, bodyText: 'ok' });
    const options = calls[0] as RequestOptions & { servername?: string };
    expect(options.host).toBe('93.184.216.34');
    expect(options.family).toBe(4);
    expect(options.port).toBe(443);
    expect(options.servername).toBe('hooks.example.com');
    expect(options.method).toBe('POST');
    expect(options.path).toBe('/x?y=1');
    expect(options.agent).toBe(false);
    expect(options.timeout).toBe(5000);
    expect(options.headers).toMatchObject({
      Host: 'hooks.example.com',
      'Content-Type': 'application/json',
      'Content-Length': 7,
    });
    expect(req.written).toBe('{"a":1}');
  });

  it('does not follow a redirect: the 3xx is returned as it is', async () => {
    const { fn, calls, req } = fakeRequestFn();
    const pending = createHttpsTransport({ request: fn })({
      target: TARGET,
      headers: {},
      body: '{}',
    });
    const res = new FakeResponse(302);
    req.emit('response', res as unknown as IncomingMessage);
    res.emit('end');
    expect(await pending).toEqual({ status: 302, bodyText: '' });
    expect(calls).toHaveLength(1);
  });

  it('reads at most 500 characters of the body and stops reading', async () => {
    const { fn, req } = fakeRequestFn();
    const pending = createHttpsTransport({ request: fn })({
      target: TARGET,
      headers: {},
      body: '{}',
    });
    const res = new FakeResponse(500);
    req.emit('response', res as unknown as IncomingMessage);
    res.emit('data', Buffer.from('a'.repeat(1500)));
    res.emit('data', Buffer.from('b'.repeat(1500)));
    const out = await pending;
    expect(out.bodyText).toBe('a'.repeat(500));
    expect(res.destroyed).toBe(true);
  });

  it('strips control characters from the body text', async () => {
    const { fn, req } = fakeRequestFn();
    const pending = createHttpsTransport({ request: fn })({
      target: TARGET,
      headers: {},
      body: '{}',
    });
    const res = new FakeResponse(400);
    req.emit('response', res as unknown as IncomingMessage);
    res.emit('data', Buffer.from('bad\u001b[31m\u0000thing\r\nnext'));
    res.emit('end');
    expect((await pending).bodyText).toBe('bad [31m thing \nnext');
  });

  it('rejects on a network error', async () => {
    const { fn, req } = fakeRequestFn();
    const pending = createHttpsTransport({ request: fn })({
      target: TARGET,
      headers: {},
      body: '{}',
    });
    req.emit('error', new Error('ECONNREFUSED'));
    await expect(pending).rejects.toThrow('ECONNREFUSED');
  });

  it('gives up after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const { fn, req } = fakeRequestFn();
      const pending = createHttpsTransport({ request: fn })({
        target: TARGET,
        headers: {},
        body: '{}',
      });
      const caught = pending.catch((e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(5001);
      expect(await caught).toBe('timeout');
      expect(req.destroyed).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleanText keeps tabs and newlines', () => {
    expect(cleanText('a\tb\nc\u0007d')).toBe('a\tb\nc d');
  });
});
