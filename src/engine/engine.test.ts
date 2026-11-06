import { describe, expect, it, vi } from 'vitest';
import { DIAGNOSTIC_SCENARIOS, PREVENTIVE_ACTIONS_CATALOG } from '../data/scenarios';
import type { DiagnosticScenario, ProcessItem, TechnicalReport } from '../types/telemetry';
import { authoredNotes, evaluate } from './evaluation';
import { ALL_CORES, changePriority, configurationFixes, killProcess, restartService, setAffinity, type KilledRecord } from './processes';
import { NVME, deviceNames, isNvme, nvmeCriticalWarning, selfAssessmentPassed, shortSelfTest, smartctlReport, wmiStatus } from './smart';
import { computeTelemetrySnapshot } from './telemetry';
import { runCommand, type TerminalContext } from './terminal';

const NOTES = 'Disco y procesos revisados con telemetría, S.M.A.R.T. y consola; se documentan causa raíz, intervenciones y medidas preventivas.';

function goodReport(sc: DiagnosticScenario): TechnicalReport {
  return {
    technicianName: 'Ana',
    ticketId: 'X',
    primaryBottleneck: sc.expectedReport.correctBottleneck,
    smartVerdict: sc.expectedReport.correctSmartVerdict,
    thermalAndMemoryVerdict: sc.expectedReport.correctThermalMemoryVerdict,
    selectedPreventiveActions: [...sc.expectedReport.requiredPreventiveActions],
    technicalNotes: NOTES,
  };
}

/** Aplica a cada proceso problemático la acción que pide el caso, con las funciones del motor. */
function solve(sc: DiagnosticScenario) {
  let procs: ProcessItem[] = sc.initialProcesses.map((p) => ({ ...p, affinity: [...p.affinity] }));
  const killed: KilledRecord[] = [];
  for (const p of sc.initialProcesses.filter((x) => x.isProblematic)) {
    if (p.recommendedAction === 'kill') {
      const r = killProcess(procs, p.pid)!;
      if (!r.blocked) {
        procs = r.processes;
        killed.push(r.killed);
      }
    } else if (p.recommendedAction === 'restart_service') {
      const r = restartService(procs, p.pid)!;
      if (r.ok) procs = r.processes;
    } else {
      procs = changePriority(procs, p.pid, p.recommendedPriority ?? 'Normal')!.processes;
      if (p.recommendedAction === 'balance_affinity') procs = setAffinity(procs, p.pid, ALL_CORES)!.processes;
    }
  }
  const latest = computeTelemetrySnapshot(100, procs, sc.initialDrives, sc, 'performance');
  return { procs, killed, latest };
}

