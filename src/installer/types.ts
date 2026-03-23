// types.ts — Tipos compartidos del instalador de Laia Arch

export interface NetworkDevice {
  ip: string;
  mac?: string;
  vendor?: string;
}

export interface SystemScan {
  hardware: {
    arch: string;
    cores: number;
    ramGb: number;
    diskFreeGb: number;
    diskTotalGb: number;
  };
  os: {
    distribution: string;
    version: string;
    kernel: string;
    hostname: string;
  };
  network: {
    localIp: string;
    subnet: string;
    gateway: string;
    dns: string;
    hasInternet: boolean;
    devices: NetworkDevice[];
  };
  services: string[];
  ports: number[];
  software: {
    node?: string;
    docker?: string;
    python3?: string;
    git?: string;
  };
  warnings: string[];
}

export interface CompanyProfile {
  name: string;
  sector: string;
  teamSize: number;
  language: string;
  timezone: string;
}

export interface Role {
  name: string;
  count: number;
}

export interface AccessModel {
  totalUsers: number;
  roles: Role[];
  remoteUsers: number;
  devices: string[];
  needsVpn: boolean;
  needsMfa: boolean;
}

export interface ServiceSelection {
  dns: boolean;
  ldap: boolean;
  samba: boolean;
  wireguard: boolean;
  docker: boolean;
  nginx: boolean;
  cockpit: boolean;
  backups: boolean;
}

export interface SecurityPolicy {
  passwordComplexity: "basic" | "medium" | "high";
  diskEncryption: boolean;
  internetExposed: boolean;
  sshKeyOnly: boolean;
}

export interface DataCompliance {
  gdpr: boolean;
  backupRetentionDays: number;
  dataTypes: string[];
  jurisdiction: string;
}

export interface InstallStep {
  id: string;
  phase: number;
  description: string;
  commands: string[];
  requiresApproval: boolean;
  rollback?: string;
}

export interface InstallPlan {
  steps: InstallStep[];
  estimatedMinutes: number;
  warnings: string[];
  requiredCredentials: string[];
}

export interface InstallerConfig {
  company: CompanyProfile;
  access: AccessModel;
  services: ServiceSelection;
  security: SecurityPolicy;
  compliance: DataCompliance;
}

export type ApprovalResult = "approved" | "rejected" | "timeout";

export interface ApprovalRequest {
  id: string;
  step: InstallStep;
  timestamp: Date;
  timeoutSeconds: number;
}

export interface AiProvider {
  id: "anthropic" | "openai" | "ollama" | "openai-compatible";
  name: string;
  models: string[];
  baseUrl?: string;
}

export interface BootstrapResult {
  providerId: string;
  model: string;
  credentialId: string;
  baseUrl?: string;
}
