import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { retrieveCredential } from "../credential-manager.js";
import { logToolCall } from "./logger.js";

type ToolFailure = { success: false; error: string; retryable: boolean };

const LDAP_ADMIN_PASSWORD_ID = "laia-arch-ldap-admin-password";

function fail(error: string, retryable: boolean): ToolFailure {
  return { success: false, error, retryable };
}

function summarizeExecError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function classifyLdapError(message: string): ToolFailure {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("already exists") ||
    normalized.includes("invalid dn syntax") ||
    normalized.includes("no such object") ||
    normalized.includes("permission denied")
  ) {
    return fail(message, false);
  }
  return fail(message, true);
}

function domainToBaseDn(domain: string): string {
  return domain
    .trim()
    .split(".")
    .filter(Boolean)
    .map((label) => `dc=${label}`)
    .join(",");
}

function validateUsername(username: string): boolean {
  return /^[a-z]+(?:\.[a-z]+)+$/.test(username);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function normalizeGroupName(value: string): string {
  return (
    value
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9_-]/g, "")
      .replace(/^-+|-+$/g, "") || "usuarios"
  );
}

function deriveGroupGid(name: string): number {
  let hash = 0;
  for (const char of normalizeGroupName(name)) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return 20_000 + (hash % 20_000);
}

