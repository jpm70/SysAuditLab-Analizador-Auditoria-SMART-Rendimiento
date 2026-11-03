import React, { useState, useMemo } from 'react';
import { PriorityLevel, ProcessItem, ActionLogEntry } from '../types/telemetry';
import {
  Search,
  Sliders,
  Trash2,
  RotateCcw,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  ArrowUpDown,
  Terminal,
  GitBranch,
  List,
  Zap,
} from 'lucide-react';

interface ProcessManagerProps {
  processes: ProcessItem[];
  selectedPid: number | null;
  onSelectPid: (pid: number) => void;
  onKillProcess: (pid: number) => void;
  onRestartService: (pid: number) => void;
  onChangePriority: (pid: number, priority: PriorityLevel) => void;
  onToggleCoreAffinity: (pid: number, coreIndex: number) => void;
  onSetAllCoresAffinity: (pid: number, cores: number[]) => void;
  onInjectFault: (faultType: 'memory_leak' | 'orphan_io' | 'cpu0_realtime') => void;
  actionLogs: ActionLogEntry[];
  kernelWarningMessage: string | null;
  onDismissKernelWarning: () => void;
}

const PRIORITY_LEVELS: PriorityLevel[] = [
  'Baja',
  'Por debajo de lo normal',
  'Normal',
  'Por encima de lo normal',
  'Alta',
  'Tiempo Real',
];

type FilterMode = 'all' | 'anomalies' | 'orphans' | 'io_heavy';
type SortField = 'cpu' | 'ram' | 'disk' | 'net' | 'pid';

