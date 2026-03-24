// scanner.ts — Fase 1: Escaneo del sistema y la red

import { exec, execSync } from "node:child_process";
import { promisify } from "node:util";
import { laiaTheme as t } from "../cli/laia-arch-theme.js";
import type { NetworkDevice, SystemScan } from "./types.js";

const execAsync = promisify(exec);
const NETWORK_DETECTION_NOTE =
  "No se detectaron dispositivos (instala arp-scan para mejor detección: sudo apt install arp-scan)";

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

function mergeNetworkDevices(devices: NetworkDevice[]): NetworkDevice[] {
  const merged = new Map<string, NetworkDevice>();
  for (const device of devices) {
    if (!device.ip) {
      continue;
    }
    const existing = merged.get(device.ip);
    merged.set(device.ip, {
      ip: device.ip,
      mac: device.mac ?? existing?.mac,
      vendor: device.vendor ?? existing?.vendor,
    });
  }
  return [...merged.values()];
}

function parseNetworkDevices(rawOutput: string): NetworkDevice[] {
  const devices: NetworkDevice[] = [];
  for (const line of rawOutput.split("\n")) {
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
      continue;
    }
    // ip neigh show format: IP dev eth0 lladdr aa:bb:cc:dd:ee:ff REACHABLE
    const ipNeigh = line.match(
      /^(\d+\.\d+\.\d+\.\d+)\s+dev\s+\S+(?:\s+lladdr\s+([\da-f:]{17}))?(?:\s+\S+)*$/i,
    );
    if (ipNeigh) {
      devices.push({
        ip: ipNeigh[1],
        mac: ipNeigh[2] || undefined,
      });
    }
  }
  return mergeNetworkDevices(devices);
}

function findDeviceByIp(rawOutput: string, ip: string): NetworkDevice | undefined {
  return parseNetworkDevices(rawOutput).find((device) => device.ip === ip);
}

function resolvePingSweepTargets(params: { gateway: string; localIp: string }): string[] {
  const targets = new Set<string>();
  const gateway = params.gateway.trim();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(gateway)) {
    targets.add(gateway);
  }

  const localIp = params.localIp.trim();
  const octets = localIp.split(".");
  if (octets.length === 4 && octets.every((part) => /^\d+$/.test(part))) {
    const prefix = `${octets[0]}.${octets[1]}.${octets[2]}`;
    for (let host = 1; host <= 10; host += 1) {
      const candidate = `${prefix}.${host}`;
      if (candidate !== localIp) {
        targets.add(candidate);
      }
    }
  }

  return [...targets];
}

async function runPingSweep(params: {
  gateway: string;
  localIp: string;
}): Promise<NetworkDevice[]> {
  const targets = resolvePingSweepTargets(params);
  if (targets.length === 0) {
    return [];
  }

  await Promise.all(
    targets.map((target) => run(`ping -c 1 -W 1 ${target} >/dev/null 2>&1 || true`, 2500)),
  );

  return parseNetworkDevices(await run("ip neigh show 2>/dev/null", 10000));
}

