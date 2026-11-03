import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DiagnosticScenario,
  ProcessItem,
  PriorityLevel,
  SmartDrive,
  TelemetryPoint,
  ActionLogEntry,
  TechnicalReport,
  EvaluationBreakdown,
} from './types/telemetry';
import { DIAGNOSTIC_SCENARIOS } from './data/scenarios';
import { TelemetryCharts } from './components/TelemetryCharts';
import { ProcessManager } from './components/ProcessManager';
import { SmartAuditor } from './components/SmartAuditor';
import { DiagnosticTerminal } from './components/DiagnosticTerminal';
import { TechnicalReportView } from './components/TechnicalReportView';
import { EducationalGuideView } from './components/EducationalGuideView';
import {
  Play,
  Pause,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  Terminal,
} from 'lucide-react';

type ActiveTab = 'telemetry' | 'smart' | 'terminal' | 'report' | 'guide';

const PRIORITY_MULTIPLIER: Record<PriorityLevel, number> = {
  Baja: 0.45,
  'Por debajo de lo normal': 0.7,
  Normal: 1.0,
  'Por encima de lo normal': 1.25,
  Alta: 1.55,
  'Tiempo Real': 2.15,
};

const SCORES_STORAGE_KEY = 'sysaudit_lab_scores_v1';

