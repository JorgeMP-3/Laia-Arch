// types.ts — Tipos compartidos del instalador de Laia Arch

export interface SystemScan {
  hardware: {
    arch: string;
    cpu_cores: number;
    ram_gb: number;
    disk_free_gb: number;
    disk_total_gb: number;
  };
  os: {
    distro: string;
    version: string;
    kernel: string;
    hostname: string;
  };
  network: {
    local_ip: string;
    subnet: string;
    gateway: string;
    dns_current: string;
    has_internet: boolean;
    devices_detected: NetworkDevice[];
  };
  services_active: string[];
  ports_open: number[];
  software: {
    node?: string;
    docker?: string;
    python?: string;
    git?: string;
  };
  warnings: string[];
}

export interface NetworkDevice {
  ip: string;
  mac: string;
  vendor?: string;
}

export interface InstallerConfig {
  provider: "anthropic" | "openai" | "ollama" | "compatible";
  model: string;
  company: CompanyProfile;
  access: AccessModel;
  services: ServiceSelection;
  security: SecurityPolicy;
  compliance: DataCompliance;
}

export interface CompanyProfile {
  name: string;
  sector: string;
  team_size: number;
  language: string;
  timezone: string;
}

export interface AccessModel {
  total_users: number;
  roles: { name: string; count: number }[];
  remote_users: number;
  devices: string[];
  vpn_required: boolean;
  mfa_required: boolean;
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
  password_complexity: "low" | "medium" | "high";
  encrypt_disk: boolean;
  expose_to_internet: boolean;
  ssh_key_only: boolean;
}

export interface DataCompliance {
  gdpr: boolean;
  backup_retention_days: number;
  data_types: string[];
  jurisdiction: string;
}

export interface InstallPlan {
  steps: InstallStep[];
  estimated_minutes: number;
  warnings: string[];
  credentials_needed: string[];
}

export interface InstallStep {
  id: string;
  phase: number;
  description: string;
  commands: string[];
  requires_approval: boolean;
  rollback?: string[];
}

export interface ApprovalRequest {
  id: string;
  step: InstallStep;
  timestamp: Date;
  timeout_seconds: number;
}

export type ApprovalResult = "approved" | "rejected" | "timeout";
