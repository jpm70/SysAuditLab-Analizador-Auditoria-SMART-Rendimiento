import React, { useState, useRef, useEffect } from 'react';
import {
  DiagnosticScenario,
  ProcessItem,
  SmartDrive,
  TelemetryPoint,
} from '../types/telemetry';
import { Terminal, Play, Trash2, HelpCircle, ChevronRight } from 'lucide-react';

interface DiagnosticTerminalProps {
  scenario: DiagnosticScenario;
  processes: ProcessItem[];
  drives: SmartDrive[];
  latestTelemetry: TelemetryPoint;
  onKillProcess: (pid: number) => void;
  onRestartService: (pid: number) => void;
  onRemapPendingSectors: (driveId: string) => void;
}

interface TerminalLine {
  id: string;
  type: 'input' | 'output' | 'error' | 'success' | 'warning';
  text: string;
}

const QUICK_COMMANDS = [
  { cmd: 'help', label: 'help (Ayuda)' },
  { cmd: 'tasklist /v', label: 'tasklist /v (Procesos)' },
  { cmd: 'netstat -ano', label: 'netstat -ano (Red y PIDs)' },
  { cmd: 'smartctl -a /dev/drive0', label: 'smartctl -a (S.M.A.R.T.)' },
  { cmd: 'wmic diskdrive get status', label: 'wmic diskdrive (Estado WMI)' },
  { cmd: 'chkdsk D: /f /r', label: 'chkdsk /f /r (Remapeo LBA)' },
  { cmd: 'perfmon /report', label: 'perfmon /report (Resumen)' },
];