async function discoverNetworkDevices(params: { gateway: string; localIp: string }): Promise<{
  devices: NetworkDevice[];
  note?: string;
}> {
  const arpScanRaw = await run(
    "command -v arp-scan >/dev/null 2>&1 && (sudo -n arp-scan --localnet 2>/dev/null || arp-scan --localnet 2>/dev/null)",
    20000,
  );
  const arpScanDevices = parseNetworkDevices(arpScanRaw);
  if (arpScanDevices.length > 0) {
    return { devices: arpScanDevices };
  }

  const ipNeighRaw = await run("ip neigh show 2>/dev/null", 10000);
  const ipNeighDevices = parseNetworkDevices(ipNeighRaw);
  if (ipNeighDevices.length > 0) {
    return { devices: ipNeighDevices };
  }

  const pingSweepDevices = await runPingSweep({
    gateway: params.gateway,
    localIp: params.localIp,
  });
  if (pingSweepDevices.length > 0) {
    return { devices: pingSweepDevices };
  }

  const gateway = params.gateway.trim();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(gateway)) {
    await run(`ping -c 1 -W 2 ${gateway} 2>/dev/null`, 4000);
    try {
      execSync("sleep 0.5");
    } catch {
      // Ignoramos errores de sleep porque es solo una ayuda para refrescar ARP.
    }

    const neighAfterPing = await run("ip neigh show 2>/dev/null", 10000);
    const gatewayDevice = findDeviceByIp(neighAfterPing, gateway);
    if (gatewayDevice) {
      return {
        devices: [
          {
            ip: gateway,
            mac: gatewayDevice.mac ?? "desconocida",
            vendor: "Gateway/Router",
          },
        ],
        note:
          `No se detectaron dispositivos en la red local. ` +
          `Si estás en una VM con red NAT esto es normal. ` +
          `El gateway ${gateway} está accesible.`,
      };
    }

    return {
      devices: [
        {
          ip: gateway,
          mac: "n/a",
          vendor: "Gateway (sin ARP — posible entorno NAT)",
        },
      ],
      note:
        `No se detectaron dispositivos en la red local. ` +
        `Si estás en una VM con red NAT esto es normal. ` +
        `El gateway ${gateway} está accesible.`,
    };
  }

  return {
    devices: [],
    note: NETWORK_DETECTION_NOTE,
  };
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
  if (scan.software?.node) {
    const nodeVersion = parseInt(scan.software.node.replace("v", ""), 10);
    if (nodeVersion < 22) {
      warnings.push(`node_version_old_${scan.software.node}_requires_v22`);
    }
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
  const { devices: networkDevices, note: networkDetectionNote } = await discoverNetworkDevices({
    gateway: gatewayRaw || "",
    localIp: localIpRaw || "",
  });

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
  const portsOpen = scan.ports;
  const servicesActive = scan.services;

  row(
    "Hardware:",
    `${scan.hardware.arch}, ${scan.hardware.cores} cores, ${scan.hardware.ramGb} GB RAM`,
  );
  row(
    "Disco:",
    `${scan.hardware.diskFreeGb.toFixed(1)} GB libres de ${scan.hardware.diskTotalGb.toFixed(1)} GB`,
  );
  row("Sistema:", scan.os.distribution);
  row("Kernel:", scan.os.kernel);
  row("Hostname:", scan.os.hostname);
  row("IP local:", `${scan.network.localIp}${scan.network.subnet}`);
  row("Gateway:", scan.network.gateway);
  row("DNS:", scan.network.dns);
  row("Internet:", scan.network.hasInternet ? t.success("Disponible") : t.error("Sin conexión"));
  row("Red:", `${scan.network.devices.length} dispositivos detectados`);
  row("Servicios:", `${servicesActive.length} activos`);
  row("Puertos:", `${portsOpen.length} abiertos`);

  const sw = Object.entries(scan.software)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  if (sw) {
    row("Software:", sw);
  }

  if (networkDetectionNote) {
    console.log("  " + t.warn(networkDetectionNote));
  }

  if (scan.warnings.some((w) => w.startsWith("node_version_old"))) {
    console.log(
      "  " +
        t.warn(
          `Node.js ${scan.software.node} detectado. El proyecto requiere v22+. Ejecuta: nvm install 22 && nvm use 22`,
        ),
    );
  }

  if (portsOpen.length > 0) {
    console.log(`  ${t.label("Puertos abiertos: ")}${t.muted(portsOpen.join(", "))}`);
  }

  const conflictPorts: Record<number, string> = {
    53: "DNS/BIND9",
    80: "Nginx",
    389: "OpenLDAP",
    445: "Samba",
    51820: "WireGuard",
  };
  const conflicts = portsOpen
    .filter((port) => conflictPorts[port])
    .map((port) => `${port} (${conflictPorts[port]})`);
  if (conflicts.length > 0) {
    console.log("  " + t.warn(`Puertos en conflicto: ${conflicts.join(", ")}`));
  }

  const relevantServices = [
    "bind9",
    "named",
    "slapd",
    "smbd",
    "nmbd",
    "wg-quick@wg0",
    "wireguard",
    "docker",
    "nginx",
    "cockpit",
    "apache2",
    "mysql",
    "postgresql",
    "ssh",
    "sshd",
  ];
  const foundRelevant = servicesActive.filter((service) =>
    relevantServices.some((relevant) => service.includes(relevant)),
  );
  if (foundRelevant.length > 0) {
    console.log(`  ${t.label("Servicios LAIA detectados: ")}${t.muted(foundRelevant.join(", "))}`);
  } else {
    console.log("  " + t.muted("Servicios LAIA: ninguno (servidor limpio ✓)"));
  }

  const humanWarnings = scan.warnings.filter((warning) => !warning.startsWith("node_version_old"));
  if (humanWarnings.length > 0) {
    console.log();
    humanWarnings.forEach((warning) => console.log("  " + t.warn(warning)));
  }

  console.log();

  return scan;
}