function computeTelemetrySnapshot(
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
  const hasUnremappedPendingSectors = drives.some(
    (d) => !d.pendingRemapped && d.attributes.some((a) => a.idHex === 'C5' && a.rawDecimal > 0)
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

export default function App() {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(
    DIAGNOSTIC_SCENARIOS[0].id
  );
  const [activeTab, setActiveTab] = useState<ActiveTab>('telemetry');
  const [isPaused, setIsPaused] = useState<boolean>(false);

  const [savedScores, setSavedScores] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(SCORES_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const currentScenario = useMemo(
    () =>
      DIAGNOSTIC_SCENARIOS.find((s) => s.id === selectedScenarioId) ||
      DIAGNOSTIC_SCENARIOS[0],
    [selectedScenarioId]
  );

  const [processes, setProcesses] = useState<ProcessItem[]>(() =>
    currentScenario.initialProcesses.map((p) => ({ ...p, affinity: [...p.affinity] }))
  );
  const [drives, setDrives] = useState<SmartDrive[]>(() =>
    currentScenario.initialDrives.map((d) => ({
      ...d,
      attributes: d.attributes.map((a) => ({ ...a })),
    }))
  );
  const [fanProfile, setFanProfile] = useState<'silent' | 'balanced' | 'performance'>(
    currentScenario.initialFanProfile
  );
  const [selectedPid, setSelectedPid] = useState<number | null>(
    currentScenario.initialProcesses[0]?.pid || null
  );
  const [actionLogs, setActionLogs] = useState<ActionLogEntry[]>([]);
  const [kernelWarningMessage, setKernelWarningMessage] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationBreakdown | null>(null);

  const [report, setReport] = useState<TechnicalReport>({
    technicianName: '',
    ticketId: `INC-${currentScenario.code}-2026`,
    primaryBottleneck: '',
    smartVerdict: '',
    thermalAndMemoryVerdict: '',
    selectedPreventiveActions: [],
    technicalNotes: '',
  });

  const [telemetryHistory, setTelemetryHistory] = useState<TelemetryPoint[]>(() => {
    const initialPoints: TelemetryPoint[] = [];
    for (let i = 0; i < 24; i++) {
      initialPoints.push(
        computeTelemetrySnapshot(
          i,
          currentScenario.initialProcesses,
          currentScenario.initialDrives,
          currentScenario,
          currentScenario.initialFanProfile
        )
      );
    }
    return initialPoints;
  });

  const appendLog = useCallback(
    (
      actionType: ActionLogEntry['actionType'],
      target: string,
      detail: string,
      impact: ActionLogEntry['impact']
    ) => {
      const timeStr = new Date().toTimeString().split(' ')[0];
      setActionLogs((prev) => [
        {
          id: `${Date.now()}-${Math.random()}`,
          timestamp: timeStr,
          actionType,
          target,
          detail,
          impact,
        },
        ...prev,
      ]);
    },
    []
  );

  const loadScenario = useCallback((scenario: DiagnosticScenario) => {
    const clonedProcs = scenario.initialProcesses.map((p) => ({
      ...p,
      affinity: [...p.affinity],
    }));
    const clonedDrives = scenario.initialDrives.map((d) => ({
      ...d,
      attributes: d.attributes.map((a) => ({ ...a })),
    }));
    setProcesses(clonedProcs);
    setDrives(clonedDrives);
    setFanProfile(scenario.initialFanProfile);
    setSelectedPid(clonedProcs[0]?.pid || null);
    setActionLogs([]);
    setKernelWarningMessage(null);
    setEvaluation(null);
    setReport({
      technicianName: '',
      ticketId: `INC-${scenario.code}-2026`,
      primaryBottleneck: '',
      smartVerdict: '',
      thermalAndMemoryVerdict: '',
      selectedPreventiveActions: [],
      technicalNotes: '',
    });

    const pts: TelemetryPoint[] = [];
    for (let i = 0; i < 24; i++) {
      pts.push(
        computeTelemetrySnapshot(
          i,
          clonedProcs,
          clonedDrives,
          scenario,
          scenario.initialFanProfile
        )
      );
    }
    setTelemetryHistory(pts);
  }, []);

  const handleSelectScenario = (scenarioId: string) => {
    setSelectedScenarioId(scenarioId);
    const found = DIAGNOSTIC_SCENARIOS.find((s) => s.id === scenarioId);
    if (found) {
      loadScenario(found);
    }
  };

  // Real-time simulation tick (every 1200ms)
  useEffect(() => {
    if (isPaused) return;
    const interval = setInterval(() => {
      setProcesses((prevProcs) =>
        prevProcs.map((p) => {
          if (p.memoryLeakRateMbPerSec > 0) {
            return {
              ...p,
              baseRamMb: Math.min(12800, p.baseRamMb + p.memoryLeakRateMbPerSec),
            };
          }
          return p;
        })
      );

      setTelemetryHistory((prevHistory) => {
        const nextTick = (prevHistory[prevHistory.length - 1]?.tick || 0) + 1;
        const nextSnap = computeTelemetrySnapshot(
          nextTick,
          processes,
          drives,
          currentScenario,
          fanProfile
        );
        return [...prevHistory.slice(-29), nextSnap];
      });
    }, 1200);

    return () => clearInterval(interval);
  }, [isPaused, processes, drives, currentScenario, fanProfile]);

  const handleKillProcess = (pid: number) => {
    const target = processes.find((p) => p.pid === pid);
    if (!target) return;

    if (target.category === 'system_critical') {
      setKernelWarningMessage(
        `Has intentado finalizar "${target.name}" (PID ${target.pid}). En un sistema real, terminar un proceso crítico del subsistema provoca un pantallazo azul inmediato (BSOD: CRITICAL_PROCESS_DIED). Revisa la columna de estado para identificar procesos huérfanos reales (sin padre vivo) o ejecutables no firmados.`
      );
      appendLog(
        'ALERT',
        target.name,
        `Intento bloqueado de finalizar proceso crítico del Kernel ${target.name} (PID ${target.pid}).`,
        'negative'
      );
      return;
    }

    setProcesses((prev) => prev.filter((p) => p.pid !== pid));
    appendLog(
      'KILL',
      target.name,
      `Finalizado proceso ${target.name} (PID ${target.pid}). Recursos liberados: ${target.baseRamMb.toFixed(0)} MB RAM, ${target.baseCpu}% CPU.`,
      target.isProblematic ? 'positive' : 'neutral'
    );
  };

  const handleRestartService = (pid: number) => {
    const target = processes.find((p) => p.pid === pid);
    if (!target) return;

    setProcesses((prev) =>
      prev.map((p) => {
        if (p.pid !== pid) return p;
        return {
          ...p,
          status: 'Ejecutando',
          baseCpu: 4,
          baseRamMb: 190,
          memoryLeakRateMbPerSec: 0,
          baseDiskMbps: 3,
          priority: 'Normal',
          isProblematic: false,
          fixedByStudent: true,
          educationalHint:
            'Servicio reiniciado y estabilizado correctamente. El Heap de memoria fue liberado y el bucle de I/O ha cesado.',
        };
      })
    );

    appendLog(
      'RESTART',
      target.name,
      `Reiniciado servicio ${target.name} (PID ${target.pid}). Fuga de memoria / bucle I/O purgado y consumo estabilizado.`,
      'positive'
    );
  };

  const handleChangePriority = (pid: number, newPriority: PriorityLevel) => {
    const target = processes.find((p) => p.pid === pid);
    if (!target) return;

    setProcesses((prev) =>
      prev.map((p) => {
        if (p.pid !== pid) return p;
        const isNowFixed =
          newPriority !== 'Tiempo Real' &&
          newPriority !== 'Alta' &&
          (p.recommendedAction === 'lower_priority' ||
            (p.recommendedAction === 'balance_affinity' && p.affinity.length >= 6));

        return {
          ...p,
          priority: newPriority,
          baseDiskMbps:
            newPriority === 'Baja' && p.baseDiskMbps > 40 ? 12 : p.baseDiskMbps,
          isProblematic: isNowFixed ? false : p.isProblematic,
          fixedByStudent: isNowFixed ? true : p.fixedByStudent,
        };
      })
    );

    appendLog(
      'PRIORITY',
      target.name,
      `Cambiada prioridad de ${target.name} (PID ${target.pid}) de "${target.priority}" a "${newPriority}".`,
      newPriority === 'Tiempo Real' ? 'negative' : 'positive'
    );
  };

  const handleToggleCoreAffinity = (pid: number, coreIndex: number) => {
    const target = processes.find((p) => p.pid === pid);
    if (!target) return;

    const exists = target.affinity.includes(coreIndex);
    if (exists && target.affinity.length <= 1) return;

    const nextAffinity = exists
      ? target.affinity.filter((c) => c !== coreIndex)
      : [...target.affinity, coreIndex].sort((a, b) => a - b);

    handleSetAllCoresAffinity(pid, nextAffinity);
  };

  const handleSetAllCoresAffinity = (pid: number, cores: number[]) => {
    const target = processes.find((p) => p.pid === pid);
    if (!target) return;

    setProcesses((prev) =>
      prev.map((p) => {
        if (p.pid !== pid) return p;
        const isNowBalanced =
          cores.length >= 4 &&
          p.priority !== 'Tiempo Real' &&
          p.recommendedAction === 'balance_affinity';
        return {
          ...p,
          affinity: cores,
          isProblematic: isNowBalanced ? false : p.isProblematic,
          fixedByStudent: isNowBalanced ? true : p.fixedByStudent,
        };
      })
    );

    appendLog(
      'AFFINITY',
      target.name,
      `Reasignada afinidad de CPU para ${target.name} (PID ${target.pid}) a núcleos [${cores.join(', ')}].`,
      cores.length >= 4 ? 'positive' : 'neutral'
    );
  };

  const handleInjectFault = (faultType: 'memory_leak' | 'orphan_io' | 'cpu0_realtime') => {
    const randomPid = Math.floor(7200 + Math.random() * 2500);
    let newProc: ProcessItem;

    if (faultType === 'orphan_io') {
      newProc = {
        pid: randomPid,
        ppid: 3102,
        parentName: 'BackupTask_Old.exe (Cerrado)',
        parentAlive: false,
        name: `Robocopy_Orphan_${randomPid}.exe`,
        description: 'Copia en bucle huérfana saturando cola de disco',
        user: 'Alumno_Lab',
        path: 'C:\\Windows\\System32\\Robocopy.exe',
        signed: true,
        category: 'orphan',
        status: 'Huérfano (Sin Padre)',
        baseCpu: 21,
        baseRamMb: 780,
        memoryLeakRateMbPerSec: 0,
        baseDiskMbps: 115,
        baseNetMbps: 0,
        gpuUsage: 0,
        threads: 16,
        priority: 'Alta',
        affinity: [0, 1],
        isProblematic: true,
        recommendedAction: 'kill',
        educationalHint:
          'Anomalía inyectada en vivo: Proceso huérfano saturando el ancho de banda I/O de disco. Finalízalo desde el inspector o con taskkill.',
      };
    } else if (faultType === 'memory_leak') {
      newProc = {
        pid: randomPid,
        ppid: 788,
        parentName: 'services.exe',
        parentAlive: true,
        name: `LogCollector_Leak_${randomPid}.exe`,
        description: 'Servicio de recolección con fuga activa de punteros en Heap (+45 MB/s)',
        user: 'SYSTEM',
        path: 'C:\\Program Files\\AuditTools\\LogCollector.exe',
        signed: true,
        category: 'service',
        status: 'Fuga de Memoria',
        baseCpu: 15,
        baseRamMb: 3400,
        memoryLeakRateMbPerSec: 45,
        baseDiskMbps: 35,
        baseNetMbps: 0,
        gpuUsage: 0,
        threads: 38,
        priority: 'Alta',
        affinity: [0, 1, 2, 3],
        isProblematic: true,
        recommendedAction: 'restart_service',
        educationalHint:
          'Anomalía inyectada en vivo: Servicio con fuga de memoria activa (+45 MB/s). Reinicia el servicio o finalízalo antes de provocar Thrashing.',
      };
    } else {
      newProc = {
        pid: randomPid,
        ppid: 2104,
        parentName: 'explorer.exe',
        parentAlive: true,
        name: `StressEncoder_RT_${randomPid}.exe`,
        description: 'Hilo de cálculo bloqueando Core 0 en prioridad Tiempo Real',
        user: 'Alumno_Lab',
        path: 'C:\\Users\\Alumno\\Desktop\\StressEncoder.exe',
        signed: false,
        category: 'user_app',
        status: 'Ejecutando',
        baseCpu: 52,
        baseRamMb: 1100,
        memoryLeakRateMbPerSec: 0,
        baseDiskMbps: 5,
        baseNetMbps: 0,
        gpuUsage: 15,
        threads: 16,
        priority: 'Tiempo Real',
        affinity: [0],
        isProblematic: true,
        recommendedAction: 'balance_affinity',
        educationalHint:
          'Anomalía inyectada en vivo: Proceso fijado en Tiempo Real únicamente sobre CPU 0. Rebaja su prioridad a Normal y reparte la afinidad a los núcleos 0–7.',
      };
    }

    setProcesses((prev) => [newProc, ...prev]);
    setSelectedPid(newProc.pid);
    appendLog(
      'ALERT',
      newProc.name,
      `Inyectado incidente de entrenamiento: ${newProc.name} (PID ${newProc.pid}).`,
      'negative'
    );
  };

  const handleRemapPendingSectors = (driveId: string) => {
    const targetDrive = drives.find((d) => d.id === driveId);
    if (!targetDrive) return;

    setDrives((prev) =>
      prev.map((d) => {
        if (d.id !== driveId) return d;
        const pendingCount =
          d.attributes.find((a) => a.idHex === 'C5')?.rawDecimal || 0;
        return {
          ...d,
          pendingRemapped: true,
          attributes: d.attributes.map((attr) => {
            if (attr.idHex === 'C5') {
              return {
                ...attr,
                rawDecimal: 0,
                rawHex: '000000000000',
                current: 100,
                status: 'ADVERTENCIA',
                explanation:
                  'Sectores pendientes remapeados lógicamente al área de reserva (Spare Area). ¡Atención! La unidad sigue teniendo sectores reasignados físicos (ID 05) y requiere reemplazo preventivo.',
              };
            }
            if (attr.idHex === '05') {
              const newRealloc = attr.rawDecimal + pendingCount;
              return {
                ...attr,
                rawDecimal: newRealloc,
                status: 'CRÍTICO',
              };
            }
            return attr;
          }),
        };
      })
    );

    appendLog(
      'SMART_REMAP',
      targetDrive.model,
      `Ejecutado remapeo lógico LBA en "${targetDrive.model}": sectores pendientes (0xC5) aislados en pista de reserva (0x05). Latencia de lectura desbloqueada.`,
      'positive'
    );
  };

  const handleChangeFanProfile = (profile: 'silent' | 'balanced' | 'performance') => {
    setFanProfile(profile);
    appendLog(
      'FAN_CURVE',
      'Controlador PWM Chasis',
      `Ajustado perfil de ventilación PWM a "${
        profile === 'performance'
          ? '100% Máximo Rendimiento'
          : profile === 'balanced'
          ? 'Equilibrado'
          : 'Silencioso'
      }".`,
      profile === 'performance' ? 'positive' : 'neutral'
    );
  };

  const handleEvaluate = () => {
    const latestSnap = telemetryHistory[telemetryHistory.length - 1];
    const feedbackItems: EvaluationBreakdown['feedbackItems'] = [];

    let stabScore = 0;
    const remainingProblematic = processes.filter((p) => p.isProblematic);
    if (remainingProblematic.length === 0) {
      stabScore += 28;
      feedbackItems.push({
        category: 'Optimización de Procesos y Tareas Huérfanas',
        passed: true,
        message:
          'Excelente: Neutralizaste todos los procesos huérfanos, fugas de memoria y cuellos de botella de planificación.',
      });
    } else {
      const fixedRatio =
        (currentScenario.initialProcesses.filter((p) => p.isProblematic).length -
          remainingProblematic.length) /
        Math.max(
          1,
          currentScenario.initialProcesses.filter((p) => p.isProblematic).length
        );
      stabScore += Math.max(0, Math.round(fixedRatio * 24));
      feedbackItems.push({
        category: 'Optimización de Procesos Pendiente',
        passed: false,
        message: `Aún quedan ${remainingProblematic.length} procesos anómalos activos (${remainingProblematic
          .map((p) => p.name)
          .join(', ')}). Revisa su prioridad, afinidad o finalízalos.`,
      });
    }

    if (latestSnap.systemStability >= 85 && !latestSnap.isThermalThrottling) {
      stabScore += 12;
      feedbackItems.push({
        category: 'Estabilidad Térmica y Operativa',
        passed: true,
        message: `Índice de estabilidad en ${latestSnap.systemStability}% y temperaturas bajo control (${latestSnap.cpuTempC.toFixed(
          0
        )}°C).`,
      });
    } else {
      stabScore += 4;
      feedbackItems.push({
        category: 'Estabilidad Térmica / Latencia',
        passed: false,
        message: `La estabilidad actual es del ${latestSnap.systemStability}% (CPU ${latestSnap.cpuTempC.toFixed(
          0
        )}°C). Si hay alerta térmica, activa el perfil de ventilación PWM al 100%.`,
      });
    }

    let smartScore = 0;
    if (report.primaryBottleneck === currentScenario.expectedReport.correctBottleneck) {
      smartScore += 10;
      feedbackItems.push({
        category: 'Identificación de Cuello de Botella',
        passed: true,
        message: 'Identificaste con exactitud la causa raíz del cuello de botella del sistema.',
      });
    } else {
      feedbackItems.push({
        category: 'Identificación de Cuello de Botella',
        passed: false,
        message:
          'El diagnóstico de cuello de botella seleccionado no coincide con la anomalía principal de este escenario.',
      });
    }

    if (report.smartVerdict === currentScenario.expectedReport.correctSmartVerdict) {
      smartScore += 10;
      feedbackItems.push({
        category: 'Dictamen de Sensores S.M.A.R.T.',
        passed: true,
        message: 'Interpretación impecable de los registros S.M.A.R.T. (ID 05, C5, C2, E7).',
      });
    } else {
      feedbackItems.push({
        category: 'Dictamen de Sensores S.M.A.R.T.',
        passed: false,
        message:
          'Revisa la pestaña Auditoría S.M.A.R.T. para verificar si existen sectores pendientes (ID C5), alerta térmica (ID C2) o desgaste por paginación (ID E7).',
      });
    }

    if (
      report.thermalAndMemoryVerdict ===
      currentScenario.expectedReport.correctThermalMemoryVerdict
    ) {
      smartScore += 10;
      feedbackItems.push({
        category: 'Diagnóstico Térmico y de Memoria',
        passed: true,
        message: 'Evaluación correcta del comportamiento térmico y del archivo de paginación.',
      });
    } else {
      feedbackItems.push({
        category: 'Diagnóstico Térmico y de Memoria',
        passed: false,
        message:
          'La evaluación de temperatura/memoria seleccionada no refleja lo observado en las gráficas de telemetría.',
      });
    }

    let reportScore = 0;
    const reqActions = currentScenario.expectedReport.requiredPreventiveActions;
    const matchedActions = reqActions.filter((id) =>
      report.selectedPreventiveActions.includes(id)
    );
    const actionPoints = Math.round((matchedActions.length / reqActions.length) * 20);
    reportScore += actionPoints;

    if (matchedActions.length === reqActions.length) {
      feedbackItems.push({
        category: 'Plan de Mantenimiento Preventivo',
        passed: true,
        message: 'Has seleccionado todas las medidas preventivas clave para evitar la recurrencia del fallo.',
      });
    } else {
      feedbackItems.push({
        category: 'Plan de Mantenimiento Preventivo Incompleto',
        passed: false,
        message: `Seleccionaste ${matchedActions.length} de ${reqActions.length} medidas preventivas clave recomendadas para este caso.`,
      });
    }

    if (report.technicalNotes.trim().length >= 50) {
      reportScore += 10;
      feedbackItems.push({
        category: 'Redacción del Dictamen Técnico',
        passed: true,
        message: 'Parte técnico documentado con detalle profesional.',
      });
    } else {
      feedbackItems.push({
        category: 'Redacción del Dictamen Técnico',
        passed: false,
        message:
          'El campo de observaciones técnicas es demasiado breve. Redacta tu dictamen o utiliza el botón de estructura asistida.',
      });
    }

    const totalScore = stabScore + smartScore + reportScore;
    const gradeLabel =
      totalScore >= 90
        ? 'Auditor Senior (Sobresaliente)'
        : totalScore >= 75
        ? 'Técnico Cualificado (Notable)'
        : totalScore >= 55
        ? 'Apto en Prácticas'
        : 'En Entrenamiento (Requiere Revisión)';

    setEvaluation({
      systemStabilizationScore: stabScore,
      smartAuditScore: smartScore,
      preventiveReportScore: reportScore,
      totalScore,
      gradeLabel,
      feedbackItems,
    });

    // Persist best score in localStorage
    setSavedScores((prev) => {
      const updated = {
        ...prev,
        [currentScenario.id]: Math.max(prev[currentScenario.id] || 0, totalScore),
      };
      try {
        localStorage.setItem(SCORES_STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // Ignore storage errors
      }
      return updated;
    });

    setActiveTab('report');
  };

  const latestTelemetry = telemetryHistory[telemetryHistory.length - 1];
  const activeAnomaliesCount = processes.filter((p) => p.isProblematic).length;
  const logoSrc = `${import.meta.env.BASE_URL}assets/aistudio/icono_81a3db5b.png`;

  return (
    <div className="min-h-screen flex flex-col bg-[#090d16] text-slate-100">
      {/* Top Bar Contract: 3 Zones separated by gap-8 */}
      <header className="sticky top-0 z-30 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-6 py-3 flex items-center justify-between gap-8">
        {/* Zone 1: Brand lockup with user's Ghost-USB Logo & link to unfantasmaenelsistema.com */}
        <a
          href="https://www.unfantasmaenelsistema.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 text-base font-bold tracking-tight text-white hover:text-sky-300 transition-colors whitespace-nowrap shrink-0"
          title="Visitar Un Fantasma en el Sistema"
        >
          <img
            src={logoSrc}
            onError={(e) => {
              const target = e.currentTarget;
              if (!target.src.endsWith('/assets/aistudio/icono_81a3db5b.png')) {
                target.src = '/assets/aistudio/icono_81a3db5b.png';
              }
            }}
            alt="Logo Un Fantasma en el Sistema"
            referrerPolicy="no-referrer"
            className="w-9 h-9 object-contain rounded-lg bg-slate-900 border border-slate-800 p-0.5 shrink-0"
          />
          <span>SysAudit Lab · Un Fantasma en el Sistema</span>
        </a>

        {/* Zone 2: 5 Single-line Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('telemetry')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'telemetry'
                ? 'border-sky-400 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Telemetría y Procesos
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('smart')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'smart'
                ? 'border-sky-400 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Auditoría S.M.A.R.T.
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('terminal')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'terminal'
                ? 'border-sky-400 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Consola CLI
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('report')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'report'
                ? 'border-sky-400 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Parte Técnico
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('guide')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'guide'
                ? 'border-sky-400 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Guía Didáctica
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action Button */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleEvaluate}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Evaluar Mantenimiento
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Mobile Navigation Bar */}
        <div className="flex md:hidden items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('telemetry')}
            className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap ${
              activeTab === 'telemetry' ? 'bg-slate-800 text-white' : 'text-slate-400'
            }`}
          >
            Telemetría
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('smart')}
            className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap ${
              activeTab === 'smart' ? 'bg-slate-800 text-white' : 'text-slate-400'
            }`}
          >
            S.M.A.R.T.
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('terminal')}
            className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap ${
              activeTab === 'terminal' ? 'bg-slate-800 text-white' : 'text-slate-400'
            }`}
          >
            Consola CLI
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('report')}
            className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap ${
              activeTab === 'report' ? 'bg-slate-800 text-white' : 'text-slate-400'
            }`}
          >
            Parte Técnico
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('guide')}
            className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap ${
              activeTab === 'guide' ? 'bg-slate-800 text-white' : 'text-slate-400'
            }`}
          >
            Guía
          </button>
        </div>

        {/* Scenario Selector & Simulation Controls Deck */}
        <section className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <div className="text-xs font-mono text-sky-400">
                SIMULADOR DE AUDITORÍA DE HARDWARE, PROCESOS Y MANTENIMIENTO PREVENTIVO
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white mt-0.5">
                {currentScenario.code}: {currentScenario.title}
              </h1>
              {/* Unboxed static metadata */}
              <div className="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-2 font-mono tabular-nums">
                <span>Equipo: {currentScenario.workstationModel}</span>
                <span aria-hidden="true">·</span>
                <span>{currentScenario.cpuModel}</span>
                <span aria-hidden="true">·</span>
                <span>RAM: {currentScenario.ramTotalGb} GB</span>
                <span aria-hidden="true">·</span>
                <span>Nivel: {currentScenario.difficulty}</span>
              </div>
            </div>

            {/* Playback & Stability Readout */}
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <div className="bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-right font-mono tabular-nums">
                <div className="text-[10px] text-slate-400">ESTABILIDAD DEL SISTEMA</div>
                <div
                  className={`text-base font-bold ${
                    latestTelemetry.systemStability >= 85
                      ? 'text-emerald-400'
                      : latestTelemetry.systemStability >= 60
                      ? 'text-amber-400'
                      : 'text-red-400'
                  }`}
                >
                  {latestTelemetry.systemStability}%{' '}
                  <span className="text-xs font-normal">
                    {latestTelemetry.systemStability >= 85
                      ? '● ESTABLE'
                      : latestTelemetry.systemStability >= 60
                      ? '◆ DEGRADADO'
                      : '▲ RIESGO FALLO'}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsPaused(!isPaused)}
                className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors whitespace-nowrap"
              >
                {isPaused ? (
                  <Play className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Pause className="w-3.5 h-3.5 text-amber-400" />
                )}
                <span>{isPaused ? 'Reanudar Telemetría' : 'Pausar Telemetría'}</span>
              </button>

              <button
                type="button"
                onClick={() => loadScenario(currentScenario)}
                className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reiniciar Caso</span>
              </button>
            </div>
          </div>

          {/* 5 Lab Scenario Selector Buttons with Saved Score Readout */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              {DIAGNOSTIC_SCENARIOS.map((scen) => {
                const active = scen.id === currentScenario.id;
                const bestScore = savedScores[scen.id];
                return (
                  <button
                    key={scen.id}
                    type="button"
                    onClick={() => handleSelectScenario(scen.id)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-sky-500/20 border-sky-500/60 text-sky-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    <span className="font-mono font-bold mr-1.5">{scen.code}</span>
                    <span>{scen.title.split('(')[0].trim()}</span>
                    {bestScore !== undefined && (
                      <span className="ml-2 font-mono text-[11px] text-emerald-400 tabular-nums">
                        · {bestScore} pts
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Symptom & Early Alert Banner */}
          <div
            className={`rounded-lg p-3.5 border flex flex-col md:flex-row md:items-center justify-between gap-4 ${
              activeAnomaliesCount > 0 || latestTelemetry.systemStability < 80
                ? 'bg-amber-950/30 border-amber-700/50 text-amber-100'
                : 'bg-emerald-950/30 border-emerald-700/50 text-emerald-100'
            }`}
          >
            <div className="flex items-start gap-3">
              {activeAnomaliesCount > 0 || latestTelemetry.systemStability < 80 ? (
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              )}
              <div className="text-xs leading-relaxed">
                <span className="font-semibold">
                  {activeAnomaliesCount > 0
                    ? `Alerta Temprana de Auditoría (${activeAnomaliesCount} anomalías de procesos activas): `
                    : 'Subsistemas de Procesos Estabilizados: '}
                </span>
                <span className="text-slate-300">{currentScenario.symptomSummary}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {activeTab !== 'terminal' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('terminal')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 transition-colors whitespace-nowrap"
                >
                  <Terminal className="w-3.5 h-3.5 text-sky-400" />
                  <span>Consola CLI</span>
                </button>
              )}
              {activeTab !== 'smart' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('smart')}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900 hover:bg-slate-800 text-sky-300 border border-slate-700 transition-colors whitespace-nowrap"
                >
                  Ver S.M.A.R.T.
                </button>
              )}
              {activeTab !== 'report' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('report')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 border border-sky-500/40 transition-colors whitespace-nowrap"
                >
                  <ClipboardCheck className="w-3.5 h-3.5" />
                  <span>Redactar Parte Técnico</span>
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Always-Live Moving Telemetry Graphs on Telemetry, SMART & Terminal tabs */}
        {(activeTab === 'telemetry' || activeTab === 'smart' || activeTab === 'terminal') && (
          <TelemetryCharts
            history={telemetryHistory}
            latest={latestTelemetry}
            fanProfile={fanProfile}
            onChangeFanProfile={handleChangeFanProfile}
            onSelectTab={(tab) => setActiveTab(tab)}
          />
        )}

        {/* Active Workspace Tab Content */}
        {activeTab === 'telemetry' && (
          <ProcessManager
            processes={processes}
            selectedPid={selectedPid}
            onSelectPid={setSelectedPid}
            onKillProcess={handleKillProcess}
            onRestartService={handleRestartService}
            onChangePriority={handleChangePriority}
            onToggleCoreAffinity={handleToggleCoreAffinity}
            onSetAllCoresAffinity={handleSetAllCoresAffinity}
            onInjectFault={handleInjectFault}
            actionLogs={actionLogs}
            kernelWarningMessage={kernelWarningMessage}
            onDismissKernelWarning={() => setKernelWarningMessage(null)}
          />
        )}

        {activeTab === 'smart' && (
          <SmartAuditor
            drives={drives}
            onRemapPendingSectors={handleRemapPendingSectors}
            fanProfile={fanProfile}
          />
        )}

        {activeTab === 'terminal' && (
          <DiagnosticTerminal
            scenario={currentScenario}
            processes={processes}
            drives={drives}
            latestTelemetry={latestTelemetry}
            onKillProcess={handleKillProcess}
            onRestartService={handleRestartService}
            onRemapPendingSectors={handleRemapPendingSectors}
          />
        )}

        {activeTab === 'report' && (
          <TechnicalReportView
            scenario={currentScenario}
            report={report}
            onChangeReport={setReport}
            evaluation={evaluation}
            onEvaluate={handleEvaluate}
            actionLogs={actionLogs}
          />
        )}

        {activeTab === 'guide' && <EducationalGuideView />}
      </main>

      {/* Clean Educational Footer with User Logo & Link */}
      <footer className="border-t border-slate-800/80 bg-slate-950 px-6 py-5 mt-12">
        <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-3">
            <img
              src={logoSrc}
              onError={(e) => {
                const target = e.currentTarget;
                if (!target.src.endsWith('/assets/aistudio/icono_81a3db5b.png')) {
                  target.src = '/assets/aistudio/icono_81a3db5b.png';
                }
              }}
              alt="Logo Un Fantasma en el Sistema"
              referrerPolicy="no-referrer"
              className="w-7 h-7 object-contain rounded bg-slate-900 border border-slate-800 p-0.5"
            />
            <span>
              <strong>SysAudit Lab</strong> — Simulador Didáctico de Auditoría, Sensores S.M.A.R.T. y Optimización de Procesos
            </span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://www.unfantasmaenelsistema.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sky-400 hover:text-sky-300 font-medium underline whitespace-nowrap"
            >
              <span>https://www.unfantasmaenelsistema.com/</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
