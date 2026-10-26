import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { buildEmulatorConfig } from './emulator-config.mjs';
import { BASE_PORTS, portOffset, ports, repoRoot } from './env.mjs';

const OFFSETS = Array.from({ length: 21 }, (_, i) => i * 10); // 0, 10, ..., 200

test('ports are base + offset', () => {
  assert.equal(ports(0).auth, 9099);
  assert.equal(ports(10).firestore, 8090);
  assert.equal(ports(100).vite, 5273);
});

test('no two working copies share a port (offsets 0, 10, ..., 200)', () => {
  const owner = new Map();
  for (const offset of OFFSETS) {
    for (const [service, port] of Object.entries(ports(offset))) {
      const taken = owner.get(port);
      assert.equal(taken, undefined, `port ${port}: ${service}@${offset} clashes with ${taken}`);
      owner.set(port, `${service}@${offset}`);
    }
  }
});

test('ATRIUM_PORT_OFFSET is read from the environment and validated', () => {
  const saved = process.env.ATRIUM_PORT_OFFSET;
  try {
    process.env.ATRIUM_PORT_OFFSET = '30';
    assert.equal(portOffset(), 30);
    process.env.ATRIUM_PORT_OFFSET = 'abc';
    assert.throws(() => portOffset(), /ATRIUM_PORT_OFFSET/);
    process.env.ATRIUM_PORT_OFFSET = '-5';
    assert.throws(() => portOffset(), /ATRIUM_PORT_OFFSET/);
  } finally {
    if (saved === undefined) delete process.env.ATRIUM_PORT_OFFSET;
    else process.env.ATRIUM_PORT_OFFSET = saved;
  }
});

test('generated emulator config shifts every port and keeps only the app hosting site', () => {
  const config = buildEmulatorConfig(ports(100));
  const e = config.emulators;
  assert.equal(e.auth.port, BASE_PORTS.auth + 100);
  assert.equal(e.firestore.port, BASE_PORTS.firestore + 100);
  assert.equal(e.firestore.websocketPort, BASE_PORTS.firestoreWebsocket + 100);
  assert.equal(e.functions.port, BASE_PORTS.functions + 100);
  assert.equal(e.storage.port, BASE_PORTS.storage + 100);
  assert.equal(e.hosting.port, BASE_PORTS.hosting + 100);
  assert.equal(e.ui.port, BASE_PORTS.ui + 100);
  assert.equal(e.hub.port, BASE_PORTS.hub + 100);
  assert.equal(e.logging.port, BASE_PORTS.logging + 100);
  assert.equal(e.eventarc.port, BASE_PORTS.eventarc + 100);
  assert.deepEqual(
    config.hosting.map((site) => site.target),
    ['app'],
  );
});

test('firebase.json emulator ports match the base ports', () => {
  const e = JSON.parse(readFileSync(resolve(repoRoot, 'firebase.json'), 'utf8')).emulators;
  assert.equal(e.auth.port, BASE_PORTS.auth);
  assert.equal(e.firestore.port, BASE_PORTS.firestore);
  assert.equal(e.functions.port, BASE_PORTS.functions);
  assert.equal(e.storage.port, BASE_PORTS.storage);
  assert.equal(e.hosting.port, BASE_PORTS.hosting);
  assert.equal(e.ui.port, BASE_PORTS.ui);
});