describe.each(DIAGNOSTIC_SCENARIOS.map((sc) => [sc.code, sc] as const))('%s', (_code, sc) => {
  it('con las acciones correctas el equipo queda estable y la nota es 100', () => {
    const { procs, killed, latest } = solve(sc);
    expect(procs.filter((p) => p.isProblematic)).toEqual([]);
    expect(latest.isThermalThrottling).toBe(false);
    expect(latest.systemStability).toBeGreaterThanOrEqual(85);
    const ev = evaluate({ scenario: sc, processes: procs, killed, injectedProblemPids: [], report: goodReport(sc), latest });
    expect(ev.totalScore).toBe(100);
  });

  it('sin hacer nada el equipo no está estable y no se aprueba', () => {
    const latest = computeTelemetrySnapshot(100, sc.initialProcesses, sc.initialDrives, sc, sc.initialFanProfile);
    expect(latest.systemStability).toBeLessThan(85);
    const ev = evaluate({
      scenario: sc,
      processes: sc.initialProcesses,
      killed: [],
      injectedProblemPids: [],
      report: { ...goodReport(sc), primaryBottleneck: '', smartVerdict: '', thermalAndMemoryVerdict: '', selectedPreventiveActions: [], technicalNotes: '' },
      latest,
    });
    expect(ev.totalScore).toBeLessThan(20);
  });

  it('marcar todas las medidas preventivas no da la nota máxima', () => {
    const { procs, killed, latest } = solve(sc);
    const report = { ...goodReport(sc), selectedPreventiveActions: PREVENTIVE_ACTIONS_CATALOG.map((a) => a.id) };
    expect(evaluate({ scenario: sc, processes: procs, killed, injectedProblemPids: [], report, latest }).totalScore).toBeLessThan(100);
  });

  it('finalizar todo lo que no es crítico penaliza (si hay algo legítimo o reconfigurable)', () => {
    const victims = sc.initialProcesses.filter(
      (p) => p.category !== 'system_critical' && (!p.isProblematic || p.recommendedAction === 'balance_affinity' || p.recommendedAction === 'lower_priority')
    );
    if (victims.length === 0) return;
    let procs = sc.initialProcesses;
    const killed: KilledRecord[] = [];
    for (const p of sc.initialProcesses) {
      const r = killProcess(procs, p.pid)!;
      if (!r.blocked) {
        procs = r.processes;
        killed.push(r.killed);
      }
    }
    const latest = computeTelemetrySnapshot(100, procs, sc.initialDrives, sc, 'performance');
    const ev = evaluate({ scenario: sc, processes: procs, killed, injectedProblemPids: [], report: goodReport(sc), latest });
    expect(ev.penaltyPoints).toBeGreaterThan(0);
    expect(ev.totalScore).toBeLessThan(100);
  });

  it('datos coherentes: nombres reales, PID únicos y cada problema con su acción', () => {
    const pids = sc.initialProcesses.map((p) => p.pid);
    expect(new Set(pids).size).toBe(pids.length);
    for (const p of sc.initialProcesses) {
      expect(p.name).not.toMatch(/_Orphan|_Superfetch|\(.*\)/);
      expect(p.name).toMatch(/\.exe$|^System$|^MemCompression$/);
      if (p.isProblematic) expect(['kill', 'restart_service', 'lower_priority', 'balance_affinity']).toContain(p.recommendedAction);
      if (p.recommendedAction === 'restart_service') expect(p.category).toBe('service');
    }
  });

  it('S.M.A.R.T.: NVMe con su registro de salud y ATA con los tipos de smartctl', () => {
    for (const d of sc.initialDrives) {
      if (isNvme(d)) {
        const ids = Object.values(NVME) as string[];
        for (const a of d.attributes) expect(ids).toContain(a.idHex);
        expect(d.healthPercent).toBe(100 - d.attributes.find((a) => a.idHex === NVME.percentageUsed)!.rawDecimal);
      } else {
        for (const a of d.attributes.filter((x) => ['09', 'C2', 'C5', 'C6'].includes(x.idHex))) expect(a.isCriticalPreFail, a.idHex).toBe(false);
        for (const a of d.attributes.filter((x) => ['01', '05'].includes(x.idHex))) expect(a.isCriticalPreFail, a.idHex).toBe(true);
      }
      expect(d.model).toMatch(/\b[C-Z]:/);
    }
  });
});

