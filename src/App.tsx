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
import { computeTelemetrySnapshot } from './engine/telemetry';
import { evaluate } from './engine/evaluation';
import {
  changePriority,
  killProcess,
  restartService,
  setAffinity,
  toggleCore,
  type KilledRecord,
  type LogDraft,
} from './engine/processes';
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

const SCORES_STORAGE_KEY = 'sysaudit_lab_scores_v2';

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
  // Solo cuenta la primera evaluación del intento; las siguientes son de repaso
  const [firstScore, setFirstScore] = useState<number | null>(null);
  const [killed, setKilled] = useState<KilledRecord[]>([]);
  const [injectedPids, setInjectedPids] = useState<number[]>([]);
  // Modo guiado (pistas y valoración de cada acción) o examen (solo datos observables)
  const [guidedMode, setGuidedMode] = useState<boolean>(currentScenario.difficulty !== 'Certificación');
  const [guidedUsed, setGuidedUsed] = useState<boolean>(currentScenario.difficulty !== 'Certificación');

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
    setFirstScore(null);
    setKilled([]);
    setInjectedPids([]);
    const guided = scenario.difficulty !== 'Certificación';
    setGuidedMode(guided);
    setGuidedUsed(guided);
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

  const log = (d: LogDraft) => appendLog(d.actionType, d.target, d.detail, d.impact);

  const handleKillProcess = (pid: number) => {
    const result = killProcess(processes, pid);
    if (!result) return;
    log(result.log);
    if (result.blocked) {
      setKernelWarningMessage(result.warning);
      return;
    }
    setProcesses(result.processes);
    setKilled((prev) => [...prev, result.killed]);
  };

  const handleRestartService = (pid: number) => {
    const result = restartService(processes, pid);
    if (!result) return;
    log(result.log);
    if (result.ok) setProcesses(result.processes);
  };

  const handleChangePriority = (pid: number, newPriority: PriorityLevel) => {
    const result = changePriority(processes, pid, newPriority);
    if (!result) return;
    setProcesses(result.processes);
    log(result.log);
  };

  const handleToggleCoreAffinity = (pid: number, coreIndex: number) => {
    const result = toggleCore(processes, pid, coreIndex);
    if (!result) return;
    setProcesses(result.processes);
    log(result.log);
  };

  const handleSetAllCoresAffinity = (pid: number, cores: number[]) => {
    const result = setAffinity(processes, pid, cores);
    if (!result) return;
    setProcesses(result.processes);
    log(result.log);
  };

  const handleInjectFault = (faultType: 'memory_leak' | 'orphan_io' | 'cpu0_realtime') => {
    const used = new Set(processes.map((p) => p.pid));
    let randomPid = Math.floor(7200 + Math.random() * 2500);
    while (used.has(randomPid)) randomPid += 4;
    let newProc: ProcessItem;

    if (faultType === 'orphan_io') {
      newProc = {
        pid: randomPid,
        ppid: 3102,
        parentName: 'BackupTask.exe (finalizado)',
        parentAlive: false,
        name: 'Robocopy.exe',
        description: 'Copia con /MIR que se quedó en bucle reintentando archivos bloqueados tras cerrarse la tarea que la lanzó',
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
          'Incidente añadido: una copia que sigue viva al cerrarse la tarea que la lanzó y satura el disco. Finalízala desde el inspector o con taskkill.',
      };
    } else if (faultType === 'memory_leak') {
      newProc = {
        pid: randomPid,
        ppid: 788,
        parentName: 'services.exe',
        parentAlive: true,
        name: 'LogCollector.exe',
        description: 'Servicio de recogida de registros con una fuga de memoria (+45 MB/s)',
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
          'Incidente añadido: servicio con una fuga de memoria activa (+45 MB/s). Reinícialo antes de que el sistema empiece a paginar.',
      };
    } else {
      newProc = {
        pid: randomPid,
        ppid: 2104,
        parentName: 'explorer.exe',
        parentAlive: true,
        name: 'StressEncoder.exe',
        description: 'Codificador de vídeo fijado en el núcleo 0 con prioridad Tiempo Real',
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
        recommendedPriority: 'Normal',
        educationalHint:
          'Incidente añadido: proceso en Tiempo Real fijado al núcleo 0. Ponlo en Normal y reparte su afinidad entre los núcleos 0-7.',
      };
    }

    setProcesses((prev) => [newProc, ...prev]);
    setInjectedPids((prev) => [...prev, newProc.pid]);
    setSelectedPid(newProc.pid);
    appendLog('ALERT', newProc.name, `Incidente de práctica añadido: ${newProc.name} (PID ${newProc.pid}).`, 'negative');
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
    const result = evaluate({
      scenario: currentScenario,
      processes,
      killed,
      injectedProblemPids: injectedPids,
      report,
      latest: latestSnap,
    });
    setEvaluation(result);
    if (firstScore === null) {
      setFirstScore(result.totalScore);
      // Se guarda la mejor nota de primer intento de cada caso
      setSavedScores((prev) => {
        const updated = { ...prev, [currentScenario.id]: Math.max(prev[currentScenario.id] || 0, result.totalScore) };
        try {
          localStorage.setItem(SCORES_STORAGE_KEY, JSON.stringify(updated));
        } catch {
          // almacenamiento no disponible
        }
        return updated;
      });
    }
    setActiveTab('report');
  };

  const latestTelemetry = telemetryHistory[telemetryHistory.length - 1];
  const activeAnomaliesCount = processes.filter((p) => p.isProblematic).length;
  const logoSrc = `${import.meta.env.BASE_URL}assets/aistudio/icono_81a3db5b.png`;

  return (
    <div className="min-h-screen flex flex-col bg-[#090d16] text-slate-100">
      {/* Top Bar Contract: 3 Zones separated by gap-8 */}
      <header className="sticky top-0 z-30 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-4 sm:px-6 py-3 flex items-center justify-between gap-3 sm:gap-8">
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
            className="w-9 h-9 object-contain rounded-lg bg-slate-900 border border-slate-800 p-0.5 shrink-0"
          />
          <span className="hidden sm:inline">SysAudit Lab · Un Fantasma en el Sistema</span>
        </a>

        {/* Zone 2: 5 Single-line Navigation Links */}
        <nav className="hidden xl:flex items-center gap-6 text-sm font-medium">
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
        <div className="flex xl:hidden items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg overflow-x-auto">
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

              <button
                type="button"
                aria-pressed={guidedMode}
                onClick={() => {
                  setGuidedMode((v) => !v);
                  if (!guidedMode) setGuidedUsed(true);
                }}
                title="Modo guiado: pistas y valoración de cada acción. Modo examen: solo lo que se vería en un equipo real."
                className={`inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                  guidedMode
                    ? 'bg-sky-500/15 border-sky-500/40 text-sky-200'
                    : 'bg-amber-500/15 border-amber-500/40 text-amber-200'
                }`}
              >
                <span>{guidedMode ? 'Modo guiado (con pistas)' : 'Modo examen (sin pistas)'}</span>
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
              (guidedMode && activeAnomaliesCount > 0) || latestTelemetry.systemStability < 80
                ? 'bg-amber-950/30 border-amber-700/50 text-amber-100'
                : 'bg-emerald-950/30 border-emerald-700/50 text-emerald-100'
            }`}
          >
            <div className="flex items-start gap-3">
              {(guidedMode && activeAnomaliesCount > 0) || latestTelemetry.systemStability < 80 ? (
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              )}
              <div className="text-xs leading-relaxed">
                <span className="font-semibold">
                  {!guidedMode
                    ? 'Aviso del usuario: '
                    : activeAnomaliesCount > 0
                    ? `Alerta temprana (${activeAnomaliesCount} procesos causando problemas): `
                    : 'Procesos estabilizados: '}
                </span>
                <span className="text-slate-300">{currentScenario.symptomSummary}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
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
            guidedMode={guidedMode}
            kernelWarningMessage={kernelWarningMessage}
            onDismissKernelWarning={() => setKernelWarningMessage(null)}
          />
        )}

        {activeTab === 'smart' && (
          <SmartAuditor drives={drives} fanProfile={fanProfile} guidedMode={guidedMode} />
        )}

        {activeTab === 'terminal' && (
          <DiagnosticTerminal
            scenario={currentScenario}
            processes={processes}
            drives={drives}
            latestTelemetry={latestTelemetry}
            fanProfile={fanProfile}
            onKillProcess={handleKillProcess}
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
            firstScore={firstScore}
            guidedUsed={guidedUsed || guidedMode}
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
