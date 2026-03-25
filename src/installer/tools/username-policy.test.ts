import { describe, expect, it } from "vitest";
import { isValidInstallerUsername } from "./username-policy.js";

describe("isValidInstallerUsername", () => {
  it("accepts simple and dotted lowercase usernames", () => {
    expect(isValidInstallerUsername("user")).toBe(true);
    expect(isValidInstallerUsername("usuario1")).toBe(true);
    expect(isValidInstallerUsername("ana.garcia")).toBe(true);
    expect(isValidInstallerUsername("carlos.sainz2")).toBe(true);
  });

  it("rejects uppercase letters, spaces, leading dots, and trailing dots", () => {
    expect(isValidInstallerUsername("Usuario1")).toBe(false);
    expect(isValidInstallerUsername("ana garcia")).toBe(false);
    expect(isValidInstallerUsername(".usuario")).toBe(false);
    expect(isValidInstallerUsername("usuario.")).toBe(false);
  });
});