export const ProcessManager: React.FC<ProcessManagerProps> = ({
  processes,
  selectedPid,
  onSelectPid,
  onKillProcess,
  onRestartService,
  onChangePriority,
  onToggleCoreAffinity,
  onSetAllCoresAffinity,
  onInjectFault,
  actionLogs,
  kernelWarningMessage,
  onDismissKernelWarning,
}) => {
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [viewMode, setViewMode] = useState<'table' | 'tree'>('table');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('cpu');
  const [sortDesc, setSortDesc] = useState(true);

  const filteredProcesses = useMemo(() => {
    return processes
      .filter((p) => {
        if (filterMode === 'anomalies' && !p.isProblematic) return false;
        if (filterMode === 'orphans' && p.parentAlive) return false;
        if (filterMode === 'io_heavy' && p.baseDiskMbps < 20 && p.baseNetMbps < 20) return false;
        if (searchQuery.trim() !== '') {
          const q = searchQuery.toLowerCase();
          return (
            p.name.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            String(p.pid).includes(q) ||
            p.parentName.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        let valA = 0;
        let valB = 0;
        if (sortField === 'cpu') {
          valA = a.baseCpu;
          valB = b.baseCpu;
        } else if (sortField === 'ram') {
          valA = a.baseRamMb;
          valB = b.baseRamMb;
        } else if (sortField === 'disk') {
          valA = a.baseDiskMbps;
          valB = b.baseDiskMbps;
        } else if (sortField === 'net') {
          valA = a.baseNetMbps;
          valB = b.baseNetMbps;
        } else {
          valA = a.pid;
          valB = b.pid;
        }
        return sortDesc ? valB - valA : valA - valB;
      });
  }, [processes, filterMode, searchQuery, sortField, sortDesc]);

  const selectedProcess = useMemo(
    () => processes.find((p) => p.pid === selectedPid) || filteredProcesses[0] || null,
    [processes, selectedPid, filteredProcesses]
  );

  // Group processes by parent for PPID Tree View
  const groupedByParent = useMemo(() => {
    const groups: Record<string, { parentAlive: boolean; ppid: number; items: ProcessItem[] }> = {};
    filteredProcesses.forEach((p) => {
      const key = `${p.parentName} (PPID ${p.ppid})`;
      if (!groups[key]) {
        groups[key] = { parentAlive: p.parentAlive, ppid: p.ppid, items: [] };
      }
      groups[key].items.push(p);
    });
    return Object.entries(groups);
  }, [filteredProcesses]);

  const handleSortClick = (field: SortField) => {
    if (sortField === field) {
      setSortDesc(!sortDesc);
    } else {
      setSortField(field);
      setSortDesc(true);
    }
  };

  return (
    <div className="space-y-4">
      {/* Educational Kernel Protection Banner if student tried to kill critical OS process */}
      {kernelWarningMessage && (
        <div
          role="alert"
          className="bg-red-950/90 border border-red-700/80 rounded-xl p-4 flex items-start justify-between gap-4"
        >
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-semibold text-red-200">
                Protección Didáctica del Kernel Activada (Prevención de BSOD)
              </h4>
              <p className="text-xs text-red-300/90 mt-1 leading-relaxed">{kernelWarningMessage}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismissKernelWarning}
            className="px-3 py-1.5 text-xs font-medium bg-red-900 hover:bg-red-800 text-red-100 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Entendido
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Columns: High-Density Gamified Process Table + Fault Injector */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden">
            {/* Table Toolbar */}
            <div className="p-4 border-b border-slate-800 flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                {/* Interactive Filter Tabs */}
                <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-lg border border-slate-800 overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => setFilterMode('all')}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      filterMode === 'all'
                        ? 'bg-slate-800 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Todos ({processes.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode('anomalies')}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      filterMode === 'anomalies'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Anomalías ({processes.filter((p) => p.isProblematic).length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode('orphans')}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      filterMode === 'orphans'
                        ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Huérfanos ({processes.filter((p) => !p.parentAlive).length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode('io_heavy')}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      filterMode === 'io_heavy'
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Alto I/O
                  </button>
                </div>

                {/* View Mode Toggle: Table vs PPID Hierarchy Tree */}
                <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-lg border border-slate-800 shrink-0">
                  <button
                    type="button"
                    onClick={() => setViewMode('table')}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      viewMode === 'table'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <List className="w-3.5 h-3.5" />
                    <span>Tabla</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('tree')}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      viewMode === 'tree'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <GitBranch className="w-3.5 h-3.5" />
                    <span>Árbol PPID</span>
                  </button>
                </div>
              </div>

              {/* Search Input */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar proceso por nombre, PID, ruta o proceso padre (PPID)..."
                  aria-label="Buscar proceso por nombre o PID"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            {/* View Mode 1: Flat Process Table */}
            {viewMode === 'table' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400 bg-slate-950/60">
                      <th className="py-2.5 px-3">Proceso / Estado</th>
                      <th className="py-2.5 px-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleSortClick('pid')}
                          className="inline-flex items-center gap-1 hover:text-slate-200 whitespace-nowrap"
                        >
                          <span>PID</span>
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="py-2.5 px-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleSortClick('cpu')}
                          className="inline-flex items-center gap-1 hover:text-slate-200 whitespace-nowrap"
                        >
                          <span>CPU %</span>
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="py-2.5 px-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleSortClick('ram')}
                          className="inline-flex items-center gap-1 hover:text-slate-200 whitespace-nowrap"
                        >
                          <span>RAM</span>
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="py-2.5 px-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleSortClick('disk')}
                          className="inline-flex items-center gap-1 hover:text-slate-200 whitespace-nowrap"
                        >
                          <span>Disco</span>
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="py-2.5 px-3 text-right">Prioridad · Afinidad</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 text-xs">
                    {filteredProcesses.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-400">
                          No hay procesos que coincidan con el filtro actual.
                        </td>
                      </tr>
                    ) : (
                      filteredProcesses.map((proc) => {
                        const isSelected = selectedProcess?.pid === proc.pid;
                        const statePrefix = proc.isProblematic
                          ? !proc.parentAlive
                            ? '▲ HUÉRFANO'
                            : proc.memoryLeakRateMbPerSec > 0
                            ? '▲ FUGA RAM'
                            : '◆ CUELLO BOTELLA'
                          : proc.fixedByStudent
                          ? '● OPTIMIZADO'
                          : '● NOMINAL';

                        const stateColor = proc.isProblematic
                          ? 'text-red-400'
                          : proc.fixedByStudent
                          ? 'text-emerald-400'
                          : 'text-slate-400';

                        return (
                          <tr
                            key={proc.pid}
                            onClick={() => onSelectPid(proc.pid)}
                            className={`cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-sky-950/50 hover:bg-sky-950/70'
                                : 'hover:bg-slate-800/40'
                            }`}
                          >
                            <td className="py-2.5 px-3">
                              <div className="font-mono font-semibold text-slate-100 flex items-center gap-2">
                                <span>{proc.name}</span>
                                {!proc.signed && (
                                  <span className="text-[11px] font-sans font-normal text-amber-400">
                                    · Sin firma
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5 flex flex-wrap items-center gap-1.5">
                                <span className={`font-mono font-medium ${stateColor}`}>
                                  {statePrefix}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="truncate max-w-[230px]">{proc.description}</span>
                              </div>
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-300">
                              {proc.pid}
                            </td>
                            <td
                              className={`py-2.5 px-2 text-right font-mono tabular-nums font-semibold ${
                                proc.baseCpu >= 30
                                  ? 'text-red-400'
                                  : proc.baseCpu >= 15
                                  ? 'text-amber-300'
                                  : 'text-slate-200'
                              }`}
                            >
                              {proc.baseCpu.toFixed(1)}%
                            </td>
                            <td
                              className={`py-2.5 px-2 text-right font-mono tabular-nums ${
                                proc.baseRamMb >= 3000 || proc.memoryLeakRateMbPerSec > 0
                                  ? 'text-red-400 font-semibold'
                                  : 'text-slate-200'
                              }`}
                            >
                              <div>{proc.baseRamMb.toFixed(0)} MB</div>
                              {proc.memoryLeakRateMbPerSec > 0 && (
                                <div className="text-[10px] text-red-400">
                                  +{proc.memoryLeakRateMbPerSec} MB/s
                                </div>
                              )}
                            </td>
                            <td
                              className={`py-2.5 px-2 text-right font-mono tabular-nums ${
                                proc.baseDiskMbps >= 50
                                  ? 'text-amber-400 font-semibold'
                                  : 'text-slate-300'
                              }`}
                            >
                              {proc.baseDiskMbps.toFixed(0)} MB/s
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">
                              <div
                                className={
                                  proc.priority === 'Tiempo Real' ||
                                  (proc.priority === 'Alta' && proc.isProblematic)
                                    ? 'text-amber-300 font-semibold'
                                    : 'text-slate-300'
                                }
                              >
                                {proc.priority}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                CPU [{proc.affinity.length === 8 ? '0–7 Todos' : proc.affinity.join(',')}]
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              /* View Mode 2: PPID Hierarchy Tree View */
              <div className="p-4 space-y-3 max-h-[480px] overflow-y-auto">
                {groupedByParent.map(([parentLabel, group]) => (
                  <div
                    key={parentLabel}
                    className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs font-mono border-b border-slate-800/80 pb-1.5">
                      <span className="text-slate-300 font-semibold">
                        Nodo Padre: {parentLabel}
                      </span>
                      <span
                        className={
                          group.parentAlive
                            ? 'text-emerald-400'
                            : 'text-red-400 font-semibold'
                        }
                      >
                        {group.parentAlive
                          ? '● Proceso Padre Activo'
                          : '▲ Proceso Padre Cerrado (Hijos Huérfanos)'}
                      </span>
                    </div>
                    <div className="pl-4 space-y-1.5">
                      {group.items.map((proc) => {
                        const isSelected = selectedProcess?.pid === proc.pid;
                        return (
                          <button
                            key={proc.pid}
                            type="button"
                            onClick={() => onSelectPid(proc.pid)}
                            className={`w-full text-left p-2 rounded-lg border text-xs font-mono flex items-center justify-between gap-2 transition-colors ${
                              isSelected
                                ? 'bg-sky-950/60 border-sky-500/60 text-white'
                                : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-700'
                            }`}
                          >
                            <div className="truncate">
                              <span className="text-slate-500 mr-1.5">└─</span>
                              <span className="font-semibold text-white">{proc.name}</span>
                              <span className="text-slate-400 ml-2">
                                (PID {proc.pid} · {proc.status})
                              </span>
                            </div>
                            <div className="shrink-0 tabular-nums text-[11px] text-slate-300">
                              CPU {proc.baseCpu.toFixed(0)}% · RAM {proc.baseRamMb.toFixed(0)} MB
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Interactive Fault Injector Bar for Free Practice */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <Zap className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong>Simulador de Incidentes en Vivo:</strong> Inyecta anomalías adicionales para entrenar respuesta rápida.
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onInjectFault('orphan_io')}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 transition-colors whitespace-nowrap"
              >
                + Inyectar Huérfano I/O
              </button>
              <button
                type="button"
                onClick={() => onInjectFault('memory_leak')}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-purple-300 border border-slate-700 transition-colors whitespace-nowrap"
              >
                + Inyectar Fuga RAM
              </button>
              <button
                type="button"
                onClick={() => onInjectFault('cpu0_realtime')}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-red-300 border border-slate-700 transition-colors whitespace-nowrap"
              >
                + Saturar Core 0 (Tiempo Real)
              </button>
            </div>
          </div>
        </div>

        {/* Right 5 Columns: Process Inspector, Priority & Core Affinity Optimizer */}
        <div className="lg:col-span-5 space-y-4">
          {selectedProcess ? (
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-5">
              {/* Header & Metadata */}
              <div className="border-b border-slate-800 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-mono text-sky-400">
                      INSPECTOR DE PROCESOS Y CONTROL DE RECURSOS
                    </p>
                    <h3 className="text-lg font-bold font-mono text-white mt-0.5">
                      {selectedProcess.name}
                    </h3>
                  </div>
                  <div className="text-right font-mono text-xs text-slate-400 tabular-nums">
                    <div>PID {selectedProcess.pid}</div>
                    <div>Hilos: {selectedProcess.threads}</div>
                  </div>
                </div>

                {/* Clean unboxed metadata lines */}
                <div className="mt-3 space-y-1 text-xs text-slate-300">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Proceso Padre (PPID {selectedProcess.ppid}):</span>
                    <span
                      className={`font-mono ${
                        selectedProcess.parentAlive ? 'text-slate-200' : 'text-red-400 font-semibold'
                      }`}
                    >
                      {selectedProcess.parentName}{' '}
                      {!selectedProcess.parentAlive && '· ▲ PADRE INEXISTENTE (HUÉRFANO)'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Ruta de Imagen:</span>
                    <span className="font-mono text-[11px] text-slate-300 truncate max-w-[260px]">
                      {selectedProcess.path}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Firma Digital / Usuario:</span>
                    <span className="font-mono">
                      {selectedProcess.signed ? 'Firmado (Verificado)' : '▲ No firmado (Riesgo)'} ·{' '}
                      {selectedProcess.user}
                    </span>
                  </div>
                </div>
              </div>

              {/* Educational Hint Box */}
              <div
                className={`rounded-lg p-3.5 border text-xs leading-relaxed ${
                  selectedProcess.isProblematic
                    ? 'bg-amber-950/40 border-amber-700/60 text-amber-200'
                    : 'bg-slate-950 border-slate-800 text-slate-300'
                }`}
              >
                <div className="flex items-center gap-2 font-semibold mb-1">
                  {selectedProcess.isProblematic ? (
                    <>
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Diagnóstico de Auditoría en Tiempo Real</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>Estado del Proceso</span>
                    </>
                  )}
                </div>
                <p>{selectedProcess.educationalHint}</p>
              </div>

              {/* Control 1: Process Priority Level */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-sky-400" />
                    <span>Prioridad de Planificación del Kernel</span>
                  </label>
                  <span className="text-[11px] font-mono text-slate-400">
                    Actual: {selectedProcess.priority}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {PRIORITY_LEVELS.map((level) => {
                    const active = selectedProcess.priority === level;
                    const isRealtime = level === 'Tiempo Real';
                    return (
                      <button
                        key={level}
                        type="button"
                        onClick={() => onChangePriority(selectedProcess.pid, level)}
                        className={`px-2.5 py-2 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap truncate ${
                          active
                            ? isRealtime
                              ? 'bg-red-500/20 border-red-500/60 text-red-200'
                              : 'bg-sky-500/20 border-sky-500/60 text-sky-200'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }`}
                      >
                        {level}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Control 2: Processor Core Affinity (CPU 0 - CPU 7) */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-sky-400" />
                    <span>Afinidad de Procesador (Núcleos Lógicos 0–7)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onSetAllCoresAffinity(selectedProcess.pid, [0, 1, 2, 3, 4, 5, 6, 7])
                      }
                      className="text-[11px] text-sky-400 hover:text-sky-300 underline whitespace-nowrap"
                    >
                      Todos (0–7)
                    </button>
                    <span className="text-slate-600">·</span>
                    <button
                      type="button"
                      onClick={() => onSetAllCoresAffinity(selectedProcess.pid, [4, 5, 6, 7])}
                      className="text-[11px] text-slate-400 hover:text-slate-200 underline whitespace-nowrap"
                    >
                      Aislar (4–7)
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((coreIdx) => {
                    const isAssigned = selectedProcess.affinity.includes(coreIdx);
                    return (
                      <button
                        key={coreIdx}
                        type="button"
                        onClick={() => onToggleCoreAffinity(selectedProcess.pid, coreIdx)}
                        className={`py-2 px-1 rounded-lg font-mono text-xs font-medium border transition-colors ${
                          isAssigned
                            ? 'bg-sky-500/20 border-sky-500/60 text-sky-200'
                            : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        CPU {coreIdx}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5">
                  Repartir hilos en múltiples núcleos reduce puntos calientes térmicos y evita ahogar las interrupciones del Core 0.
                </p>
              </div>

              {/* Control 3: Direct Process Actions (Kill / Restart Service) */}
              <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => onKillProcess(selectedProcess.pid)}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white transition-colors whitespace-nowrap"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Finalizar Tarea (PID {selectedProcess.pid})</span>
                </button>

                {selectedProcess.category === 'service' && (
                  <button
                    type="button"
                    onClick={() => onRestartService(selectedProcess.pid)}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white transition-colors whitespace-nowrap"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>Reiniciar Servicio y Purgar Heap</span>
                  </button>
                )}
              </div>
            </div>
          ) : null}

          {/* Live Intervention Audit Log */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                <Terminal className="w-4 h-4 text-sky-400" />
                <span>Registro de Intervenciones Técnicas (Bitácora de Sesión)</span>
              </div>
              <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                {actionLogs.length} eventos
              </span>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 max-h-40 overflow-y-auto space-y-2 font-mono text-xs">
              {actionLogs.length === 0 ? (
                <p className="text-slate-500">
                  Aún no has ejecutado intervenciones. Selecciona un proceso anómalo en la tabla para ajustar su afinidad, cambiar su prioridad o finalizar tareas huérfanas.
                </p>
              ) : (
                actionLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-2 text-[11px] leading-relaxed">
                    <span className="text-slate-500 tabular-nums shrink-0">[{log.timestamp}]</span>
                    <span
                      className={
                        log.impact === 'positive'
                          ? 'text-emerald-400'
                          : log.impact === 'negative'
                          ? 'text-red-400'
                          : 'text-sky-300'
                      }
                    >
                      {log.detail}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
