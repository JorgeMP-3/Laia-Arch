// scanner.ts — Fase 1: Escaneo del sistema y la red

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { laiaTheme as t } from "../cli/laia-arch-theme.js";
import type { NetworkDevice, SystemScan } from "./types.js";

const execAsync = promisify(exec);

async function run(cmd: string, timeoutMs = 10000): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, { timeout: timeoutMs });
    return stdout.trim();
  } catch {
    return "";
  }
}

function parseArch(raw: string): string {
  if (raw.includes("aarch64") || raw.includes("arm64")) {
    return "ARM64";
  }
  if (raw.includes("x86_64")) {
    return "x86_64";
  }
  return raw || "unknown";
}

function parseRamGb(freeOutput: string): number {
  const match = freeOutput.match(/Mem:\s+(\d+)/);
  if (!match) {
    return 0;
  }
  return Math.round((parseInt(match[1], 10) / 1024) * 10) / 10;
}

function parseDiskGb(dfOutput: string): { free: number; total: number } {
  const lines = dfOutput.split("\n");
  const dataLine = lines[1] ?? "";
  const parts = dataLine.split(/\s+/);
  const parseGb = (s: string): number => {
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
    total: parseGb(parts[1] ?? "0"),
    free: parseGb(parts[3] ?? "0"),
  };
}

function parseNetworkDevices(arpOutput: string): NetworkDevice[] {
  const devices: NetworkDevice[] = [];
  for (const line of arpOutput.split("\n")) {
    // arp-scan format: IP  MAC  Vendor
    const arpScan = line.match(/^(\d+\.\d+\.\d+\.\d+)\s+([\da-f:]{17})\s*(.*)/i);
    if (arpScan) {
      devices.push({
        ip: arpScan[1],
        mac: arpScan[2],
        vendor: arpScan[3]?.trim() || undefined,
      });
      continue;
    }
    // arp -a format: hostname (IP) at MAC
    const arpA = line.match(/\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([\da-f:]{17})/i);
    if (arpA) {
      devices.push({ ip: arpA[1], mac: arpA[2] });
    }
  }
  return devices;
}

function detectWarnings(scan: Omit<SystemScan, "warnings">): string[] {
  const warnings: string[] = [];

  if (scan.hardware.diskFreeGb < 5) {
    warnings.push(`Espacio en disco bajo: solo ${scan.hardware.diskFreeGb.toFixed(1)} GB libres`);
  }
  if (scan.hardware.ramGb < 2) {
    warnings.push(`RAM insuficiente: ${scan.hardware.ramGb} GB (minimo recomendado: 2 GB)`);
  }
  if (scan.services.includes("apache2")) {
    warnings.push("Apache2 en ejecucion: puede entrar en conflicto con Nginx");
  }
  if (scan.ports.includes(389)) {
    warnings.push("Puerto 389 (LDAP) ya en uso: revisa si hay un servidor LDAP existente");
  }
  if (scan.ports.includes(445)) {
    warnings.push("Puerto 445 (SMB/Samba) ya en uso: puede haber conflictos con Samba");
  }
  if (!scan.network.hasInternet) {
    warnings.push("Sin conexion a internet: algunas instalaciones requieren descarga de paquetes");
  }

  return warnings;
}

