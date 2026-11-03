-- 0020 undernet (KC-0273): each tenant's own /24 from the fleet's fixed address pool (SKY_TENANT_POOL), so the host-side
-- filter (sky/deploy/netfilter.sh, run by deploy.sh) can cover every tenant network at once without Sky ever being root.
-- Not destructive (one new nullable column and one index). A tenant row from before this has no index until the lokal
-- fleet next creates its network (fleet/tilstand.ts tildelUndernet assigns it then).
-- Invariants: an index is 1..255 (0 is the shared network of restore copies and release checks); two tenants that are
-- not `slettet` never hold the same index; a `slettet` tombstone keeps its number but no longer holds it.
ALTER TABLE flaade.tenant ADD COLUMN undernet integer CHECK (undernet BETWEEN 1 AND 255);
CREATE UNIQUE INDEX tenant_undernet_levende ON flaade.tenant(undernet) WHERE undernet IS NOT NULL AND tilstand <> 'slettet';