function withTempFiles<T>(
  files: Record<string, string>,
  fn: (dir: string, paths: Record<string, string>) => T,
): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "laia-ldap-"));
  const paths = Object.fromEntries(
    Object.entries(files).map(([name, content]) => {
      const target = path.join(dir, name);
      fs.writeFileSync(target, content, { mode: 0o600 });
      return [name, target];
    }),
  );
  try {
    return fn(dir, paths);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function getLdapAdminPassword(): Promise<string> {
  return retrieveCredential(LDAP_ADMIN_PASSWORD_ID);
}

export async function createLdapUser(params: {
  username: string;
  givenName: string;
  sn: string;
  role: string;
  uidNumber: number;
  passwordId: string;
  domain: string;
  gidNumber?: number;
}): Promise<{ success: true; dn: string } | ToolFailure> {
  let result: { success: true; dn: string } | ToolFailure;
  if (!validateUsername(params.username)) {
    result = fail("username inválido: debe tener formato nombre.apellido", false);
    logToolCall("create_ldap_user", params, result);
    return result;
  }
  if (!Number.isInteger(params.uidNumber) || params.uidNumber <= 0) {
    result = fail("uidNumber inválido", false);
    logToolCall("create_ldap_user", params, result);
    return result;
  }
  const groupName = normalizeGroupName(params.role);
  const gidNumber = params.gidNumber ?? deriveGroupGid(groupName);

  try {
    const userPassword = await retrieveCredential(params.passwordId);
    const adminPassword = await getLdapAdminPassword();
    const baseDn = domainToBaseDn(params.domain);
    const dn = `uid=${params.username},ou=users,${baseDn}`;
    const ldif = [
      `dn: ${dn}`,
      "objectClass: inetOrgPerson",
      "objectClass: posixAccount",
      "objectClass: shadowAccount",
      `cn: ${params.givenName} ${params.sn}`,
      `sn: ${params.sn}`,
      `givenName: ${params.givenName}`,
      `uid: ${params.username}`,
      `uidNumber: ${params.uidNumber}`,
      `gidNumber: ${gidNumber}`,
      `homeDirectory: /home/${params.username}`,
      "loginShell: /bin/bash",
      `userPassword: ${userPassword}`,
      "",
    ].join("\n");

    result = withTempFiles(
      {
        "admin.pass": adminPassword,
        "user.ldif": ldif,
      },
      (_dir, paths) => {
        execSync(
          `ldapadd -x -D ${shellQuote(`cn=admin,${baseDn}`)} -y ${shellQuote(paths["admin.pass"])} -f ${shellQuote(paths["user.ldif"])}`,
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        return { success: true, dn };
      },
    );
  } catch (error) {
    result = classifyLdapError(summarizeExecError(error));
  }

  logToolCall("create_ldap_user", params, result);
  return result;
}

export async function createLdapGroup(
  name: string,
  gidNumber: number | undefined,
  domain: string,
): Promise<{ success: true; dn: string } | ToolFailure> {
  const normalizedName = normalizeGroupName(name);
  const resolvedGidNumber = gidNumber ?? deriveGroupGid(normalizedName);
  const params = { name, normalizedName, gidNumber: resolvedGidNumber, domain };
  let result: { success: true; dn: string } | ToolFailure;
  if (!/^[a-z][a-z0-9_-]*$/.test(normalizedName)) {
    result = fail("nombre de grupo LDAP inválido", false);
    logToolCall("create_ldap_group", params, result);
    return result;
  }
  if (!Number.isInteger(resolvedGidNumber) || resolvedGidNumber <= 0) {
    result = fail("gidNumber inválido", false);
    logToolCall("create_ldap_group", params, result);
    return result;
  }

  try {
    const adminPassword = await getLdapAdminPassword();
    const baseDn = domainToBaseDn(domain);
    const dn = `cn=${normalizedName},ou=groups,${baseDn}`;
    const ldif = [
      `dn: ${dn}`,
      "objectClass: posixGroup",
      `cn: ${normalizedName}`,
      `gidNumber: ${resolvedGidNumber}`,
      "",
    ].join("\n");
    result = withTempFiles(
      {
        "admin.pass": adminPassword,
        "group.ldif": ldif,
      },
      (_dir, paths) => {
        execSync(
          `ldapadd -x -D ${shellQuote(`cn=admin,${baseDn}`)} -y ${shellQuote(paths["admin.pass"])} -f ${shellQuote(paths["group.ldif"])}`,
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        return { success: true, dn };
      },
    );
  } catch (error) {
    result = classifyLdapError(summarizeExecError(error));
  }

  logToolCall("create_ldap_group", params, result);
  return result;
}

export async function addUserToGroup(
  username: string,
  group: string,
  domain: string,
): Promise<{ success: true; dn: string } | ToolFailure> {
  const normalizedGroup = normalizeGroupName(group);
  const params = { username, group, normalizedGroup, domain };
  let result: { success: true; dn: string } | ToolFailure;
  if (!validateUsername(username)) {
    result = fail("username inválido: debe tener formato nombre.apellido", false);
    logToolCall("add_user_to_group", params, result);
    return result;
  }
  if (!/^[a-z][a-z0-9_-]*$/.test(normalizedGroup)) {
    result = fail("grupo inválido", false);
    logToolCall("add_user_to_group", params, result);
    return result;
  }

  try {
    const adminPassword = await getLdapAdminPassword();
    const baseDn = domainToBaseDn(domain);
    const dn = `cn=${normalizedGroup},ou=groups,${baseDn}`;
    const ldif = [
      `dn: ${dn}`,
      "changetype: modify",
      "add: memberUid",
      `memberUid: ${username}`,
      "",
    ].join("\n");
    result = withTempFiles(
      {
        "admin.pass": adminPassword,
        "modify.ldif": ldif,
      },
      (_dir, paths) => {
        execSync(
          `ldapmodify -x -D ${shellQuote(`cn=admin,${baseDn}`)} -y ${shellQuote(paths["admin.pass"])} -f ${shellQuote(paths["modify.ldif"])}`,
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        return { success: true, dn };
      },
    );
  } catch (error) {
    result = classifyLdapError(summarizeExecError(error));
  }

  logToolCall("add_user_to_group", params, result);
  return result;
}

export function verifyLdapUser(
  username: string,
  domain: string,
): { success: true; exists: boolean; groups: string[] } | ToolFailure {
  const params = { username, domain };
  let result: { success: true; exists: boolean; groups: string[] } | ToolFailure;
  if (!validateUsername(username)) {
    result = fail("username inválido: debe tener formato nombre.apellido", false);
    logToolCall("verify_ldap_user", params, result);
    return result;
  }

  try {
    const baseDn = domainToBaseDn(domain);
    const userOutput = execSync(
      `ldapsearch -x -LLL -b ${shellQuote(`ou=users,${baseDn}`)} ${shellQuote(`(uid=${username})`)} uid 2>/dev/null || true`,
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const exists = /\buid:\s+/i.test(userOutput);
    const groupOutput = execSync(
      `ldapsearch -x -LLL -b ${shellQuote(`ou=groups,${baseDn}`)} ${shellQuote(`(&(objectClass=posixGroup)(memberUid=${username}))`)} cn 2>/dev/null || true`,
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const groups = [...groupOutput.matchAll(/^cn:\s+(.+)$/gim)].map((match) => match[1].trim());
    result = { success: true, exists, groups };
  } catch (error) {
    result = classifyLdapError(summarizeExecError(error));
  }

  logToolCall("verify_ldap_user", params, result);
  return result;
}
