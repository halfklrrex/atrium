import { describe, expect, it } from 'vitest';
import { GLOBAL_OPTIONS } from './global-options';

// Guards the fix in docs/specs/BUG-deploy-cpu-quota.md: 0.5 vCPU per function keeps a parallel
// deploy under the 20 vCPU regional Cloud Run quota. Below 1 vCPU, concurrency must be 1.
describe('GLOBAL_OPTIONS', () => {
  it('keeps functions small enough for the regional CPU quota', () => {
    expect(GLOBAL_OPTIONS.region).toBe('europe-west1');
    expect(GLOBAL_OPTIONS.cpu).toBe(0.5);
    expect(GLOBAL_OPTIONS.concurrency).toBe(1);
    expect(GLOBAL_OPTIONS.maxInstances).toBe(10);
  });
});
