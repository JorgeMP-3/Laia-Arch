import { beforeEach, describe, expect, it, vi } from "vitest";

type ServiceStatus =
  | { success: true; status: "active" | "inactive" | "not-installed" }
  | { success: false; error: string; retryable: boolean };

type UninstallerModule = typeof import("./uninstaller.js");

const serviceStatuses = new Map<string, ServiceStatus>();
const existingPaths = new Set<string>();
const dirEntries = new Map<string, string[]>();
const execCalls: string[] = [];
const readlineAnswers: string[] = [];

let buildRemovalCommands: UninstallerModule["buildRemovalCommands"];
let detectInstalledServices: UninstallerModule["detectInstalledServices"];
let runGenericUninstall: UninstallerModule["runGenericUninstall"];

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();

  serviceStatuses.clear();
  existingPaths.clear();
  dirEntries.clear();
  execCalls.length = 0;
  readlineAnswers.length = 0;

  vi.doMock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    const homedir = () => "/home/tester";
    return {
      ...actual,
      default: { ...actual, homedir },
      homedir,
    };
  });

  vi.doMock("node:fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs")>();
    const existsSync = vi.fn((targetPath: string) => existingPaths.has(String(targetPath)));
    const readdirSync = vi.fn((targetPath: string) => dirEntries.get(String(targetPath)) ?? []);
    return {
      ...actual,
      default: { ...actual, existsSync, readdirSync },
      existsSync,
      readdirSync,
    };
  });

  vi.doMock("node:child_process", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:child_process")>();
    const execSync = vi.fn((command: string) => {
      execCalls.push(String(command));
      return "";
    });
    return {
      ...actual,
      execSync,
    };
  });

  vi.doMock("node:readline", () => {
    const createInterface = vi.fn(() => ({
      question: vi.fn((_question: string, cb: (answer: string) => void) => {
        cb(readlineAnswers.shift() ?? "");
      }),
      close: vi.fn(),
    }));
    return {
      default: { createInterface },
      createInterface,
    };
  });

  vi.doMock("../cli/laia-arch-theme.js", () => ({
    laiaTheme: {
      warn: (value: string) => value,
      dim: (value: string) => value,
      bad: (value: string) => value,
      good: (value: string) => value,
      muted: (value: string) => value,
      step: (value: string) => value,
      banner: () => "banner",
    },
  }));

  vi.doMock("./tools/system-tools.js", () => ({
    checkServiceStatus: vi.fn((service: string) => {
      return serviceStatuses.get(service) ?? { success: true, status: "not-installed" };
    }),
  }));

  ({ buildRemovalCommands, detectInstalledServices, runGenericUninstall } =
    await import("./uninstaller.js"));
});

describe("installer uninstaller", () => {
  it("detects installed services from inactive units and leftover artifacts", async () => {
    serviceStatuses.set("bind9", { success: true, status: "inactive" });
    serviceStatuses.set("slapd", { success: true, status: "inactive" });
    serviceStatuses.set("smbd", { success: true, status: "inactive" });
    serviceStatuses.set("wg-quick@wg0", { success: true, status: "inactive" });
    serviceStatuses.set("docker", { success: true, status: "inactive" });
    serviceStatuses.set("nginx", { success: true, status: "inactive" });
    serviceStatuses.set("cockpit.socket", { success: true, status: "inactive" });

    existingPaths.add("/var/backups/laia-arch");
    existingPaths.add("/etc/cron.d/laia-arch-backup");
    existingPaths.add("/etc/sudoers.d/laia-arch");
    existingPaths.add("/var/log/laia-arch");
    existingPaths.add("/etc/wireguard");
    existingPaths.add("/srv/samba");
    existingPaths.add("/var/lib/ldap");

    dirEntries.set("/srv/samba", ["departamento"]);
    dirEntries.set("/var/lib/ldap", ["data.mdb"]);

    const detected = await detectInstalledServices();

    expect(detected.bind9).toBe(true);
    expect(detected.ldap).toBe(true);
    expect(detected.samba).toBe(true);
    expect(detected.wireguard).toBe(true);
    expect(detected.docker).toBe(true);
    expect(detected.nginx).toBe(true);
    expect(detected.cockpit).toBe(true);
    expect(detected.backupScript).toBe(true);
    expect(detected.laiaConfig).toBe(true);
    expect(detected.sambaData).toBe(true);
    expect(detected.ldapData).toBe(true);
    expect(detected.logs).toBe(true);
  });

  it("builds cleanup commands for installer leftovers that break reinstalls", () => {
    const commands = buildRemovalCommands("/home/tester");

    expect(commands.docker.join("\n")).toContain("/etc/apt/keyrings/docker.asc");
    expect(commands.docker.join("\n")).toContain("/var/lib/containerd");
    expect(commands.backups.join("\n")).toContain("/var/backups/laia-arch/");
    expect(commands.bind9.join("\n")).toContain("/etc/bind/named.conf.local");
    expect(commands.config.join("\n")).toContain("/etc/sudoers.d/laia-arch");
    expect(commands.config.join("\n")).toContain("/home/tester/.laia-arch");
  });

  it("runs selected cleanup even when the detector finds nothing active", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    readlineAnswers.push("s", "CONFIRMAR");

    await runGenericUninstall(["docker"]);

    expect(execCalls).toEqual(
      expect.arrayContaining([
        "sudo systemctl disable --now docker docker.socket containerd || true",
        "sudo apt-get remove --purge docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras -y",
        "sudo rm -f /etc/apt/sources.list.d/docker.list /etc/apt/keyrings/docker.asc",
        "sudo rm -rf /var/lib/docker /var/lib/containerd /etc/docker",
      ]),
    );
  });
});
