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
  it("reconfigures an existing slapd install before binding with the new admin password", async () => {
    const plan = await generatePlan(
      createConfig([{ username: "usuario1", role: "Equipo", remote: false }]),
    );

    const ldapInstallStep = plan.steps.find((step) => step.id === "ldap-01");
    expect(ldapInstallStep).toBeTruthy();

    const commands = ldapInstallStep?.commands.join("\n") ?? "";
    expect(commands).toContain("SLAPD_ALREADY_INSTALLED");
    expect(commands).toContain("slapd slapd/move_old_database boolean true");
    expect(commands).toContain("slapd slapd/purge_database boolean false");
    expect(commands).toContain("DEBIAN_FRONTEND=noninteractive dpkg-reconfigure slapd");
  });

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

  it("falls back to loopback when the dns server IP is blank", async () => {
    const config = createConfig([{ username: "usuario1", role: "Equipo", remote: false }]);
    config.services.dns = true;
    config.network!.serverIp = "   ";

    const plan = await generatePlan(config);
    const dnsStep = plan.steps.find((step) => step.id === "dns-01");

    expect(dnsStep).toBeTruthy();
    expect(dnsStep?.commands.join("\n")).toContain("$TTL 3600");
    expect(dnsStep?.commands.join("\n")).toContain("@\tIN A\t127.0.0.1");
    expect(dnsStep?.commands.join("\n")).toContain("ns1\tIN A\t127.0.0.1");
  });

  it("creates an idempotent WireGuard setup that writes a real wg0.conf and restarts the service", async () => {
    const config = createConfig([{ username: "usuario1", role: "Equipo", remote: true }]);
    config.services.wireguard = true;
    config.access.remoteUsers = 1;
    config.access.needsVpn = true;
    config.network!.vpnRange = "10.8.0.0/24";

    const plan = await generatePlan(config);
    const vpnStep = plan.steps.find((step) => step.id === "vpn-01");
    const commands = vpnStep?.commands.join("\n") ?? "";

    expect(vpnStep).toBeTruthy();
    expect(commands).toContain("install -d -m 700 /etc/wireguard");
    expect(commands).toContain("if [ ! -s /etc/wireguard/server_private.key ]; then");
    expect(commands).toContain('PRIVATE_KEY="$(cat /etc/wireguard/server_private.key)"');
    expect(commands).toContain("PrivateKey = $PRIVATE_KEY");
    expect(commands).not.toContain("PrivateKey = $(cat /etc/wireguard/server_private.key)");
    expect(commands).toContain("systemctl enable wg-quick@wg0");
    expect(commands).toContain("systemctl restart wg-quick@wg0");
  });

  it("generates the Agora token without a pipefail-sensitive tr/head pipeline", async () => {
    const config = createConfig([{ username: "usuario1", role: "Equipo", remote: false }]);
    config.services.docker = true;

    const plan = await generatePlan(config);
    const agoraComposeStep = plan.steps.find((step) => step.id === "agora-02");
    const commands = agoraComposeStep?.commands.join("\n") ?? "";

    expect(agoraComposeStep).toBeTruthy();
    expect(commands).toContain("python3 -c");
    expect(commands).not.toContain("tr -dc A-Za-z0-9 </dev/urandom | head -c 48");
  });

  it("prepares a minimal Agora config with local mode and trusted local origins", async () => {
    const config = createConfig([{ username: "usuario1", role: "Equipo", remote: false }]);
    config.services.docker = true;

    const plan = await generatePlan(config);
    const agoraComposeStep = plan.steps.find((step) => step.id === "agora-02");
    const agoraStartStep = plan.steps.find((step) => step.id === "agora-03");
    const commands = agoraComposeStep?.commands.join("\n") ?? "";
    const startCommands = agoraStartStep?.commands.join("\n") ?? "";

    expect(agoraComposeStep).toBeTruthy();
    expect(agoraStartStep).toBeTruthy();
    expect(commands).toContain("/srv/laia-agora/config/openclaw.json");
    expect(commands).toContain('"mode": "local"');
    expect(commands).toContain('"bind": "${OPENCLAW_GATEWAY_BIND}"');
    expect(commands).toContain(
      '"allowedOrigins": ["http://127.0.0.1:${OPENCLAW_GATEWAY_PORT}", "http://localhost:${OPENCLAW_GATEWAY_PORT}"]',
    );
    expect(commands).toContain("--allow-unconfigured");
    expect(commands).toContain("chmod 644 /srv/laia-agora/config/openclaw.json");
    expect(startCommands).toContain("/srv/laia-agora/config/openclaw.json");
    expect(startCommands).toContain("chmod 644 /srv/laia-agora/config/openclaw.json");
    expect(startCommands).toContain("AUTH_TARGET_DIR=/srv/laia-agora/config/agents/main/agent");
    expect(startCommands).toContain('AUTH_TARGET_PATH="${AUTH_TARGET_DIR}/auth-profiles.json"');
    expect(startCommands).toContain("auth-profiles.json del bootstrap");
    expect(startCommands.indexOf("auth-profiles.json")).toBeLessThan(
      startCommands.indexOf(
        "docker compose --env-file /opt/laia-agora/.env -f /opt/laia-agora/docker-compose.yml up -d",
      ),
    );
  });

  it("adds the invoking user to the docker group during docker installation", async () => {
    const config = createConfig([{ username: "usuario1", role: "Equipo", remote: false }]);
    config.services.docker = true;

    const plan = await generatePlan(config);
    const dockerStep = plan.steps.find((step) => step.id === "docker-01");

    expect(dockerStep).toBeTruthy();
    expect(dockerStep?.commands.join("\n")).toContain('usermod -aG docker "$SUDO_USER"');
  });

  it("uses file-only retention cleanup in backup cron jobs", async () => {
    const config = createConfig([{ username: "usuario1", role: "Equipo", remote: false }]);
    config.services.backups = true;
    config.compliance.backupRetentionDays = 30;

    const plan = await generatePlan(config);
    const backupStep = plan.steps.find((step) => step.id === "backup-01");
    const commands = backupStep?.commands.join("\n") ?? "";

    expect(backupStep).toBeTruthy();
    expect(commands).toContain("find /var/backups/laia-arch/ -type f -mtime +30 -delete");
    expect(commands).not.toContain("find /var/backups/laia-arch/ -mtime +30 -delete");
  });
});
