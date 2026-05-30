/**
 * Dependency-free WebAuthn / passkey helpers.
 *
 * Why hand-rolled: the official @simplewebauthn/browser package would be 8KB
 * gzipped for two function calls. The server returns the standard PublicKey*
 * options shape with base64url-encoded ArrayBuffers — we decode them, hand
 * them to ``navigator.credentials.create()`` / ``get()``, then serialise the
 * returned ``PublicKeyCredential`` back into JSON with base64url buffers.
 *
 * No third-party dependencies. Browser-only — guards prevent it from being
 * imported in a server-side render context.
 */

// ── base64url <-> ArrayBuffer codecs ────────────────────────────────────────

export function b64uToBuf(s: string): ArrayBuffer {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

export function bufToB64u(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Option decoding ─────────────────────────────────────────────────────────

interface DescriptorJSON {
  id: string;
  type: 'public-key';
  transports?: string[];
}

function decodeDescriptors(arr: DescriptorJSON[] | undefined): PublicKeyCredentialDescriptor[] | undefined {
  if (!arr) return undefined;
  return arr.map((d) => ({
    id: b64uToBuf(d.id),
    type: d.type,
    transports: d.transports as AuthenticatorTransport[] | undefined,
  }));
}

// ── Register flow ───────────────────────────────────────────────────────────

export async function register(
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const o = options as Record<string, any>;
  const publicKey = {
    ...(o as object),
    challenge: b64uToBuf(o.challenge),
    user: { ...o.user, id: b64uToBuf(o.user.id) },
    excludeCredentials: decodeDescriptors(o.excludeCredentials),
  } as PublicKeyCredentialCreationOptions;
  const cred = (await navigator.credentials.create({
    publicKey,
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('webauthn_register_cancelled');
  const att = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: bufToB64u(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufToB64u(att.clientDataJSON),
      attestationObject: bufToB64u(att.attestationObject),
      transports: typeof att.getTransports === 'function' ? att.getTransports() : [],
    },
    clientExtensionResults: cred.getClientExtensionResults(),
  };
}

// ── Authenticate flow ───────────────────────────────────────────────────────

export async function authenticate(
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const o = options as Record<string, any>;
  const publicKey: PublicKeyCredentialRequestOptions = {
    ...(o as object),
    challenge: b64uToBuf(o.challenge),
    allowCredentials: decodeDescriptors(o.allowCredentials),
  };
  const cred = (await navigator.credentials.get({
    publicKey,
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('webauthn_authenticate_cancelled');
  const ass = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: bufToB64u(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufToB64u(ass.clientDataJSON),
      authenticatorData: bufToB64u(ass.authenticatorData),
      signature: bufToB64u(ass.signature),
      userHandle: ass.userHandle ? bufToB64u(ass.userHandle) : null,
    },
    clientExtensionResults: cred.getClientExtensionResults(),
  };
}

export function isSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.credentials
  );
}