describe('procesos', () => {
  const sc3 = DIAGNOSTIC_SCENARIOS.find((s) => s.id === 'scenario-3-thermal-affinity')!;
  const cad = sc3.initialProcesses.find((p) => p.recommendedAction === 'balance_affinity')!;

  it('una carga en Tiempo Real solo queda bien con prioridad ≤ Normal y los 8 núcleos', () => {
    let procs = changePriority(sc3.initialProcesses, cad.pid, 'Alta')!.processes;
    expect(procs.find((p) => p.pid === cad.pid)!.isProblematic).toBe(true);
    procs = changePriority(procs, cad.pid, 'Normal')!.processes;
    procs = setAffinity(procs, cad.pid, [0, 1, 2, 3])!.processes;
    expect(procs.find((p) => p.pid === cad.pid)!.isProblematic).toBe(true);
    procs = setAffinity(procs, cad.pid, ALL_CORES)!.processes;
    expect(configurationFixes(procs.find((p) => p.pid === cad.pid)!)).toBe(true);
    expect(procs.find((p) => p.pid === cad.pid)!.isProblematic).toBe(false);
    // Volver a Tiempo Real lo estropea otra vez
    procs = changePriority(procs, cad.pid, 'Tiempo Real')!.processes;
    expect(procs.find((p) => p.pid === cad.pid)!.isProblematic).toBe(true);
  });

  it('«Reiniciar» solo vale para servicios', () => {
    const sc4 = DIAGNOSTIC_SCENARIOS.find((s) => s.id === 'scenario-4-network-gpu')!;
    const sospechoso = sc4.initialProcesses.find((p) => p.category === 'suspicious')!;
    expect(restartService(sc4.initialProcesses, sospechoso.pid)).toMatchObject({ ok: false });
  });

  it('un proceso crítico no se puede finalizar', () => {
    const crit = DIAGNOSTIC_SCENARIOS[0].initialProcesses.find((p) => p.category === 'system_critical')!;
    expect(killProcess(DIAGNOSTIC_SCENARIOS[0].initialProcesses, crit.pid)).toMatchObject({ blocked: true });
  });

  it('finalizar el trabajo del usuario en vez de reconfigurarlo resta puntos', () => {
    const { procs, killed, latest } = solve(sc3);
    const base = evaluate({ scenario: sc3, processes: procs, killed, injectedProblemPids: [], report: goodReport(sc3), latest });
    const r = killProcess(sc3.initialProcesses, cad.pid);
    if (!r || r.blocked) throw new Error('no se pudo finalizar');
    const ev = evaluate({ scenario: sc3, processes: procs, killed: [...killed, r.killed], injectedProblemPids: [], report: goodReport(sc3), latest });
    expect(ev.totalScore).toBe(base.totalScore - 6);
  });
});

