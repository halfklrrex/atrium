import { setGlobalOptions } from 'firebase-functions/v2';

// Must run before any function is declared (imported first in index.ts). Firestore is eur3, so keep
// compute in Europe.
//
// cpu 0.5: the regional Cloud Run quota (CpuAllocPerProjectRegion, europe-west1) is 20 vCPU and
// `firebase deploy` starts one instance per function in parallel for the health check, so 24
// functions at 1 vCPU overran it. At 0.5 vCPU a full deploy peaks around 12 vCPU.
// concurrency 1: Cloud Run requires it whenever cpu is below 1.
// A function that needs more CPU must override it explicitly in its own options.
// See docs/specs/BUG-deploy-cpu-quota.md.
export const GLOBAL_OPTIONS = {
  region: 'europe-west1',
  maxInstances: 10,
  cpu: 0.5,
  concurrency: 1,
} as const;

setGlobalOptions(GLOBAL_OPTIONS);
