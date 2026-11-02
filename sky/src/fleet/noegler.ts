// The fleet's seam to the tenant key envelope (KC-0181). fleet/ never imports hemmeligheder/: server.ts
// injects these three calls, so provisioning and deprovisioning stay testable with a fake and no tenant
// can be started on a code path that forgot the keys (the type is required, not optional).
export type FlaadeNoegler = {
  /** Makes the tenant's data key before its container exists. Idempotent. Throws when Sky has no master key. */
  sikr(slug: string): Promise<void>;
  /** After every (re)start: puts the tenant's `lager` key into the container's tmpfs (gone with each stop). */
  lever(slug: string, container: string): Promise<void>;
  /** Tenant deleted: the data key waits its 30 days, then the daily job destroys it. Idempotent. */
  markerSlettet(slug: string): Promise<void>;
};