describe('parte técnico', () => {
  const sc = DIAGNOSTIC_SCENARIOS[0];

  it('la plantilla y la bitácora no cuentan como dictamen escrito', () => {
    const plantilla = `DICTAMEN DE AUDITORÍA PREVENTIVA (LAB-01 - X):\n1. SÍNTOMAS Y TELEMETRÍA OBSERVADA:\n\n2. INTERVENCIONES DE ESTABILIZACIÓN EJECUTADAS:\n- [10:00:01] Finalizado SearchProtocolHost.exe (PID 6892). Liberados 890 MB de RAM y 22% de CPU.\n- [10:00:05] Prioridad de svchost.exe (PID 1940): "Alta" → "Baja".\n\n3. CAUSA RAÍZ Y RECOMENDACIÓN DE MANTENIMIENTO PREVENTIVO:\n`;
    expect(authoredNotes(plantilla)).toBe('');
    const { procs, killed, latest } = solve(sc);
    const ev = evaluate({ scenario: sc, processes: procs, killed, injectedProblemPids: [], report: { ...goodReport(sc), technicalNotes: plantilla }, latest });
    expect(ev.totalScore).toBe(90);
    expect(authoredNotes(plantilla + NOTES)).toBe(NOTES);
  });

  it('la conclusión de referencia no aparece en la plantilla del parte', async () => {
    const src = await import('../components/TechnicalReportView?raw').catch(() => null);
    if (src) expect(String(src.default)).not.toMatch(/\$\{scenario\.expectedReport\.sampleTechnicalConclusion\}`/);
  });
});

describe('S.M.A.R.T.', () => {
  const sc1 = DIAGNOSTIC_SCENARIOS[0];
  const seagate = sc1.initialDrives.find((d) => d.model.includes('Seagate'))!;
  const toshiba = DIAGNOSTIC_SCENARIOS.find((s) => s.code === 'EXAM-05')!.initialDrives[0];
  const sabrent = DIAGNOSTIC_SCENARIOS.find((s) => s.id === 'scenario-3-thermal-affinity')!.initialDrives[0];

  it('con C5 > 0 pero sin llegar al umbral, la unidad dice PASSED y WMI «OK»', () => {
    expect(selfAssessmentPassed(seagate)).toBe(true);
    expect(wmiStatus(seagate)).toBe('OK');
    expect(smartctlReport(seagate, 44)).toContain('test result: PASSED');
    expect(smartctlReport(seagate, 44)).toMatch(/197 Current_Pending_Sector\s+0x0032.*Old_age/);
  });

  it('cuando un normalizado llega a su umbral: FAILED, FAILING_NOW y Pred Fail', () => {
    expect(wmiStatus(toshiba)).toBe('Pred Fail');
    expect(smartctlReport(toshiba, 56)).toContain('FAILING_NOW');
  });

  it('NVMe: el aviso crítico depende de la temperatura (y de la ventilación)', () => {
    expect(nvmeCriticalWarning(sabrent, 73)).toBe(0x02);
    expect(selfAssessmentPassed(sabrent, 73)).toBe(false);
    expect(nvmeCriticalWarning(sabrent, 64)).toBe(0);
    const out = smartctlReport(sabrent, 73);
    expect(out).toContain('SMART/Health Information (NVMe Log 0x02)');
    expect(out).toContain('Critical Warning:                   0x02');
    expect(out).not.toMatch(/ID# ATTRIBUTE_NAME/);
  });

  it('nombres de dispositivo de smartctl en Windows', () => {
    const names = deviceNames(sc1.initialDrives);
    expect(Object.values(names)).toEqual(['/dev/sda', '/dev/nvme0']);
  });

  it('el autotest corto falla por lectura con sectores pendientes y no por temperatura', () => {
    expect(shortSelfTest(seagate)).toMatchObject({ ok: false });
    expect(shortSelfTest(seagate).text).toContain('Completed: read failure');
    expect(shortSelfTest(sabrent).ok).toBe(true);
  });
});

describe('terminal', () => {
  const sc1 = DIAGNOSTIC_SCENARIOS[0];
  const ctx = (over: Partial<TerminalContext> = {}): TerminalContext => ({
    processes: sc1.initialProcesses,
    drives: sc1.initialDrives,
    latest: computeTelemetrySnapshot(1, sc1.initialProcesses, sc1.initialDrives, sc1, 'balanced'),
    fanTempDelta: 0,
    onKillProcess: vi.fn(),
    ...over,
  });

  it('chkdsk /f /r sobre un disco con sectores pendientes no se ejecuta y explica por qué', () => {
    const r = runCommand('chkdsk D: /f /r', ctx()).lines[0];
    expect(r.type).toBe('hint');
    expect(r.text).toContain('NO ejecutado');
    expect(r.text).toContain('ddrescue');
  });

  it('chkdsk sin parámetros es de solo lectura y no ve los sectores pendientes', () => {
    expect(runCommand('chkdsk D:', ctx()).lines[0].text).toContain('modo de solo lectura');
  });

  it('smartctl con nombres reales de dispositivo', () => {
    expect(runCommand('smartctl -a /dev/drive0', ctx()).lines[0].type).toBe('error');
    expect(runCommand('smartctl -a /dev/sda', ctx()).lines[0].text).toContain('Current_Pending_Sector');
    expect(runCommand('smartctl -a /dev/nvme0', ctx()).lines[0].text).toContain('Percentage Used:');
    expect(runCommand('smartctl --scan', ctx()).lines[0].text).toContain('/dev/nvme0 -d nvme');
  });

  it('netstat y perfmon no diagnostican por el alumno', () => {
    const net = runCommand('netstat -ano', ctx({ processes: DIAGNOSTIC_SCENARIOS[3].initialProcesses })).lines[0].text;
    expect(net).not.toMatch(/SOSPECHOSO|STREAMING|Mbps/);
    expect(net).toContain('ESTABLISHED');
    expect(runCommand('perfmon /report', ctx()).lines[0].text).not.toMatch(/anómal/i);
  });

  it('taskkill de un proceso crítico: acceso denegado', () => {
    const c = ctx();
    expect(runCommand('taskkill /f /pid 604', c).lines[0].text).toContain('Acceso denegado');
    expect(c.onKillProcess).toHaveBeenCalledWith(604);
  });
});
