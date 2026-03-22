// scanner.ts — Fase 1: Escáner de sistema y red

import { execSync } from "child_process";
import type { SystemScan, NetworkDevice } from "./types.js";

function runCommand(cmd: string): string {
  try {
    return execSync(cmd, {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

function parseArch(): string {
  const arch = runCommand("uname -m");
  if (arch.includes("aarch64") || arch.includes("arm64")) {
    return "ARM64";
  }
  if (arch.includes("x86_64")) {
    return "x86_64";
  }
  return arch || "unknown";
}

function parseRamGb(): number {
  const output = runCommand("free -m");
  const match = output.match(/Mem:\s+(\d+)/);
  return match ? Math.round((parseInt(match[1]) / 1024) * 10) / 10 : 0;
}

function parseDisk(): { free: number; total: number } {
  const output = runCommand("df -h /");
  const lines = output.split("\n");
  const dataLine = lines[1] || "";
  const parts = dataLine.split(/\s+/);
  const parseGb = (s: string) => {
    if (!s) {
      return 0;
    }
    const n = parseFloat(s);
    if (s.endsWith("T")) {
      return n * 1024;
    }
    if (s.endsWith("G")) {
      return n;
    }
    if (s.endsWith("M")) {
      return n / 1024;
    }
    return n;
  };
  return {
    total: parseGb(parts[1] || "0"),
    free: parseGb(parts[3] || "0"),
  };
}

function parseNetworkDevices(): NetworkDevice[] {
  let output = runCommand(
    "sudo arp-scan --localnet 2>/dev/null || arp-scan --localnet 2>/dev/null",
  );
  if (!output) {
    output = runCommand("arp -a");
  }

  const devices: NetworkDevice[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    const arpScanMatch = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([\da-f:]{17})\s*(.*)/i);
    if (arpScanMatch) {
      devices.push({
        ip: arpScanMatch[1],
        mac: arpScanMatch[2],
        vendor: arpScanMatch[3]?.trim() || undefined,
      });
      continue;
    }
    const arpMatch = line.match(/\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([\da-f:]{17})/i);
    if (arpMatch) {
      devices.push({ ip: arpMatch[1], mac: arpMatch[2] });
    }
  }

  return devices;
}

function detectWarnings(scan: Partial<SystemScan>): string[] {
  const warnings: string[] = [];

  if (scan.hardware && scan.hardware.disk_free_gb < 5) {
    warnings.push(`disk_low_${Math.round(scan.hardware.disk_free_gb)}gb_free`);
  }
  if (scan.hardware && scan.hardware.ram_gb < 2) {
    warnings.push("ram_low_under_2gb");
  }
  if (scan.services_active && scan.services_active.includes("apache2")) {
    warnings.push("apache2_running_may_conflict_with_nginx");
  }
  if (scan.ports_open && scan.ports_open.includes(389)) {
    warnings.push("ldap_port_already_open");
  }
  if (scan.ports_open && scan.ports_open.includes(445)) {
    warnings.push("samba_port_already_open");
  }
  if (!scan.network?.has_internet) {
    warnings.push("no_internet_connection");
  }

  return warnings;
}

export async function runScanner(): Promise<SystemScan> {
  console.log("→ Escaneando el sistema y la red...");
  console.log("  (Esto tarda entre 30 y 60 segundos)\n");

  const [
    cpuCores,
    distroRaw,
    kernelRaw,
    hostnameRaw,
    servicesRaw,
    portsRaw,
    nodeVersion,
    dockerVersion,
    pythonVersion,
    gitVersion,
    localIpRaw,
    gatewayRaw,
    dnsRaw,
  ] = await Promise.all([
    Promise.resolve(parseInt(runCommand("nproc")) || 1),
    Promise.resolve(
      runCommand(
        "lsb_release -d 2>/dev/null | cut -f2 || grep PRETTY_NAME /etc/os-release | cut -d= -f2 | tr -d '\"'",
      ) || "Linux",
    ),
    Promise.resolve(runCommand("uname -r")),
    Promise.resolve(runCommand("hostname")),
    Promise.resolve(
      runCommand(
        "systemctl list-units --type=service --state=active --no-pager --no-legend 2>/dev/null | awk '{print $1}' | sed 's/.service$//'",
      ),
    ),
    Promise.resolve(
      runCommand(
        "ss -tlnp 2>/dev/null | awk 'NR>1 {print $4}' | grep -oP ':\\K\\d+' | sort -n | uniq",
      ),
    ),
    Promise.resolve(runCommand("node --version 2>/dev/null")),
    Promise.resolve(runCommand("docker --version 2>/dev/null | awk '{print $3}' | tr -d ','")),
    Promise.resolve(runCommand("python3 --version 2>/dev/null | awk '{print $2}'")),
    Promise.resolve(runCommand("git --version 2>/dev/null | awk '{print $3}'")),
    Promise.resolve(
      runCommand('ip route get 1.1.1.1 2>/dev/null | grep -oP "src \\K\\S+" | head -1'),
    ),
    Promise.resolve(runCommand("ip route | grep default | awk '{print $3}' | head -1")),
    Promise.resolve(
      runCommand(
        "resolvectl status 2>/dev/null | grep 'DNS Servers' | awk '{print $3}' | head -1 || grep nameserver /etc/resolv.conf | awk '{print $2}' | head -1",
      ),
    ),
  ]);

  const hasInternet =
    runCommand("curl -s --max-time 5 https://1.1.1.1 > /dev/null && echo ok") === "ok";

  console.log("  → Escaneando dispositivos en la red local...");
  const networkDevices = parseNetworkDevices();

  const servicesActive = servicesRaw
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const portsOpen = portsRaw
    .split("\n")
    .map((p) => parseInt(p.trim()))
    .filter((p) => !isNaN(p));

  const subnetRaw = runCommand(
    "ip route | grep -v default | grep -v '169.254' | head -1 | awk '{print $1}'",
  );
  const subnetMatch = subnetRaw.match(/\/(\d+)$/);
  const subnet = subnetMatch ? `/${subnetMatch[1]}` : "/24";

  const disk = parseDisk();

  const partialScan: Partial<SystemScan> = {
    hardware: {
      arch: parseArch(),
      cpu_cores: cpuCores,
      ram_gb: parseRamGb(),
      disk_free_gb: disk.free,
      disk_total_gb: disk.total,
    },
    os: {
      distro: distroRaw.replace(/"/g, "").trim(),
      version: distroRaw.replace(/"/g, "").trim(),
      kernel: kernelRaw,
      hostname: hostnameRaw,
    },
    network: {
      local_ip: localIpRaw || "192.168.1.x",
      subnet,
      gateway: gatewayRaw || "desconocido",
      dns_current: dnsRaw || "desconocido",
      has_internet: hasInternet,
      devices_detected: networkDevices,
    },
    services_active: servicesActive,
    ports_open: portsOpen,
    software: {
      node: nodeVersion || undefined,
      docker: dockerVersion || undefined,
      python: pythonVersion || undefined,
      git: gitVersion || undefined,
    },
  };

  partialScan.warnings = detectWarnings(partialScan);

  const scan = partialScan as SystemScan;

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║                  RESULTADO DEL ESCANEO                  ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(
    `\n  Hardware: ${scan.hardware.arch}, ${scan.hardware.cpu_cores} cores, ${scan.hardware.ram_gb}GB RAM`,
  );
  console.log(
    `  Disco: ${scan.hardware.disk_free_gb}GB libres de ${scan.hardware.disk_total_gb}GB`,
  );
  console.log(`  Sistema: ${scan.os.distro}`);
  console.log(`  Hostname: ${scan.os.hostname}`);
  console.log(`  IP local: ${scan.network.local_ip}${scan.network.subnet}`);
  console.log(`  Gateway: ${scan.network.gateway}`);
  console.log(`  Internet: ${scan.network.has_internet ? "✓ Disponible" : "✗ Sin conexión"}`);
  console.log(`  Dispositivos en red: ${scan.network.devices_detected.length} detectados`);
  console.log(`  Servicios activos: ${scan.services_active.length}`);

  if (scan.warnings.length > 0) {
    console.log("\n  ⚠ Advertencias detectadas:");
    scan.warnings.forEach((w) => console.log(`    - ${w.replace(/_/g, " ")}`));
  }

  console.log();

  return scan;
}
