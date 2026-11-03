export type PriorityLevel =
  | 'Baja'
  | 'Por debajo de lo normal'
  | 'Normal'
  | 'Por encima de lo normal'
  | 'Alta'
  | 'Tiempo Real';

export type ProcessCategory =
  | 'system_critical'
  | 'service'
  | 'user_app'
  | 'orphan'
  | 'suspicious';

export type ProcessStatus = 'Ejecutando' | 'No responde (Colgado)' | 'Huérfano (Sin Padre)' | 'Fuga de Memoria' | 'Bucle I/O';

export interface ProcessItem {
  pid: number;
  ppid: number;
  parentName: string;
  parentAlive: boolean;
  name: string;
  description: string;
  user: string;
  path: string;
  signed: boolean;
  category: ProcessCategory;
  status: ProcessStatus;
  baseCpu: number; // % base consumption
  baseRamMb: number; // MB
  memoryLeakRateMbPerSec: number; // +MB/s if leaking
  baseDiskMbps: number; // MB/s
  baseNetMbps: number; // Mbps
  gpuUsage: number; // %
  threads: number;
  priority: PriorityLevel;
  affinity: number[]; // cores 0..7
  isProblematic: boolean;
  recommendedAction?: 'kill' | 'restart_service' | 'lower_priority' | 'balance_affinity' | 'none';
  recommendedPriority?: PriorityLevel;
  educationalHint: string;
  fixedByStudent?: boolean;
}

export type SmartHealthStatus = 'NOMINAL' | 'ADVERTENCIA' | 'CRÍTICO';

export interface SmartAttribute {
  idHex: string;
  name: string;
  spanishName: string;
  current: number; // Normalized 1-253
  worst: number;
  threshold: number;
  rawDecimal: number;
  rawHex: string;
  unit?: string;
  status: SmartHealthStatus;
  isCriticalPreFail: boolean;
  explanation: string;
}

export interface SmartDrive {
  id: string;
  model: string;
  serial: string;
  firmware: string;
  interfaceType: 'NVMe PCIe 4.0 x4' | 'SATA III 6.0 Gb/s';
  capacityGb: number;
  powerOnHours: number;
  powerCount: number;
  baseTempC: number;
  healthPercent: number;
  overallStatus: SmartHealthStatus;
  attributes: SmartAttribute[];
  pendingRemapped?: boolean;
}

export interface TelemetryPoint {
  timestamp: string;
  tick: number;
  cpuTotal: number;
  cpuCores: number[]; // 8 cores
  cpuFreqGhz: number;
  cpuTempC: number;
  isThermalThrottling: boolean;
  ramUsedGb: number;
  ramTotalGb: number;
  ramPercent: number;
  pageFaultsPerSec: number;
  isThrashing: boolean;
  diskActivePercent: number;
  diskReadMbps: number;
  diskWriteMbps: number;
  diskLatencyMs: number;
  netRxMbps: number;
  netTxMbps: number;
  gpuPercent: number;
  gpuTempC: number;
  systemStability: number; // 0 to 100%
}

export interface ActionLogEntry {
  id: string;
  timestamp: string;
  actionType: 'KILL' | 'RESTART' | 'PRIORITY' | 'AFFINITY' | 'SMART_REMAP' | 'FAN_CURVE' | 'ALERT';
  target: string;
  detail: string;
  impact: 'positive' | 'neutral' | 'negative';
}

export interface TechnicalReport {
  technicianName: string;
  ticketId: string;
  primaryBottleneck: string;
  smartVerdict: string;
  thermalAndMemoryVerdict: string;
  selectedPreventiveActions: string[];
  technicalNotes: string;
}

export interface EvaluationBreakdown {
  systemStabilizationScore: number; // max 40
  smartAuditScore: number; // max 30
  preventiveReportScore: number; // max 30
  totalScore: number; // max 100
  gradeLabel: string;
  feedbackItems: {
    category: string;
    passed: boolean;
    message: string;
  }[];
}

export interface DiagnosticScenario {
  id: string;
  code: string;
  title: string;
  subtitle: string;
  difficulty: 'Inicial' | 'Intermedio' | 'Avanzado' | 'Certificación';
  workstationModel: string;
  cpuModel: string;
  ramTotalGb: number;
  symptomSummary: string;
  learningObjectives: string[];
  initialFanProfile: 'silent' | 'balanced' | 'performance';
  ambientTempC: number;
  coolerDegradationFactor: number; // 1.0 normal, 1.45 dusty heatsink/dried thermal paste
  initialProcesses: ProcessItem[];
  initialDrives: SmartDrive[];
  expectedReport: {
    correctBottleneck: string;
    correctSmartVerdict: string;
    correctThermalMemoryVerdict: string;
    requiredPreventiveActions: string[];
    sampleTechnicalConclusion: string;
  };
}
