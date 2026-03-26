import { beforeEach, describe, expect, it, vi } from "vitest";

let verifyServiceChain: (typeof import("./verify-tools.js"))["verifyServiceChain"];
let runBackupTest: (typeof import("./verify-tools.js"))["runBackupTest"];

const execCalls: string[] = [];

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  execCalls.length = 0;

  vi.doMock("node:child_process", () => ({
    execSync: vi.fn((command: string) => {
      execCalls.push(command);
      if (command.includes("systemctl is-active")) {
        return "active\n";
      }
      if (command.includes("ldapsearch")) {
        return "";
      }
      if (command.includes("smbclient")) {
        return "Sharename       Type      Comment\n";
      }
      if (command === "docker info 2>/dev/null") {
        throw new Error("permission denied while trying to connect to the docker API");
      }
      if (command.includes('sudo -n bash -lc "docker info 2>/dev/null"')) {
        return "";
      }
      if (
        command ===
        "rsync -a --delete /etc/ /var/backups/laia-arch/etc/ && find /var/backups/laia-arch/ -mtime +30 -delete"
      ) {
        throw new Error("Permission denied");
      }
      if (
        command.includes(
          'sudo -n bash -lc "rsync -a --delete /etc/ /var/backups/laia-arch/etc/ && find /var/backups/laia-arch/ -mtime +30 -delete"',
        )
      ) {
        return "";
      }
      if (command === "du -sk /var/backups/laia-arch 2>/dev/null | awk '{print $1}' || echo 0") {
        throw new Error("Permission denied");
      }
      if (
        command.includes(
          `sudo -n bash -lc "du -sk /var/backups/laia-arch 2>/dev/null | awk '{print $1}' || echo 0"`,
        )
      ) {
        return "42\n";
      }
      return "";
    }),
  }));

  vi.doMock("node:fs", () => ({
    default: {
      accessSync: vi.fn(() => {
        throw new Error("not found");
      }),
      existsSync: vi.fn((targetPath: string) => targetPath === "/etc/cron.d/laia-arch-backup"),
      readFileSync: vi.fn((targetPath: string) => {
        if (targetPath === "/etc/cron.d/laia-arch-backup") {
          return "0 3 * * * root rsync -a --delete /etc/ /var/backups/laia-arch/etc/ && find /var/backups/laia-arch/ -mtime +30 -delete\n";
        }
        throw new Error(`unexpected read: ${targetPath}`);
      }),
    },
    accessSync: vi.fn(() => {
      throw new Error("not found");
    }),
    existsSync: vi.fn((targetPath: string) => targetPath === "/etc/cron.d/laia-arch-backup"),
    readFileSync: vi.fn((targetPath: string) => {
      if (targetPath === "/etc/cron.d/laia-arch-backup") {
        return "0 3 * * * root rsync -a --delete /etc/ /var/backups/laia-arch/etc/ && find /var/backups/laia-arch/ -mtime +30 -delete\n";
      }
      throw new Error(`unexpected read: ${targetPath}`);
    }),
    constants: { X_OK: 1 },
  }));

  vi.doMock("./logger.js", () => ({
    logToolCall: vi.fn(),
  }));

  ({ verifyServiceChain, runBackupTest } = await import("./verify-tools.js"));
});

describe("verify-tools", () => {
  it("falls back to sudo when docker verification lacks socket permissions", () => {
    const result = verifyServiceChain();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.docker).toBe(true);
      expect(result.docker_operational).toBe(true);
    }
    expect(execCalls).toContain("docker info 2>/dev/null");
    expect(
      execCalls.some((command) => command.includes('sudo -n bash -lc "docker info 2>/dev/null"')),
    ).toBe(true);
  });

  it("runs the backup probe through sudo when the cron command needs root access", () => {
    const result = runBackupTest();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.sizeKb).toBe(42);
      expect(result.logPath).toBe("/etc/cron.d/laia-arch-backup");
    }
    expect(
      execCalls.some((command) =>
        command.includes(
          'sudo -n bash -lc "rsync -a --delete /etc/ /var/backups/laia-arch/etc/ && find /var/backups/laia-arch/ -mtime +30 -delete"',
        ),
      ),
    ).toBe(true);
  });
});
