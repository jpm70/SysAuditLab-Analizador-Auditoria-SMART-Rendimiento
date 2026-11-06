import type { ActionLogEntry, PriorityLevel, ProcessItem } from '../types/telemetry';

export const ALL_CORES = [0, 1, 2, 3, 4, 5, 6, 7];

/** Prioridades aceptables para una carga de usuario o un servicio que compite por recursos. */
const SAFE_PRIORITIES: PriorityLevel[] = ['Baja', 'Por debajo de lo normal', 'Normal'];

export interface LogDraft {
  actionType: ActionLogEntry['actionType'];
  target: string;
  detail: string;
  impact: ActionLogEntry['impact'];
}

/** Proceso que el técnico ha finalizado, para la evaluación. */
export interface KilledRecord {
  pid: number;
  name: string;
  category: ProcessItem['category'];
  wasProblematic: boolean;
  recommendedAction: ProcessItem['recommendedAction'];
}

/** ¿Queda bien configurado según lo que pedía el caso? */
export function configurationFixes(p: ProcessItem): boolean {
  if (p.recommendedAction === 'lower_priority') return SAFE_PRIORITIES.includes(p.priority);
  if (p.recommendedAction === 'balance_affinity') {
    return SAFE_PRIORITIES.includes(p.priority) && ALL_CORES.every((c) => p.affinity.includes(c));
  }
  return false;
}

function withFixState(p: ProcessItem): ProcessItem {
  if (!p.isProblematic && !p.fixedByStudent) return p;
  if (p.recommendedAction !== 'lower_priority' && p.recommendedAction !== 'balance_affinity') return p;
  const fixed = configurationFixes(p);
  return { ...p, isProblematic: !fixed, fixedByStudent: fixed };
}

export type KillResult =
  | { blocked: true; log: LogDraft; warning: string }
  | { blocked: false; processes: ProcessItem[]; killed: KilledRecord; log: LogDraft };

export function killProcess(processes: ProcessItem[], pid: number): KillResult | null {
  const target = processes.find((p) => p.pid === pid);
  if (!target) return null;
  if (target.category === 'system_critical') {
    return {
      blocked: true,
      warning: `Has intentado finalizar "${target.name}" (PID ${target.pid}). En un equipo real, terminar un proceso crítico del sistema provoca un pantallazo azul inmediato (CRITICAL_PROCESS_DIED).`,
      log: {
        actionType: 'ALERT',
        target: target.name,
        detail: `Intento bloqueado de finalizar el proceso crítico ${target.name} (PID ${target.pid}).`,
        impact: 'negative',
      },
    };
  }
  const lostWork = target.recommendedAction === 'balance_affinity' || target.recommendedAction === 'lower_priority';
  return {
    blocked: false,
    processes: processes.filter((p) => p.pid !== pid),
    killed: {
      pid: target.pid,
      name: target.name,
      category: target.category,
      wasProblematic: target.isProblematic,
      recommendedAction: target.recommendedAction,
    },
    log: {
      actionType: 'KILL',
      target: target.name,
      detail: `Finalizado ${target.name} (PID ${target.pid}). Liberados ${target.baseRamMb.toFixed(0)} MB de RAM y ${target.baseCpu}% de CPU.`,
      impact: !target.isProblematic || lostWork ? 'negative' : 'positive',
    },
  };
}

export type RestartResult = { ok: false; log: LogDraft } | { ok: true; processes: ProcessItem[]; log: LogDraft };

/** Solo un servicio se puede reiniciar: reinicia con su consumo y prioridad por defecto. */
export function restartService(processes: ProcessItem[], pid: number): RestartResult | null {
  const target = processes.find((p) => p.pid === pid);
  if (!target) return null;
  if (target.category !== 'service') {
    return {
      ok: false,
      log: {
        actionType: 'ALERT',
        target: target.name,
        detail: `${target.name} no es un servicio de Windows: no se puede reiniciar desde el administrador de servicios.`,
        impact: 'neutral',
      },
    };
  }
  return {
    ok: true,
    processes: processes.map((p) =>
      p.pid !== pid
        ? p
        : {
            ...p,
            status: 'Ejecutando',
            baseCpu: 4,
            baseRamMb: 190,
            memoryLeakRateMbPerSec: 0,
            baseDiskMbps: 3,
            priority: 'Normal',
            isProblematic: false,
            fixedByStudent: target.isProblematic,
          }
    ),
    log: {
      actionType: 'RESTART',
      target: target.name,
      detail: `Reiniciado el servicio ${target.name} (PID ${target.pid}): arranca de nuevo con la memoria liberada y su prioridad por defecto.`,
      impact: target.isProblematic ? 'positive' : 'neutral',
    },
  };
}

export function changePriority(processes: ProcessItem[], pid: number, priority: PriorityLevel) {
  const target = processes.find((p) => p.pid === pid);
  if (!target) return null;
  const next = processes.map((p) =>
    p.pid !== pid
      ? p
      : withFixState({
          ...p,
          priority,
          // Con prioridad baja, el indexador o la precarga ceden el disco al resto
          baseDiskMbps: priority === 'Baja' && p.baseDiskMbps > 40 ? 12 : p.baseDiskMbps,
        })
  );
  const log: LogDraft = {
    actionType: 'PRIORITY',
    target: target.name,
    detail: `Prioridad de ${target.name} (PID ${target.pid}): "${target.priority}" → "${priority}".`,
    impact: priority === 'Tiempo Real' ? 'negative' : 'neutral',
  };
  return { processes: next, log };
}

export function setAffinity(processes: ProcessItem[], pid: number, cores: number[]) {
  const target = processes.find((p) => p.pid === pid);
  if (!target || cores.length === 0) return null;
  const sorted = Array.from(new Set(cores)).sort((a, b) => a - b);
  const next = processes.map((p) => (p.pid !== pid ? p : withFixState({ ...p, affinity: sorted })));
  const log: LogDraft = {
    actionType: 'AFFINITY',
    target: target.name,
    detail: `Afinidad de ${target.name} (PID ${target.pid}): núcleos [${sorted.join(', ')}].`,
    impact: 'neutral',
  };
  return { processes: next, log };
}

export function toggleCore(processes: ProcessItem[], pid: number, core: number) {
  const target = processes.find((p) => p.pid === pid);
  if (!target) return null;
  const has = target.affinity.includes(core);
  if (has && target.affinity.length <= 1) return null; // Windows exige al menos un núcleo
  return setAffinity(processes, pid, has ? target.affinity.filter((c) => c !== core) : [...target.affinity, core]);
}
