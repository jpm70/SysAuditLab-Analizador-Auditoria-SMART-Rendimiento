import type { DiagnosticScenario, PriorityLevel, ProcessItem, SmartDrive, TelemetryPoint } from '../types/telemetry';

const PRIORITY_MULTIPLIER: Record<PriorityLevel, number> = {
  Baja: 0.45,
  'Por debajo de lo normal': 0.7,
  Normal: 1.0,
  'Por encima de lo normal': 1.25,
  Alta: 1.55,
  'Tiempo Real': 2.15,
};

export function computeTelemetrySnapshot(
  tick: number,
  processes: ProcessItem[],
  drives: SmartDrive[],
  scenario: DiagnosticScenario,
  fanProfile: 'silent' | 'balanced' | 'performance'
): TelemetryPoint {
  const coreLoads = [2, 2, 2, 2, 2, 2, 2, 2];

  let ramUsedMb = 1450; // Base OS kernel RAM
  let diskReadMbps = 2;
  let diskWriteMbps = 2;
  let netRxMbps = 1;
  let netTxMbps = 1;
  let gpuPercent = 2;
  let realtimeContentionPenalty = 0;

  processes.forEach((proc) => {
    const prioMult = PRIORITY_MULTIPLIER[proc.priority] || 1.0;
    const effectiveCpu = proc.baseCpu * (proc.isProblematic ? prioMult : Math.min(1.15, prioMult));

    // Distribute process CPU load across its assigned affinity cores
    const assignedCores = proc.affinity.length > 0 ? proc.affinity : [0];
    const perCoreShare = (effectiveCpu * 2.4) / assignedCores.length;
    assignedCores.forEach((cIdx) => {
      if (cIdx >= 0 && cIdx < 8) {
        const jitter = Math.sin(tick * 0.9 + proc.pid + cIdx) * 2.5;
        coreLoads[cIdx] = Math.min(100, Math.max(2, coreLoads[cIdx] + perCoreShare + jitter));
      }
    });

    if (proc.priority === 'Tiempo Real' && proc.baseCpu > 20) {
      realtimeContentionPenalty += 18;
    }

    ramUsedMb += proc.baseRamMb;
    diskReadMbps += proc.baseDiskMbps * 0.65;
    diskWriteMbps += proc.baseDiskMbps * 0.35;
    netRxMbps += proc.baseNetMbps * 0.3;
    netTxMbps += proc.baseNetMbps * 0.7;
    gpuPercent += proc.gpuUsage;
  });

  const clampedCores = coreLoads.map((c) => Math.min(100, Math.max(3, c)));
  const avgCoreLoad = clampedCores.reduce((acc, v) => acc + v, 0) / 8;
  const maxCoreLoad = Math.max(...clampedCores);
  const cpuTotal = Math.min(100, avgCoreLoad * 0.75 + maxCoreLoad * 0.25);

  // Cooling & Thermal calculation
  const fanCoolingFactor =
    fanProfile === 'performance' ? 0.72 : fanProfile === 'balanced' ? 0.94 : 1.24;
  const coreAsymmetryHeat = maxCoreLoad > 92 && avgCoreLoad < 65 ? 11 : 0;
  const rawCpuTemp =
    scenario.ambientTempC +
    14 +
    (cpuTotal * 0.52 + coreAsymmetryHeat + realtimeContentionPenalty * 0.4) *
      scenario.coolerDegradationFactor *
      fanCoolingFactor +
    Math.sin(tick * 0.6) * 1.2;

  const cpuTempC = Math.min(102, Math.max(34, rawCpuTemp));
  const isThermalThrottling = cpuTempC >= 90;
  const baseFreq = 4.6;
  const cpuFreqGhz = isThermalThrottling
    ? Math.max(1.85, baseFreq - (cpuTempC - 88) * 0.22)
    : Math.min(5.1, 3.6 + (cpuTotal / 100) * 1.3);

  // RAM & Pagefile Thrashing calculation
  const ramUsedGb = Math.min(scenario.ramTotalGb * 0.99, ramUsedMb / 1024);
  const ramPercent = Math.min(99.4, (ramUsedGb / scenario.ramTotalGb) * 100);
  const isThrashing = ramPercent >= 89;

  const pageFaultsPerSec = isThrashing
    ? Math.round(1450 + (ramPercent - 88) * 320 + Math.abs(Math.sin(tick)) * 180)
    : Math.round(45 + cpuTotal * 2.2);

  if (isThrashing) {
    diskReadMbps += 65;
    diskWriteMbps += 95;
  }

  // Disk S.M.A.R.T. Pending Sector penalty
  // Sectores pendientes (C5): cada lectura sobre ellos provoca reintentos de varios segundos
  const hasUnremappedPendingSectors = drives.some((d) =>
    d.attributes.some((a) => a.idHex === 'C5' && a.rawDecimal > 0)
  );
  const hasActiveDiskLoopProcess = processes.some(
    (p) => p.isProblematic && p.baseDiskMbps >= 60
  );

  const totalDiskMbps = diskReadMbps + diskWriteMbps;
  let diskActivePercent = Math.min(100, totalDiskMbps / 2.4);
  let diskLatencyMs = 4 + diskActivePercent * 0.35;

  if (hasUnremappedPendingSectors && hasActiveDiskLoopProcess) {
    diskActivePercent = Math.min(100, Math.max(96, diskActivePercent));
    diskLatencyMs = 380 + Math.sin(tick * 1.1) * 45;
  } else if (isThrashing) {
    diskActivePercent = Math.min(100, Math.max(88, diskActivePercent));
    diskLatencyMs = 165 + Math.sin(tick) * 25;
  }

  const clampedGpu = Math.min(100, Math.max(2, gpuPercent));
  const gpuTempC = Math.min(
    96,
    scenario.ambientTempC + 12 + clampedGpu * 0.56 * fanCoolingFactor
  );

  // Overall System Stability Index (0 - 100%)
  let penalty = 0;
  if (isThermalThrottling) penalty += 28;
  if (isThrashing) penalty += 26;
  if (diskLatencyMs >= 150) penalty += 24;
  if (realtimeContentionPenalty > 0) penalty += 18;
  if (netRxMbps + netTxMbps > 450) penalty += 22;
  if (clampedGpu > 80) penalty += 15;

  const systemStability = Math.max(12, Math.min(100, Math.round(100 - penalty)));

  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0];

  return {
    timestamp: timeStr,
    tick,
    cpuTotal,
    cpuCores: clampedCores,
    cpuFreqGhz,
    cpuTempC,
    isThermalThrottling,
    ramUsedGb,
    ramTotalGb: scenario.ramTotalGb,
    ramPercent,
    pageFaultsPerSec,
    isThrashing,
    diskActivePercent,
    diskReadMbps,
    diskWriteMbps,
    diskLatencyMs,
    netRxMbps,
    netTxMbps,
    gpuPercent: clampedGpu,
    gpuTempC,
    systemStability,
  };
}
