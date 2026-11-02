// Encryption at rest for a tenant's volume (KC-0212): a seam fed by KC-0181 (the tenant key). There is
// no root for Sky on kira-home's disks, so LUKS is not available there; until KC-0181 builds a key-fed
// implementation, beta volumes are NOT encrypted at rest, and every Klargjort says so (krypteret: false).

export type VolumenKryptering = {
  navn: string;
  krypteret: boolean;
  /** Extra `docker volume create` options for this tenant's volume (e.g. a driver that encrypts with its key). */
  volumenFlag(tenantId: string): Promise<string[]>;
};

export function ingenKryptering(): VolumenKryptering {
  return { navn: 'ingen (venter på tenant-nøglen fra KC-0181)', krypteret: false, async volumenFlag() { return []; } };
}