export async function runScanner(): Promise<SystemScan> {
  console.log(t.step("Escaneando el sistema y la red..."));
  console.log(t.dim("  (Esto puede tardar entre 30 y 60 segundos)\n"));

  // Launch all commands in parallel
  const [
    archRaw,
    cpuCoresRaw,
    freeRaw,
    dfRaw,
    distroRaw,
    kernelRaw,
    hostnameRaw,
    servicesRaw,
    portsRaw,
    nodeVersionRaw,
    dockerVersionRaw,
    python3VersionRaw,
    gitVersionRaw,
    localIpRaw,
    gatewayRaw,
    dnsRaw,
    subnetRaw,
    internetRaw,
    arpScanRaw,
  ] = await Promise.all([
    run("uname -m"),
    run("nproc"),
    run("free -m"),
    run("df -h /"),
    run(
      "lsb_release -d 2>/dev/null | cut -f2 || grep PRETTY_NAME /etc/os-release | cut -d= -f2 | tr -d '\"'",
    ),
    run("uname -r"),
    run("hostname"),
    run(
      "systemctl list-units --type=service --state=active --no-pager --no-legend 2>/dev/null | awk '{print $1}' | sed 's/.service$//'",
    ),
    run("ss -tlnp 2>/dev/null | awk 'NR>1 {print $4}' | grep -oP ':\\K\\d+' | sort -n | uniq"),
    run("node --version 2>/dev/null"),
    run("docker --version 2>/dev/null | awk '{print $3}' | tr -d ','"),
    run("python3 --version 2>/dev/null | awk '{print $2}'"),
    run("git --version 2>/dev/null | awk '{print $3}'"),
    run('ip route get 1.1.1.1 2>/dev/null | grep -oP "src \\K\\S+" | head -1'),
    run("ip route | grep default | awk '{print $3}' | head -1"),
    run(
      "resolvectl status 2>/dev/null | grep 'DNS Servers' | awk '{print $3}' | head -1 || grep nameserver /etc/resolv.conf | awk '{print $2}' | head -1",
    ),
    run("ip route | grep -v default | grep -v '169.254' | head -1 | awk '{print $1}'"),
    run("curl -s --max-time 5 https://1.1.1.1 > /dev/null && echo ok", 8000),
    run("arp-scan --localnet 2>/dev/null || arp -a 2>/dev/null", 20000),
  ]);

  const disk = parseDiskGb(dfRaw);
  const services = servicesRaw
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const ports = portsRaw
    .split("\n")
    .map((p) => parseInt(p.trim(), 10))
    .filter((p) => !isNaN(p));

  const subnetMatch = subnetRaw.match(/\/(\d+)$/);
  const subnet = subnetMatch ? `/${subnetMatch[1]}` : "/24";

  const networkDevices = parseNetworkDevices(arpScanRaw);

  const base: Omit<SystemScan, "warnings"> = {
    hardware: {
      arch: parseArch(archRaw),
      cores: parseInt(cpuCoresRaw, 10) || 1,
      ramGb: parseRamGb(freeRaw),
      diskFreeGb: disk.free,
      diskTotalGb: disk.total,
    },
    os: {
      distribution: distroRaw.replace(/"/g, "").trim() || "Linux",
      version: distroRaw.replace(/"/g, "").trim() || "Linux",
      kernel: kernelRaw,
      hostname: hostnameRaw,
    },
    network: {
      localIp: localIpRaw || "192.168.1.x",
      subnet,
      gateway: gatewayRaw || "desconocido",
      dns: dnsRaw || "desconocido",
      hasInternet: internetRaw === "ok",
      devices: networkDevices,
    },
    services,
    ports,
    software: {
      node: nodeVersionRaw || undefined,
      docker: dockerVersionRaw || undefined,
      python3: python3VersionRaw || undefined,
      git: gitVersionRaw || undefined,
    },
  };

  const scan: SystemScan = {
    ...base,
    warnings: detectWarnings(base),
  };

  // Display readable summary
  console.log(t.section("RESULTADO DEL ESCANEO"));
  const row = (label: string, value: string) =>
    console.log(`  ${t.label(label.padEnd(10))} ${t.value(value)}`);

  row("Hardware:", `${scan.hardware.arch}, ${scan.hardware.cores} cores, ${scan.hardware.ramGb} GB RAM`);
  row("Disco:", `${scan.hardware.diskFreeGb.toFixed(1)} GB libres de ${scan.hardware.diskTotalGb.toFixed(1)} GB`);
  row("Sistema:", scan.os.distribution);
  row("Kernel:", scan.os.kernel);
  row("Hostname:", scan.os.hostname);
  row("IP local:", `${scan.network.localIp}${scan.network.subnet}`);
  row("Gateway:", scan.network.gateway);
  row("DNS:", scan.network.dns);
  row("Internet:", scan.network.hasInternet ? t.success("Disponible") : t.error("Sin conexión"));
  row("Red:", `${scan.network.devices.length} dispositivos detectados`);
  row("Servicios:", `${scan.services.length} activos`);
  row("Puertos:", `${scan.ports.length} abiertos`);

  const sw = Object.entries(scan.software)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  if (sw) {
    row("Software:", sw);
  }

  if (scan.warnings.length > 0) {
    console.log();
    scan.warnings.forEach((w) => console.log("  " + t.warn(w)));
  }

  console.log();

  return scan;
}
