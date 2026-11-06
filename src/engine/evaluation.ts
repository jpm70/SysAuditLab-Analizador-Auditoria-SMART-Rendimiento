import type {
  DiagnosticScenario,
  EvaluationBreakdown,
  ProcessItem,
  TechnicalReport,
  TelemetryPoint,
} from '../types/telemetry';
import type { KilledRecord } from './processes';

/** Cabeceras que inserta la plantilla del parte: no cuentan como texto del técnico. */
export const TEMPLATE_HEADINGS = [
  'DICTAMEN DE AUDITORÍA PREVENTIVA',
  '1. SÍNTOMAS Y TELEMETRÍA OBSERVADA:',
  '2. INTERVENCIONES DE ESTABILIZACIÓN EJECUTADAS:',
  '3. CAUSA RAÍZ Y RECOMENDACIÓN DE MANTENIMIENTO PREVENTIVO:',
  '- Sin intervenciones registradas aún.',
];

/** Texto que ha escrito el técnico: quita las cabeceras de la plantilla y las líneas copiadas de la bitácora. */
export function authoredNotes(notes: string): string {
  return notes
    .split('\n')
    .filter((l) => !TEMPLATE_HEADINGS.some((h) => l.trim().startsWith(h)))
    .filter((l) => !/^- \[\d{2}:\d{2}:\d{2}\]/.test(l.trim()))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const MIN_AUTHORED_CHARS = 80;

export interface EvaluationInput {
  scenario: DiagnosticScenario;
  processes: ProcessItem[];
  killed: KilledRecord[];
  /** PIDs de procesos problemáticos inyectados durante la práctica. */
  injectedProblemPids: number[];
  report: TechnicalReport;
  latest: TelemetryPoint;
}

export function evaluate(input: EvaluationInput): EvaluationBreakdown & { penaltyPoints: number } {
  const { scenario, processes, killed, injectedProblemPids, report, latest } = input;
  const feedbackItems: EvaluationBreakdown['feedbackItems'] = [];

  // --- 1. Estabilización (40) ---------------------------------------------------
  const problemPids = new Set([
    ...scenario.initialProcesses.filter((p) => p.isProblematic).map((p) => p.pid),
    ...injectedProblemPids,
  ]);
  const remaining = processes.filter((p) => p.isProblematic);
  const solved = problemPids.size - remaining.filter((p) => problemPids.has(p.pid)).length;
  const procScore = Math.round((solved / Math.max(1, problemPids.size)) * 28);
  feedbackItems.push(
    remaining.length === 0
      ? { category: 'Procesos', passed: true, message: 'No queda ningún proceso causando el problema.' }
      : {
          category: 'Procesos',
          passed: false,
          message: `Quedan ${remaining.length} procesos que siguen causando el problema (${remaining.map((p) => p.name).join(', ')}).`,
        }
  );

  const stable = latest.systemStability >= 85 && !latest.isThermalThrottling;
  const stabilityScore = stable ? 12 : 4;
  feedbackItems.push({
    category: 'Estabilidad térmica y operativa',
    passed: stable,
    message: stable
      ? `Estabilidad del ${latest.systemStability}% y CPU a ${latest.cpuTempC.toFixed(0)} °C sin estrangulamiento térmico.`
      : `Estabilidad del ${latest.systemStability}% (CPU a ${latest.cpuTempC.toFixed(0)} °C${latest.isThermalThrottling ? ', con estrangulamiento térmico' : ''}).`,
  });

  // Daños colaterales: procesos legítimos finalizados y trabajo del usuario perdido
  const legitKilled = killed.filter((k) => !k.wasProblematic && k.category !== 'system_critical');
  const lostWork = killed.filter((k) => k.wasProblematic && (k.recommendedAction === 'balance_affinity' || k.recommendedAction === 'lower_priority'));
  const penaltyPoints = legitKilled.length * 8 + lostWork.length * 6;
  if (legitKilled.length) {
    feedbackItems.push({
      category: 'Procesos legítimos finalizados',
      passed: false,
      message: `Finalizaste procesos que funcionaban bien: ${legitKilled.map((k) => k.name).join(', ')} (−8 cada uno).`,
    });
  }
  if (lostWork.length) {
    feedbackItems.push({
      category: 'Trabajo del usuario perdido',
      passed: false,
      message: `${lostWork.map((k) => k.name).join(', ')} estaba mal configurado, no roto: bastaba con corregir su prioridad o su afinidad. Al finalizarlo se pierde el trabajo en curso (−6 cada uno).`,
    });
  }

  // --- 2. Diagnóstico (30) -------------------------------------------------------------
  const exp = scenario.expectedReport;
  const checks: [string, boolean, string, string][] = [
    ['Cuello de botella', report.primaryBottleneck === exp.correctBottleneck, 'Causa raíz bien identificada.', 'La causa raíz elegida no es la de este caso.'],
    ['Dictamen S.M.A.R.T.', report.smartVerdict === exp.correctSmartVerdict, 'Lectura correcta de los datos S.M.A.R.T. de las unidades.', 'Vuelve a la pestaña S.M.A.R.T.: valores crudos, umbrales y temperatura de cada unidad.'],
    ['Térmico y memoria', report.thermalAndMemoryVerdict === exp.correctThermalMemoryVerdict, 'Lectura correcta de temperaturas y memoria.', 'Lo elegido no coincide con lo que muestran las gráficas de telemetría.'],
  ];
  let diagnosisScore = 0;
  for (const [category, ok, good, bad] of checks) {
    if (ok) diagnosisScore += 10;
    feedbackItems.push({ category, passed: ok, message: ok ? good : bad });
  }

  // --- 3. Parte técnico (30) -------------------------------------------------------------
  const required = exp.requiredPreventiveActions;
  const chosen = report.selectedPreventiveActions;
  const matched = required.filter((id) => chosen.includes(id)).length;
  const extras = chosen.filter((id) => !required.includes(id)).length;
  // Las medidas que no corresponden restan media medida: marcarlas todas no sirve
  const actionScore = Math.max(0, Math.round(((matched - extras * 0.5) / required.length) * 20));
  feedbackItems.push({
    category: 'Plan preventivo',
    passed: matched === required.length && extras === 0,
    message:
      matched === required.length && extras === 0
        ? 'Has elegido exactamente las medidas preventivas que necesita este caso.'
        : `${matched} de ${required.length} medidas necesarias${extras ? ` y ${extras} que no corresponden a este caso (restan)` : ''}.`,
  });

  const authored = authoredNotes(report.technicalNotes);
  const notesOk = authored.length >= MIN_AUTHORED_CHARS;
  feedbackItems.push({
    category: 'Dictamen redactado',
    passed: notesOk,
    message: notesOk
      ? 'Dictamen técnico redactado con detalle.'
      : `El dictamen necesita al menos ${MIN_AUTHORED_CHARS} caracteres escritos por ti (la plantilla y la bitácora no cuentan); ahora tiene ${authored.length}.`,
  });

  const stabilization = procScore + stabilityScore;
  const reportScore = actionScore + (notesOk ? 10 : 0);
  const totalScore = Math.max(0, Math.min(100, stabilization + diagnosisScore + reportScore - penaltyPoints));
  const gradeLabel =
    totalScore >= 90
      ? 'Auditor sénior (sobresaliente)'
      : totalScore >= 75
      ? 'Técnico cualificado (notable)'
      : totalScore >= 55
      ? 'Apto en prácticas'
      : 'En formación (requiere revisión)';

  return {
    systemStabilizationScore: stabilization,
    smartAuditScore: diagnosisScore,
    preventiveReportScore: reportScore,
    totalScore,
    gradeLabel,
    feedbackItems,
    penaltyPoints,
  };
}
