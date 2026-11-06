import type { ProcessItem, SmartDrive, TelemetryPoint } from '../types/telemetry';
import { attr, deviceNames, driveTemperature, isNvme, smartctlReport, wmiStatus } from './smart';

export type LineType = 'input' | 'output' | 'error' | 'hint';

export interface TerminalContext {
  processes: ProcessItem[];
  drives: SmartDrive[];
  latest: TelemetryPoint;
  fanTempDelta: number;
  onKillProcess: (pid: number) => void;
}

export interface TerminalOutput {
  lines: { type: LineType; text: string }[];
  clear?: boolean;
}

export const HELP_TEXT = [
  'COMANDOS DISPONIBLES',
  '  tasklist                         Procesos: nombre, PID, sesión, memoria y estado',
  '  wmic process get name,processid,parentprocessid   Proceso padre de cada proceso (PPID)',
  '  taskkill /f /pid <PID>           Finaliza un proceso',
  '  netstat -ano                     Conexiones TCP/UDP y PID propietario',
  '  wmic diskdrive get model,status  Estado S.M.A.R.T. resumido que da Windows',
  '  smartctl --scan                  Unidades y su nombre de dispositivo',
  '  smartctl -a <dispositivo>        Datos S.M.A.R.T. completos (ej. smartctl -a /dev/sda)',
  '  chkdsk <unidad>:                 Comprobación de solo lectura del sistema de archivos',
  '  perfmon /report                  Resumen de rendimiento del equipo',
  '  cls                              Limpia la pantalla',
].join('\n');

const DRIVE_LETTER_RE = /\b([C-Z]):/i;

/** Letra de unidad que aparece en el modelo («(Sistema C:)», «Volumen de Datos D:»…). */
export function driveLetter(d: SmartDrive): string | null {
  const m = d.model.match(/\b([C-Z]):/);
  return m ? m[1].toUpperCase() : null;
}

function remoteFor(p: ProcessItem): { proto: 'TCP' | 'UDP'; remote: string; state: string }[] {
  if (p.baseNetMbps <= 0) return [];
  if (p.baseNetMbps > 100) {
    return [
      { proto: 'TCP', remote: '185.220.101.44:4443', state: 'ESTABLISHED' },
      { proto: 'UDP', remote: '185.220.101.44:8080', state: '' },
    ];
  }
  return [{ proto: 'TCP', remote: '142.250.184.14:443', state: 'ESTABLISHED' }];
}

