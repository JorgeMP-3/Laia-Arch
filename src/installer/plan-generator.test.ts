import { describe, expect, it } from "vitest";
import { generatePlan } from "./plan-generator.js";
import type { InstallerConfig, UserConfig } from "./types.js";

function createConfig(users: UserConfig[]): InstallerConfig {
  return {
    company: {
      name: "TestOrg",
      sector: "Pruebas",
      teamSize: users.length || 1,
      language: "es",
      timezone: "Europe/Madrid",
    },
    access: {
      totalUsers: users.length || 1,
      roles: [{ name: "equipo", count: users.length || 1 }],
      remoteUsers: 0,
      devices: ["linux"],
      needsVpn: false,
      needsMfa: false,
    },
    services: {
      dns: false,
      ldap: true,
      samba: false,
      wireguard: false,
      docker: false,
      nginx: false,
      cockpit: false,
      backups: false,
    },
    security: {
      passwordComplexity: "basic",
      diskEncryption: false,
      internetExposed: false,
      sshKeyOnly: false,
    },
    compliance: {
      gdpr: false,
      backupRetentionDays: 7,
      dataTypes: [],
      jurisdiction: "",
    },
    network: {
      serverIp: "192.168.64.19",
      subnet: "192.168.64.0/24",
      gateway: "192.168.64.1",
      internalDomain: "testorg.local",
      vpnRange: "",
      dhcpRange: "",
    },
    users,
    installMode: "guided",
  };
}

describe("generatePlan LDAP steps", () => {
  it("creates ldap-02 groups as normalized pure posixGroup entries", async () => {
    const plan = await generatePlan(
      createConfig([{ username: "usuario1", role: "Équipo Comercial", remote: false }]),
    );

    const ldapStep = plan.steps.find((step) => step.id === "ldap-02");
    expect(ldapStep).toBeTruthy();

    const commands = ldapStep?.commands.join("\n") ?? "";
    expect(commands).toContain("objectClass: posixGroup");
    expect(commands).not.toContain("objectClass: groupOfNames");
    expect(commands).not.toContain("member: uid=");
    expect(commands).toContain("dn: cn=equipo-comercial,ou=groups,dc=testorg,dc=local");
    expect(commands).toContain("cn: equipo-comercial");
  });

  it("adds ldap-04 membership updates with memberUid after ldap-03", async () => {
    const plan = await generatePlan(
      createConfig([
        { username: "usuario1", role: "Equipo Comercial", remote: false },
        { username: "usuario2", role: "Equipo Comercial", remote: false },
        { username: "usuario3", role: "Soporte", remote: false },
      ]),
    );

    const stepIds = plan.steps.map((step) => step.id);
    expect(stepIds.indexOf("ldap-04")).toBeGreaterThan(stepIds.indexOf("ldap-03"));

    const ldapMembershipStep = plan.steps.find((step) => step.id === "ldap-04");
    expect(ldapMembershipStep).toBeTruthy();

    const commands = ldapMembershipStep?.commands.join("\n") ?? "";
    expect(commands).toContain("changetype: modify");
    expect(commands).toContain("add: memberUid");
    expect(commands).toContain("dn: cn=equipo-comercial,ou=groups,dc=testorg,dc=local");
    expect(commands).toContain("memberUid: usuario1");
    expect(commands).toContain("memberUid: usuario2");
    expect(commands).toContain("dn: cn=soporte,ou=groups,dc=testorg,dc=local");
    expect(commands).toContain("memberUid: usuario3");
  });
});
