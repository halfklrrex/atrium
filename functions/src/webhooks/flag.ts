/**
 * The kill switch (P8 section 6): `WEBHOOKS_ENABLED=true` in `functions/.env.atrium-board` switches
 * outgoing webhooks on. While it is anything else the callables answer `failed-precondition`, the
 * producer queues nothing and the sweep returns at once. Read on every call, never cached.
 */
export const webhooksEnabled = (): boolean => process.env.WEBHOOKS_ENABLED === 'true';
