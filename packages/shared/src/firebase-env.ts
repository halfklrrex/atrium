/**
 * The one place that names the Firestore database Atrium uses.
 *
 * Firestore is the **named** database `atrium-1` (location `eur3`, scheduled backups on), not the
 * project's `(default)` database (`nam5`, unused legacy). Every consumer imports this constant: the
 * web app, the Cloud Functions (admin client and trigger options), the scripts and the test seeds.
 * The only other place the id appears is `firebase.json`, which is JSON and cannot import it; a test
 * (`database-id.test.ts`) keeps the two equal and fails if the id or `(default)` appears anywhere
 * else in the source.
 */
export const FIRESTORE_DATABASE_ID = 'atrium-1';
