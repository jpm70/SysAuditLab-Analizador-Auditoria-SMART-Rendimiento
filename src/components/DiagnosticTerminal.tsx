import React, { useState, useRef, useEffect } from 'react';
import {
  DiagnosticScenario,
  ProcessItem,
  SmartDrive,
  TelemetryPoint,
} from '../types/telemetry';
import { Terminal, Play, Trash2, ChevronRight } from 'lucide-react';
import { runCommand, type LineType } from '../engine/terminal';
import { deviceNames, fanTempDelta } from '../engine/smart';

interface DiagnosticTerminalProps {
  scenario: DiagnosticScenario;
  processes: ProcessItem[];
  drives: SmartDrive[];
  latestTelemetry: TelemetryPoint;
  fanProfile: 'silent' | 'balanced' | 'performance';
  onKillProcess: (pid: number) => void;
}

interface TerminalLine {
  id: string;
  type: LineType;
  text: string;
}

export const DiagnosticTerminal: React.FC<DiagnosticTerminalProps> = ({
  scenario,
  processes,
  drives,
  latestTelemetry,
  fanProfile,
  onKillProcess,
}) => {
  const firstDevice = deviceNames(drives)[drives[0]?.id ?? ''] ?? '/dev/sda';
  const dataDrive = drives.map((d) => d.model.match(/\b([C-Z]):/)?.[1]).find(Boolean) ?? 'C';
  const quickCommands = [
    { cmd: 'help', label: 'help' },
    { cmd: 'tasklist', label: 'tasklist' },
    { cmd: 'wmic process get name,processid,parentprocessid', label: 'wmic process (PPID)' },
    { cmd: 'netstat -ano', label: 'netstat -ano' },
    { cmd: 'wmic diskdrive get model,status', label: 'wmic diskdrive' },
    { cmd: 'smartctl --scan', label: 'smartctl --scan' },
    { cmd: `smartctl -a ${firstDevice}`, label: `smartctl -a ${firstDevice}` },
    { cmd: `chkdsk ${dataDrive}:`, label: `chkdsk ${dataDrive}:` },
    { cmd: 'perfmon /report', label: 'perfmon /report' },
  ];
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<TerminalLine[]>([
    {
      id: 'init-1',
      type: 'output',
      text: `Símbolo del sistema (Administrador) — ${scenario.workstationModel} (${scenario.code}). Escribe "help" o pulsa un comando rápido.`,
    },
  ]);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  const addLines = (newEntries: Omit<TerminalLine, 'id'>[]) => {
    setLines((prev) => [
      ...prev,
      ...newEntries.map((e, i) => ({ ...e, id: `${Date.now()}-${i}-${Math.random()}` })),
    ]);
  };

  const executeCommand = (rawCmd: string) => {
    const trimmed = rawCmd.trim();
    if (!trimmed) return;
    const result = runCommand(trimmed, {
      processes,
      drives,
      latest: latestTelemetry,
      fanTempDelta: fanTempDelta(fanProfile),
      onKillProcess,
    });
    setInput('');
    if (result.clear) {
      setLines([]);
      return;
    }
    addLines([{ type: 'input', text: `C:\\Windows\\System32> ${trimmed}` }, ...result.lines]);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeCommand(input);
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
      {/* Top Bar */}
      <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Terminal className="w-4 h-4 text-sky-400 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-white">
              Consola de diagnóstico (símbolo del sistema)
            </h3>
            <p className="text-xs text-slate-400">
              Procesos y su padre, conexiones (<code className="font-mono text-sky-300">netstat -ano</code>), S.M.A.R.T. (<code className="font-mono text-sky-300">smartctl</code>) y sistema de archivos (<code className="font-mono text-sky-300">chkdsk</code>).
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setLines([])}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors whitespace-nowrap shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Limpiar Consola</span>
        </button>
      </div>

      {/* Quick Command Bar */}
      <div className="px-4 py-2.5 bg-slate-950/70 border-b border-slate-800 flex items-center gap-1.5 overflow-x-auto">
        <span className="text-[11px] font-mono text-slate-400 mr-1 shrink-0">
          Comandos rápidos:
        </span>
        {quickCommands.map((item) => (
          <button
            key={item.cmd}
            type="button"
            onClick={() => executeCommand(item.cmd)}
            className="px-2.5 py-1 rounded text-xs font-mono bg-slate-900 hover:bg-slate-800 text-sky-300 border border-slate-800 hover:border-sky-500/40 transition-colors whitespace-nowrap shrink-0"
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Terminal Output Viewport */}
      <div
        ref={containerRef}
        role="log"
        aria-label="Salida de la consola"
        className="p-4 bg-[#050811] font-mono text-xs h-80 overflow-y-auto space-y-2.5 select-text"
      >
        {lines.map((line) => (
          <pre
            key={line.id}
            className={`whitespace-pre-wrap break-words leading-relaxed ${
              line.type === 'input'
                ? 'text-sky-300 font-semibold'
                : line.type === 'error'
                ? 'text-red-400'
                : line.type === 'hint'
                ? 'text-amber-300'
                : 'text-slate-300'
            }`}
          >
            {line.text}
          </pre>
        ))}
      </div>

      {/* Command Input Form */}
      <form
        onSubmit={handleFormSubmit}
        className="p-3 bg-slate-950 border-t border-slate-800 flex items-center gap-2"
      >
        <span className="font-mono text-xs text-sky-400 flex items-center gap-1 shrink-0">
          <ChevronRight className="w-4 h-4" />
          <span>C:\Windows\System32&gt;</span>
        </span>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe un comando (ej. netstat -ano, taskkill /f /pid 6892, smartctl -a /dev/sda)..."
          aria-label="Comando"
          className="flex-1 bg-transparent font-mono text-xs text-white placeholder:text-slate-600 focus:outline-none"
        />
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-slate-950 transition-colors whitespace-nowrap shrink-0"
        >
          <Play className="w-3 h-3" />
          <span>Ejecutar</span>
        </button>
      </form>
    </div>
  );
};
