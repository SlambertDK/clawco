// A software WebAuthn authenticator for tests: an EC P-256 key from node:crypto, attestation "none",
// assertions signed like a real authenticator. The library under test parses and verifies everything;
// this only builds the bytes a browser would hand over (CBOR via the library's own isoCBOR helper).
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

const b64 = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
const sha = (b: Uint8Array | string): Buffer => createHash('sha256').update(b).digest();

export type Autentifikator = {
  credentialId: Buffer;
  /** The signature counter the next assertion will carry (tests set it back to fake a clone). */
  taeller: number;
  registrer(o: PublicKeyCredentialCreationOptionsJSON, origin: string): RegistrationResponseJSON;
  logInd(o: PublicKeyCredentialRequestOptionsJSON, origin: string, rpId?: string): AuthenticationResponseJSON;
};

export function nyAutentifikator(): Autentifikator {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credentialId = randomBytes(16);
  let brugerId = '';

  function authData(rpId: string, flag: number, taeller: number, medNoegle: boolean): Buffer {
    const t = Buffer.alloc(4);
    t.writeUInt32BE(taeller);
    const dele = [sha(rpId), Buffer.from([flag]), t];
    if (medNoegle) {
      const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([
        [1, 2], [3, -7], [-1, 1],
        [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')],
      ]));
      const laengde = Buffer.alloc(2);
      laengde.writeUInt16BE(credentialId.length);
      dele.push(Buffer.alloc(16), laengde, credentialId, Buffer.from(cose));
    }
    return Buffer.concat(dele);
  }

  const klientData = (type: string, challenge: string, origin: string): Buffer =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

  const a: Autentifikator = {
    credentialId,
    taeller: 1,
    registrer(o, origin) {
      brugerId = o.user.id;
      // Flags: UP (0x01) | UV (0x04) | AT (0x40).
      const ad = authData(o.rp.id ?? new URL(origin).hostname, 0x45, 0, true);
      const att = isoCBOR.encode(new Map<string, string | Uint8Array | Map<string, string>>([['fmt', 'none'], ['attStmt', new Map<string, string>()], ['authData', ad]]));
      return {
        id: b64(credentialId), rawId: b64(credentialId), type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: b64(klientData('webauthn.create', o.challenge, origin)), attestationObject: b64(att), transports: ['internal'] },
      };
    },
    logInd(o, origin, rpId) {
      const ad = authData(rpId ?? o.rpId ?? new URL(origin).hostname, 0x05, a.taeller, false);
      a.taeller += 1;
      const cd = klientData('webauthn.get', o.challenge, origin);
      const signatur = sign('sha256', Buffer.concat([ad, sha(cd)]), privateKey as KeyObject);
      return {
        id: b64(credentialId), rawId: b64(credentialId), type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: b64(cd), authenticatorData: b64(ad), signature: b64(signatur), userHandle: brugerId },
      };
    },
  };
  return a;
}