export const DiagnosticTerminal: React.FC<DiagnosticTerminalProps> = ({
  scenario,
  processes,
  drives,
  latestTelemetry,
  onKillProcess,
  onRestartService,
  onRemapPendingSectors,
}) => {
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<TerminalLine[]>([
    {
      id: 'init-1',
      type: 'output',
      text: `SysAudit Lab Diagnostic Shell v2.4 — Un Fantasma en el Sistema`,
    },
    {
      id: 'init-2',
      type: 'output',
      text: `Conectado a estación: ${scenario.workstationModel} (${scenario.code}). Escribe "help" o pulsa un comando rápido para auditar.`,
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

    const lower = trimmed.toLowerCase();
    const out: Omit<TerminalLine, 'id'>[] = [
      { type: 'input', text: `PS C:\\Windows\\System32> ${trimmed}` },
    ];

    if (lower === 'clear' || lower === 'cls') {
      setLines([]);
      return;
    }

    if (lower === 'help' || lower === '?') {
      out.push({
        type: 'output',
        text: [
          'COMANDOS DE AUDITORÍA Y DIAGNÓSTICO DISPONIBLES:',
          '  tasklist /v                  Lista todos los procesos activos con PID, PPID, RAM, CPU y estado.',
          '  taskkill /f /pid <PID>       Finaliza forzosamente el proceso con el PID indicado.',
          '  netstat -ano                 Muestra conexiones TCP/UDP abiertas, IPs remotas y el PID propietario.',
          '  wmic diskdrive get status    Consulta rápida WMI del estado general S.M.A.R.T.',
          '  smartctl -a /dev/drive0      Vuelca los registros hexadecimales S.M.A.R.T. completos de la unidad.',
          '  chkdsk D: /f /r              Escanea sectores defectuosos y fuerza el remapeo LBA (0xC5 -> 0x05).',
          '  perfmon /report              Ejecuta diagnóstico instantáneo de cuellos de botella y sensores.',
          '  cls                          Limpia la pantalla de la terminal.',
        ].join('\n'),
      });
    } else if (lower.startsWith('tasklist') || lower === 'ps' || lower === 'ps aux') {
      const header =
        'NOMBRE DE IMAGEN                 PID   PPID  ESTADO padre         CPU%    RAM(MB)  PRIORIDAD';
      const sep =
        '============================== ===== ====== ==================== ====== ========= ===================';
      const rows = processes.map((p) => {
        const nameCol = p.name.padEnd(30, ' ').slice(0, 30);
        const pidCol = String(p.pid).padStart(5, ' ');
        const ppidCol = String(p.ppid).padStart(6, ' ');
        const parentCol = (p.parentAlive ? 'VIVO (OK)' : 'MUERTO (HUÉRFANO)').padEnd(20, ' ');
        const cpuCol = `${p.baseCpu.toFixed(1)}%`.padStart(6, ' ');
        const ramCol = `${p.baseRamMb.toFixed(0)} MB`.padStart(9, ' ');
        return `${nameCol} ${pidCol} ${ppidCol} ${parentCol} ${cpuCol} ${ramCol}  ${p.priority}`;
      });
      out.push({
        type: 'output',
        text: [header, sep, ...rows].join('\n'),
      });
    } else if (lower.startsWith('taskkill')) {
      const pidMatch = lower.match(/(\d+)/);
      if (!pidMatch) {
        out.push({
          type: 'error',
          text: 'ERROR: Sintaxis incorrecta. Uso esperado: taskkill /f /pid <numero_PID> (ej. taskkill /f /pid 6892)',
        });
      } else {
        const targetPid = Number(pidMatch[1]);
        const targetProc = processes.find((p) => p.pid === targetPid);
        if (!targetProc) {
          out.push({
            type: 'error',
            text: `ERROR: No se encontró ningún proceso activo con el PID ${targetPid}.`,
          });
        } else if (targetProc.category === 'system_critical') {
          onKillProcess(targetPid);
          out.push({
            type: 'error',
            text: `ACCESO DENEGADO POR PROTECCIÓN DEL KERNEL: "${targetProc.name}" (PID ${targetPid}) es un proceso crítico del subsistema. Finalizarlo causaría BSOD (CRITICAL_PROCESS_DIED).`,
          });
        } else {
          onKillProcess(targetPid);
          out.push({
            type: 'success',
            text: `CORRECTO: Se envió la señal de terminación al proceso "${targetProc.name}" con PID ${targetPid}. Recursos liberados.`,
          });
        }
      }
    } else if (lower.startsWith('netstat')) {
      const linesNet = [
        'Conexiones activas (Auditoría de sockets TCP/UDP):',
        '  Proto  Dirección local        Dirección remota          Estado           PID   Proceso Asociado',
        '  -----  ---------------------  ------------------------  ---------------  ----- ----------------------------',
      ];
      processes.forEach((p) => {
        if (p.baseNetMbps > 100 || !p.signed) {
          linesNet.push(
            `  TCP    192.168.1.45:54912     185.220.101.44:4443       ESTABLISHED      ${String(
              p.pid
            ).padEnd(5)} ${p.name} [▲ SOSPECHOSO ${p.baseNetMbps} Mbps]`
          );
          linesNet.push(
            `  UDP    192.168.1.45:54913     185.220.101.44:8080       STREAMING        ${String(
              p.pid
            ).padEnd(5)} ${p.name}`
          );
        } else if (p.baseNetMbps > 0) {
          linesNet.push(
            `  TCP    192.168.1.45:51204     142.250.184.14:443        ESTABLISHED      ${String(
              p.pid
            ).padEnd(5)} ${p.name} (${p.baseNetMbps} Mbps)`
          );
        }
      });
      linesNet.push(
        '  TCP    127.0.0.1:49664        127.0.0.1:49665           ESTABLISHED      604   csrss.exe'
      );
      out.push({ type: 'output', text: linesNet.join('\n') });
    } else if (lower.startsWith('wmic diskdrive')) {
      const wmiLines = [
        'Model                                          SerialNumber     Status               Health',
        '---------------------------------------------- ---------------- -------------------- -------',
        ...drives.map((d) => {
          const wmiStatus =
            d.overallStatus === 'CRÍTICO'
              ? 'Pred Fail (CRÍTICO)'
              : d.overallStatus === 'ADVERTENCIA'
              ? 'Caution (WARN)'
              : 'OK (NOMINAL)';
          return `${d.model.padEnd(46).slice(0, 46)} ${d.serial.padEnd(16)} ${wmiStatus.padEnd(20)} ${d.healthPercent}%`;
        }),
        '',
        'NOTA DIDÁCTICA: WMI solo devuelve "Pred Fail" cuando un atributo cruza el umbral del fabricante. Para ver sectores pendientes (ID C5) antes del fallo total, ejecuta: smartctl -a /dev/drive0',
      ];
      out.push({ type: 'output', text: wmiLines.join('\n') });
    } else if (lower.startsWith('smartctl')) {
      const d = drives[0];
      const smartLines = [
        `smartctl 7.4 (build SysAudit) [x86_64-w64-mingw32]`,
        `=== START OF INFORMATION SECTION ===`,
        `Device Model:     ${d.model}`,
        `Serial Number:    ${d.serial}`,
        `Firmware Version: ${d.firmware}`,
        `User Capacity:    ${d.capacityGb} GB`,
        `SMART overall-health self-assessment test result: ${
          d.overallStatus === 'CRÍTICO' ? 'FAILED! (PRE-FAIL ALERT)' : 'PASSED'
        }`,
        ``,
        `ID# ATTRIBUTE_NAME          FLAG     VALUE WORST THRESH TYPE      RAW_VALUE`,
        ...d.attributes.map((a) => {
          const idDec = parseInt(a.idHex, 16);
          const idStr = `${String(idDec).padStart(3, ' ')} (0x${a.idHex})`;
          const nameStr = a.name.padEnd(23, ' ').slice(0, 23);
          const valStr = String(a.current).padStart(5, ' ');
          const worstStr = String(a.worst).padStart(5, ' ');
          const threshStr = String(a.threshold).padStart(6, ' ');
          const typeStr = (a.isCriticalPreFail ? 'Pre-fail' : 'Old_age').padEnd(9, ' ');
          return `${idStr} ${nameStr} 0x0032   ${valStr} ${worstStr} ${threshStr} ${typeStr} ${a.rawDecimal} ${
            a.unit || ''
          } [${a.status}]`;
        }),
      ];
      out.push({
        type: d.overallStatus === 'CRÍTICO' ? 'warning' : 'output',
        text: smartLines.join('\n'),
      });
    } else if (lower.startsWith('chkdsk')) {
      const targetDrive = drives[0];
      const pending = targetDrive.attributes.find((a) => a.idHex === 'C5');
      if (pending && pending.rawDecimal > 0) {
        onRemapPendingSectors(targetDrive.id);
        out.push({
          type: 'success',
          text: [
            `El tipo del sistema de archivos es NTFS.`,
            `Etapa 1: Examen de la estructura básica del sistema de archivos... Completado.`,
            `Etapa 4: Buscando clústeres defectuosos en los datos del usuario...`,
            `  Se detectaron ${pending.rawDecimal} sectores LBA pendientes de reasignación (S.M.A.R.T. ID 0xC5).`,
            `  Forzando remapeo lógico hacia el área de reserva (Spare Area ID 0x05)...`,
            `CORRECTO: Los sectores inestables han sido aislados y la cola de I/O ha quedado desbloqueada.`,
            `ADVERTENCIA PREVENTIVA: La unidad presenta degradación física. Realice clonado inmediato.`,
          ].join('\n'),
        });
      } else {
        out.push({
          type: 'output',
          text: `Windows examinó el sistema de archivos y no encontró sectores pendientes (0xC5 = 0) sin remapear.`,
        });
      }
    } else if (lower.startsWith('perfmon')) {
      out.push({
        type: latestTelemetry.systemStability < 75 ? 'warning' : 'success',
        text: [
          `=== RESUMEN DE DIAGNÓSTICO DE RENDIMIENTO (PERFMON) ===`,
          `Estabilidad Global del Sistema : ${latestTelemetry.systemStability}%`,
          `Uso de CPU / Frecuencia        : ${latestTelemetry.cpuTotal.toFixed(1)}% @ ${latestTelemetry.cpuFreqGhz.toFixed(
            2
          )} GHz (Temp: ${latestTelemetry.cpuTempC.toFixed(0)}°C ${
            latestTelemetry.isThermalThrottling ? '[▲ THERMAL THROTTLING]' : '[OK]'
          })`,
          `Memoria RAM / Paginación       : ${latestTelemetry.ramUsedGb.toFixed(1)}/${
            latestTelemetry.ramTotalGb
          } GB (${latestTelemetry.ramPercent.toFixed(1)}%) — ${
            latestTelemetry.pageFaultsPerSec
          } PageFaults/s ${latestTelemetry.isThrashing ? '[▲ THRASHING]' : '[OK]'}`,
          `Cola de Disco / Latencia       : ${latestTelemetry.diskActivePercent.toFixed(
            0
          )}% activo — Latencia media: ${latestTelemetry.diskLatencyMs.toFixed(0)} ms`,
          `Procesos Anómalos Detectados   : ${
            processes.filter((p) => p.isProblematic).length
          } activos`,
        ].join('\n'),
      });
    } else {
      out.push({
        type: 'error',
        text: `El término "${trimmed}" no se reconoce como un comando de auditoría. Escribe "help" para ver los comandos soportados.`,
      });
    }

    addLines(out);
    setInput('');
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
              Consola Interactiva de Diagnóstico de Bajo Nivel (PowerShell / SysAdmin CLI)
            </h3>
            <p className="text-xs text-slate-400">
              Audita procesos, sockets de red (<code className="font-mono text-sky-300">netstat -ano</code>), registros S.M.A.R.T. (<code className="font-mono text-sky-300">smartctl</code>) y ejecuta reparaciones por comandos.
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
        {QUICK_COMMANDS.map((item) => (
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
                : line.type === 'success'
                ? 'text-emerald-400'
                : line.type === 'warning'
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
          <span>PS C:\SysAudit&gt;</span>
        </span>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe un comando (ej. netstat -ano, tasklist /v, taskkill /f /pid 6892, smartctl -a)..."
          aria-label="Entrada de comando de diagnóstico"
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
