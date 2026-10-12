import { describe, expect, it } from "vitest";
import { PIN_ITERATIONS, hashPin, verifyPin } from "./pin-hash";

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
const legacy = async (salt: string, pin: string) =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + pin)));

describe("hashPin", () => {
  it("makes the new format with a random salt kept separately", async () => {
    const a = await hashPin("123456");
    expect(a.pin_hash).toMatch(new RegExp(`^pbkdf2-sha256\\$${PIN_ITERATIONS}\\$[0-9a-f]{64}$`));
    expect(a.pin_salt).toMatch(/^[0-9a-f]{32}$/);
    const b = await hashPin("123456");
    expect(b.pin_salt).not.toBe(a.pin_salt);
    expect(b.pin_hash).not.toBe(a.pin_hash);
  });
  it("never stores the PIN itself", async () => {
    const { pin_hash, pin_salt } = await hashPin("482913");
    expect(pin_hash).not.toContain("482913");
    expect(pin_salt).not.toContain("482913");
  });
});

describe("verifyPin, new format", () => {
  it("accepts the right PIN and does not ask for an upgrade", async () => {
    const { pin_salt, pin_hash } = await hashPin("4821");
    expect(await verifyPin("4821", pin_salt, pin_hash)).toEqual({ ok: true, needsUpgrade: false });
  });
  it("refuses a wrong PIN", async () => {
    const { pin_salt, pin_hash } = await hashPin("4821");
    expect(await verifyPin("4822", pin_salt, pin_hash)).toEqual({ ok: false, needsUpgrade: false });
    expect(await verifyPin("", pin_salt, pin_hash)).toEqual({ ok: false, needsUpgrade: false });
  });
  it("refuses the right PIN with the wrong salt", async () => {
    const { pin_hash } = await hashPin("4821");
    expect((await verifyPin("4821", "00".repeat(16), pin_hash)).ok).toBe(false);
  });
  it("asks for an upgrade when the stored cost is lower than today's", async () => {
    const { pin_salt } = await hashPin("4821");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("4821"), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(pin_salt), iterations: 5000 }, key, 256);
    const older = `pbkdf2-sha256$5000$${hex(bits)}`;
    expect(await verifyPin("4821", pin_salt, older)).toEqual({ ok: true, needsUpgrade: true });
    expect(await verifyPin("0000", pin_salt, older)).toEqual({ ok: false, needsUpgrade: false });
  });
});

describe("verifyPin, old format", () => {
  it("still accepts the right PIN and asks for an upgrade", async () => {
    const salt = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
    const stored = await legacy(salt, "1234");
    expect(await verifyPin("1234", salt, stored)).toEqual({ ok: true, needsUpgrade: true });
  });
  it("accepts an upper-case stored hash, as the old code did", async () => {
    const salt = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
    expect((await verifyPin("1234", salt, (await legacy(salt, "1234")).toUpperCase())).ok).toBe(true);
  });
  it("refuses a wrong PIN without asking for an upgrade", async () => {
    const salt = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
    expect(await verifyPin("9999", salt, await legacy(salt, "1234"))).toEqual({ ok: false, needsUpgrade: false });
  });
});

describe("verifyPin, bad stored values", () => {
  const salt = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
  it("treats missing salt or hash as not ok", async () => {
    for (const [s, h] of [[null, "x"], [salt, null], [undefined, undefined], ["", ""]] as const)
      expect((await verifyPin("1234", s, h)).ok).toBe(false);
  });
  it("treats unreadable values as not ok instead of throwing", async () => {
    const h64 = "a".repeat(64);
    for (const h of ["garbage", "pbkdf2-sha256$abc$" + h64, "pbkdf2-sha256$20000$short", "pbkdf2-sha256$20000", "md5$20000$" + h64, "pbkdf2-sha256$20000$" + h64 + "$extra"])
      expect((await verifyPin("1234", salt, h)).ok).toBe(false);
  });
  it("refuses a stored cost that is too small or too large to be real", async () => {
    const h64 = "a".repeat(64);
    expect((await verifyPin("1234", salt, `pbkdf2-sha256$1$${h64}`)).ok).toBe(false);
    expect((await verifyPin("1234", salt, `pbkdf2-sha256$999999999$${h64}`)).ok).toBe(false);
  });
});