export function runCommand(raw: string, ctx: TerminalContext): TerminalOutput {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  const out = (text: string, type: LineType = 'output'): TerminalOutput => ({ lines: [{ type, text }] });
  const { processes, drives, latest } = ctx;
  const names = deviceNames(drives);

  if (lower === 'cls' || lower === 'clear') return { lines: [], clear: true };
  if (lower === 'help' || lower === '?') return out(HELP_TEXT);

  if (lower.startsWith('tasklist')) {
    const rows = processes.map((p) => {
      const session = p.user === 'SYSTEM' || p.user.startsWith('Window Manager') ? 'Services   0' : 'Console    1';
      const status = p.status === 'No responde (Colgado)' ? 'Not Responding' : 'Running';
      return `${p.name.padEnd(28).slice(0, 28)} ${String(p.pid).padStart(6)} ${session} ${`${Math.round(p.baseRamMb * 1024).toLocaleString('es-ES')} KB`.padStart(13)}  ${status}`;
    });
    return out(
      [
        'Nombre de imagen               PID Sesión     n.º  Uso de memoria  Estado',
        '========================= ======== ========= ==== ============== ==============',
        ...rows,
      ].join('\n')
    );
  }

  if (lower.startsWith('wmic process') || lower.startsWith('get-ciminstance')) {
    const alive = new Set(processes.map((p) => p.pid));
    return out(
      [
        'Name                          ParentProcessId  ProcessId',
        ...processes.map((p) => `${p.name.padEnd(30).slice(0, 30)}${String(p.ppid).padStart(15)}${String(p.pid).padStart(11)}`),
        '',
        `Procesos cuyo padre ya no existe: ${processes.filter((p) => !p.parentAlive && !alive.has(p.ppid)).map((p) => `${p.name} (PPID ${p.ppid})`).join(', ') || 'ninguno'}.`,
        'En Windows eso no es un fallo por sí mismo (explorer.exe tampoco tiene padre vivo): importa si el proceso debía haberse cerrado y sigue consumiendo.',
      ].join('\n')
    );
  }

  if (lower.startsWith('taskkill')) {
    const pidMatch = trimmed.match(/\/pid\s+(\d+)/i);
    if (!pidMatch) return out('ERROR: sintaxis no válida. Uso: taskkill /f /pid <PID>', 'error');
    const pid = Number(pidMatch[1]);
    const proc = processes.find((p) => p.pid === pid);
    if (!proc) return out(`ERROR: no se encontró el proceso "${pid}".`, 'error');
    ctx.onKillProcess(pid);
    return proc.category === 'system_critical'
      ? out(`ERROR: no se pudo terminar el proceso con PID ${pid}. Acceso denegado (${proc.name} es un proceso crítico del sistema).`, 'error')
      : out(`CORRECTO: se terminó el proceso con PID ${pid}.`);
  }

  if (lower.startsWith('netstat')) {
    const rows = processes.flatMap((p) =>
      remoteFor(p).map(
        (c, i) => `  ${c.proto.padEnd(5)}  ${`192.168.1.45:${54900 + (p.pid % 90) + i}`.padEnd(22)} ${c.remote.padEnd(22)} ${c.state.padEnd(13)} ${p.pid}`
      )
    );
    return out(
      [
        'Conexiones activas',
        '',
        '  Proto  Dirección local         Dirección remota       Estado        PID',
        ...rows,
        '  TCP    0.0.0.0:135             0.0.0.0:0              LISTENING     1020',
      ].join('\n')
    );
  }

  if (lower.startsWith('wmic diskdrive')) {
    return out(
      [
        'Model                                              Status',
        ...drives.map((d) => `${d.model.padEnd(50).slice(0, 50)} ${wmiStatus(d, driveTemperature(d, ctx.fanTempDelta))}`),
        '',
        'Status solo pasa a «Pred Fail» cuando la propia unidad declara el fallo (un valor normalizado llega a su umbral). Para ver los valores crudos usa smartctl -a.',
      ].join('\n')
    );
  }

  if (lower.startsWith('smartctl')) {
    if (/--scan/.test(lower)) {
      return out(drives.map((d) => `${names[d.id]} -d ${isNvme(d) ? 'nvme' : 'ata'} # ${names[d.id]}, ${d.model}`).join('\n'));
    }
    const dev = trimmed.match(/\/dev\/\S+/)?.[0];
    const drive = drives.find((d) => names[d.id] === dev);
    if (!drive) {
      return out(
        `${dev ?? 'Falta el dispositivo'}: no existe. Unidades de este equipo: ${drives.map((d) => names[d.id]).join(', ')} (smartctl --scan).`,
        'error'
      );
    }
    return out(smartctlReport(drive, driveTemperature(drive, ctx.fanTempDelta)));
  }

  if (lower.startsWith('chkdsk')) {
    const letter = trimmed.match(DRIVE_LETTER_RE)?.[1]?.toUpperCase();
    const drive = drives.find((d) => driveLetter(d) === letter);
    if (!letter || !drive) {
      return out(`Indica una unidad de este equipo: ${drives.map(driveLetter).filter(Boolean).map((l) => `${l}:`).join(', ')}`, 'hint');
    }
    const pending = isNvme(drive) ? 0 : attr(drive, 'C5')?.rawDecimal ?? 0;
    const repair = /\/(r|f|b|x)\b/i.test(trimmed);
    if (pending > 0 && repair) {
      return out(
        [
          `chkdsk ${letter}: ${trimmed.split(/\s+/).slice(2).join(' ')} — NO ejecutado.`,
          `La unidad tiene ${pending} sectores pendientes (S.M.A.R.T. C5). /r lee toda la superficie durante horas y /f puede mover o descartar datos de archivos dañados: en un disco que falla, eso puede rematarlo y perder lo que aún se podía salvar.`,
          'Orden correcto: 1) clonar la unidad con ddrescue a un disco sano; 2) sustituirla; 3) si hace falta, reparar el sistema de archivos sobre el clon.',
        ].join('\n'),
        'hint'
      );
    }
    return out(
      [
        'El tipo del sistema de archivos es NTFS.',
        'ADVERTENCIA: el parámetro /F no se especificó. Ejecutando CHKDSK en modo de solo lectura.',
        'Etapa 1: Examinando la estructura básica del sistema de archivos... Completado.',
        'Etapa 2: Examinando la vinculación de nombres de archivo... Completado.',
        'Etapa 3: Examinando descriptores de seguridad... Completado.',
        '',
        pending > 0
          ? `Windows ha examinado el sistema de archivos y no ha encontrado problemas en sus estructuras. Atención: chkdsk no lee los sectores de datos; los ${pending} sectores pendientes de esta unidad solo los ve S.M.A.R.T.`
          : 'Windows ha examinado el sistema de archivos y no ha encontrado problemas. No se requieren más acciones.',
      ].join('\n')
    );
  }

  if (lower.startsWith('perfmon')) {
    return out(
      [
        '=== INFORME DE DIAGNÓSTICO DEL SISTEMA (resumen) ===',
        `CPU            : ${latest.cpuTotal.toFixed(1)}% a ${latest.cpuFreqGhz.toFixed(2)} GHz, ${latest.cpuTempC.toFixed(0)} °C${latest.isThermalThrottling ? ' (frecuencia reducida por temperatura)' : ''}`,
        `Memoria        : ${latest.ramUsedGb.toFixed(1)} de ${latest.ramTotalGb} GB (${latest.ramPercent.toFixed(1)}%), ${latest.pageFaultsPerSec} errores de página/s`,
        `Disco          : ${latest.diskActivePercent.toFixed(0)}% de tiempo activo, latencia media ${latest.diskLatencyMs.toFixed(0)} ms`,
        `Red            : ${(latest.netRxMbps + latest.netTxMbps).toFixed(0)} Mbps`,
        `GPU            : ${latest.gpuPercent.toFixed(0)}% a ${latest.gpuTempC.toFixed(0)} °C`,
      ].join('\n')
    );
  }

  return out(`"${trimmed.split(/\s+/)[0]}" no se reconoce como un comando de este laboratorio. Escribe help para ver la lista.`, 'error');
}
