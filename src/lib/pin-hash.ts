// The one place staff PINs are hashed and checked.
// New format: pin_hash = "pbkdf2-sha256$<iterations>$<64 hex>", with the random salt kept in pin_salt.
// Old format: pin_hash = 64 hex characters, SHA-256(pin_salt + pin). Still accepted, and upgraded after a correct PIN.

/** Cost of one PIN check. Kept modest on purpose: a Worker has a small CPU budget per request. Raise it here and every
 * hash upgrades itself on its owner's next correct sign-in. */
export const PIN_ITERATIONS = 20_000;

const NEW_PREFIX = "pbkdf2-sha256";
const MIN_ITERATIONS = 1_000;
const MAX_ITERATIONS = 1_000_000;

const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function legacyHash(salt: string, pin: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + pin)));
}

async function pbkdf2Hex(salt: string, pin: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations },
    key,
    256,
  );
  return hex(bits);
}

/** A fresh random salt and the new-format hash for a PIN. */
export async function hashPin(pin: string): Promise<{ pin_salt: string; pin_hash: string }> {
  const pin_salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const pin_hash = `${NEW_PREFIX}$${PIN_ITERATIONS}$${await pbkdf2Hex(pin_salt, pin, PIN_ITERATIONS)}`;
  return { pin_salt, pin_hash };
}

export type PinCheck = { ok: boolean; needsUpgrade: boolean };

/** Checks a PIN against a stored hash of either format. Anything unreadable is simply "not ok". */
export async function verifyPin(pin: string, salt: string | null | undefined, stored: string | null | undefined): Promise<PinCheck> {
  const bad: PinCheck = { ok: false, needsUpgrade: false };
  if (!salt || !stored) return bad;
  const value = String(stored);

  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    const ok = timingSafeEqual(await legacyHash(salt, pin), value.toLowerCase());
    return { ok, needsUpgrade: ok };
  }

  const parts = value.split("$");
  if (parts.length !== 3 || parts[0] !== NEW_PREFIX || !/^[0-9a-fA-F]{64}$/.test(parts[2] ?? "")) return bad;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) return bad;
  const ok = timingSafeEqual(await pbkdf2Hex(salt, pin, iterations), (parts[2] as string).toLowerCase());
  return { ok, needsUpgrade: ok && iterations < PIN_ITERATIONS };
}
