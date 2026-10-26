import { setGlobalOptions } from 'firebase-functions/v2';

// Must run before any function is declared (imported first in index.ts). Firestore is eur3, so keep
// compute in Europe.
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });
