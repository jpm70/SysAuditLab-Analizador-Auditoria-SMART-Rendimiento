import React, { useState } from 'react';
import {
  DiagnosticScenario,
  EvaluationBreakdown,
  TechnicalReport,
  ActionLogEntry,
} from '../types/telemetry';
import {
  BOTTLENECK_OPTIONS,
  SMART_VERDICT_OPTIONS,
  THERMAL_MEMORY_VERDICT_OPTIONS,
  PREVENTIVE_ACTIONS_CATALOG,
} from '../data/scenarios';
import {
  FileText,
  CheckCircle2,
  XCircle,
  Download,
  Copy,
  Sparkles,
  ClipboardCheck,
  Award,
} from 'lucide-react';

interface TechnicalReportViewProps {
  scenario: DiagnosticScenario;
  report: TechnicalReport;
  onChangeReport: (updated: TechnicalReport) => void;
  /** Nota de la primera evaluación del intento (la que cuenta). */
  firstScore: number | null;
  /** Si las pistas del modo guiado han estado a la vista en algún momento. */
  guidedUsed: boolean;
  evaluation: EvaluationBreakdown | null;
  onEvaluate: () => void;
  actionLogs: ActionLogEntry[];
}

export const TechnicalReportView: React.FC<TechnicalReportViewProps> = ({
  scenario,
  report,
  onChangeReport,
  firstScore,
  guidedUsed,
  evaluation,
  onEvaluate,
  actionLogs,
}) => {
  const [copied, setCopied] = useState(false);

  const togglePreventiveAction = (actionId: string) => {
    const exists = report.selectedPreventiveActions.includes(actionId);
    const updated = exists
      ? report.selectedPreventiveActions.filter((id) => id !== actionId)
      : [...report.selectedPreventiveActions, actionId];
    onChangeReport({ ...report, selectedPreventiveActions: updated });
  };

  // La plantilla solo pone las cabeceras y tus intervenciones: la causa y la recomendación las escribes tú
  const handleInsertTemplate = () => {
    const logSummary =
      actionLogs.length > 0
        ? [...actionLogs].reverse().map((l) => `- [${l.timestamp}] ${l.detail}`).join('\n')
        : '- Sin intervenciones registradas aún.';

    const template = `DICTAMEN DE AUDITORÍA PREVENTIVA (${scenario.code} - ${scenario.workstationModel}):
1. SÍNTOMAS Y TELEMETRÍA OBSERVADA:


2. INTERVENCIONES DE ESTABILIZACIÓN EJECUTADAS:
${logSummary}

3. CAUSA RAÍZ Y RECOMENDACIÓN DE MANTENIMIENTO PREVENTIVO:
`;

    onChangeReport({ ...report, technicalNotes: report.technicalNotes.trim() ? `${report.technicalNotes.trim()}\n\n${template}` : template });
  };

  const modeLabel = guidedUsed ? 'Modo guiado (con pistas a la vista en algún momento)' : 'Modo examen (sin pistas)';

  const buildPlainTextReport = () => {
    const bottleneckLabel =
      BOTTLENECK_OPTIONS.find((o) => o.id === report.primaryBottleneck)?.label || 'No especificado';
    const smartLabel =
      SMART_VERDICT_OPTIONS.find((o) => o.id === report.smartVerdict)?.label || 'No especificado';
    const thermalLabel =
      THERMAL_MEMORY_VERDICT_OPTIONS.find((o) => o.id === report.thermalAndMemoryVerdict)?.label ||
      'No especificado';
    const actionsList = PREVENTIVE_ACTIONS_CATALOG.filter((a) =>
      report.selectedPreventiveActions.includes(a.id)
    )
      .map((a) => `  [X] (${a.category}) ${a.label}`)
      .join('\n');

    return `====================================================================
PARTE TÉCNICO DE AUDITORÍA Y MANTENIMIENTO PREVENTIVO
SysAudit Lab · Un Fantasma en el Sistema (https://www.unfantasmaenelsistema.com/)
====================================================================
ID Ticket: ${report.ticketId}
Técnico / Alumno: ${report.technicianName || 'Alumno de Laboratorio'}
Escenario Auditado: ${scenario.code} — ${scenario.title}
Equipo: ${scenario.workstationModel} (${scenario.cpuModel}, ${scenario.ramTotalGb} GB RAM)
Fecha: ${new Date().toLocaleString('es-ES')}
Modo de trabajo: ${modeLabel}
--------------------------------------------------------------------
1. DIAGNÓSTICO DE CUELLO DE BOTELLA PRINCIPAL:
${bottleneckLabel}

2. DICTAMEN DE SALUD S.M.A.R.T. (ALMACENAMIENTO):
${smartLabel}

3. DICTAMEN TÉRMICO Y DE MEMORIA / PAGINACIÓN:
${thermalLabel}

4. MEDIDAS CORRECTIVAS Y PREVENTIVAS PRESCRITAS:
${actionsList || '  (Ninguna seleccionada)'}

5. BITÁCORA DE INTERVENCIONES EN EL SISTEMA:
${
  actionLogs.length > 0
    ? actionLogs.map((l) => `  - [${l.timestamp}] ${l.detail}`).join('\n')
    : '  - Sin intervenciones registradas.'
}

6. OBSERVACIONES Y CONCLUSIÓN TÉCNICA:
${report.technicalNotes || '(Sin observaciones adicionales)'}
--------------------------------------------------------------------
CALIFICACIÓN DE LABORATORIO: ${
      firstScore !== null ? `${firstScore}/100 (primer intento)` : 'Pendiente de evaluar'
    }
====================================================================`;
  };

  const handleDownloadTxt = () => {
    const content = buildPlainTextReport();
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Parte_Tecnico_${scenario.code}_${report.ticketId}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleCopyReport = () => {
    navigator.clipboard.writeText(buildPlainTextReport());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left 7 Columns: Structured Preventive Maintenance Form */}
      <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-5">
        <div className="border-b border-slate-800 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <p className="text-xs font-mono text-sky-400">
              DOCUMENTACIÓN OFICIAL DE MANTENIMIENTO PREVENTIVO
            </p>
            <h3 className="text-lg font-bold text-white mt-0.5">
              Parte Técnico de Auditoría — {scenario.code}
            </h3>
          </div>
          <span className="font-mono text-xs text-slate-400 tabular-nums">
            Ticket #{report.ticketId} · {scenario.workstationModel}
          </span>
        </div>

        {/* Technician Name & Ticket */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Nombre del Técnico / Alumno
            </label>
            <input
              type="text"
              value={report.technicianName}
              onChange={(e) => onChangeReport({ ...report, technicianName: e.target.value })}
              placeholder="Ej. Ana García (2º SMR / ASIR)"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Código de Orden de Trabajo
            </label>
            <input
              type="text"
              value={report.ticketId}
              onChange={(e) => onChangeReport({ ...report, ticketId: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-500"
            />
          </div>
        </div>

        {/* 1. Primary Bottleneck Selector */}
        <div>
          <label className="block text-xs font-semibold text-slate-200 mb-2">
            1. Diagnóstico de Cuello de Botella Principal Detectado
          </label>
          <div className="space-y-1.5">
            {BOTTLENECK_OPTIONS.map((opt) => (
              <label
                key={opt.id}
                className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer text-xs transition-colors ${
                  report.primaryBottleneck === opt.id
                    ? 'bg-sky-950/50 border-sky-500/60 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="primaryBottleneck"
                  checked={report.primaryBottleneck === opt.id}
                  onChange={() => onChangeReport({ ...report, primaryBottleneck: opt.id })}
                  className="mt-0.5 accent-sky-500"
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* 2. S.M.A.R.T. Storage Health Verdict */}
        <div>
          <label className="block text-xs font-semibold text-slate-200 mb-2">
            2. Dictamen de Salud de Almacenamiento S.M.A.R.T.
          </label>
          <div className="space-y-1.5">
            {SMART_VERDICT_OPTIONS.map((opt) => (
              <label
                key={opt.id}
                className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer text-xs transition-colors ${
                  report.smartVerdict === opt.id
                    ? 'bg-sky-950/50 border-sky-500/60 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="smartVerdict"
                  checked={report.smartVerdict === opt.id}
                  onChange={() => onChangeReport({ ...report, smartVerdict: opt.id })}
                  className="mt-0.5 accent-sky-500"
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* 3. Thermal & Memory Verdict */}
        <div>
          <label className="block text-xs font-semibold text-slate-200 mb-2">
            3. Evaluación Térmica, Memoria Física y Archivo de Paginación
          </label>
          <div className="space-y-1.5">
            {THERMAL_MEMORY_VERDICT_OPTIONS.map((opt) => (
              <label
                key={opt.id}
                className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer text-xs transition-colors ${
                  report.thermalAndMemoryVerdict === opt.id
                    ? 'bg-sky-950/50 border-sky-500/60 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="thermalVerdict"
                  checked={report.thermalAndMemoryVerdict === opt.id}
                  onChange={() => onChangeReport({ ...report, thermalAndMemoryVerdict: opt.id })}
                  className="mt-0.5 accent-sky-500"
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* 4. Preventive Maintenance Checklist */}
        <div>
          <label className="block text-xs font-semibold text-slate-200 mb-2">
            4. Plan de Mantenimiento Preventivo y Acciones Correctivas (Selecciona las necesarias)
          </label>
          <div className="grid grid-cols-1 gap-1.5">
            {PREVENTIVE_ACTIONS_CATALOG.map((item) => {
              const checked = report.selectedPreventiveActions.includes(item.id);
              return (
                <label
                  key={item.id}
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer text-xs transition-colors ${
                    checked
                      ? 'bg-emerald-950/30 border-emerald-500/50 text-emerald-100'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => togglePreventiveAction(item.id)}
                    className="mt-0.5 accent-emerald-500"
                  />
                  <div>
                    <span className="font-mono text-[11px] text-slate-400">{item.category} · </span>
                    <span>{item.label}</span>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* 5. Written Technical Dictum */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-slate-200">
              5. Dictamen Técnico Redactado y Justificación Preventiva
            </label>
            <button
              type="button"
              onClick={handleInsertTemplate}
              className="text-xs text-sky-400 hover:text-sky-300 underline whitespace-nowrap"
            >
              Insertar cabeceras y mis intervenciones
            </button>
          </div>
          <textarea
            rows={5}
            value={report.technicalNotes}
            onChange={(e) => onChangeReport({ ...report, technicalNotes: e.target.value })}
            placeholder="Describe los síntomas, qué procesos causaban el problema y por qué, los valores S.M.A.R.T. que has visto y por qué prescribes estas medidas..."
            aria-label="Dictamen técnico"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>

        {/* Submit & Export Bar */}
        <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onEvaluate}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-slate-950 transition-colors whitespace-nowrap"
          >
            <ClipboardCheck className="w-4 h-4" />
            <span>Validar y Calificar Parte Técnico</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyReport}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors whitespace-nowrap"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{copied ? 'Copiado' : 'Copiar Informe'}</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadTxt}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Descargar .TXT</span>
            </button>
          </div>
        </div>
      </div>

      {/* Right 5 Columns: Live Grading Rubric & Feedback */}
      <div className="lg:col-span-5 space-y-4">
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Award className="w-5 h-5 text-sky-400" />
              <h4 className="text-sm font-bold text-white">
                Rúbrica de Evaluación Formativa
              </h4>
            </div>
            {firstScore !== null && (
              <span className="font-mono text-lg font-bold tabular-nums text-sky-400">
                {firstScore} / 100 pts
              </span>
            )}
          </div>

          {!evaluation ? (
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-xs text-slate-400 space-y-2 leading-relaxed">
              <p className="text-slate-200 font-medium">
                ¿Cómo se evalúa tu intervención en el simulador?
              </p>
              <p>
                1. <strong>Estabilización (40 pts):</strong> resolver cada proceso problemático con la acción adecuada (finalizar, reiniciar un servicio o corregir prioridad y afinidad) y dejar el equipo estable y sin estrangulamiento térmico. Finalizar procesos que funcionaban bien, o el trabajo del usuario cuando bastaba con reconfigurarlo, resta puntos.
              </p>
              <p>
                2. <strong>Diagnóstico (30 pts):</strong> causa raíz, dictamen S.M.A.R.T. y lectura térmica y de memoria.
              </p>
              <p>
                3. <strong>Parte técnico (30 pts):</strong> las medidas preventivas que necesita el caso (las que sobran restan) y un dictamen escrito por ti de al menos 80 caracteres.
              </p>
              <p>
                Solo cuenta la <strong>primera</strong> evaluación de cada intento; después puedes volver a evaluar para repasar, pero la nota no cambia.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* 3 Score Breakdown Bars */}
              <div className="grid grid-cols-3 gap-2 bg-slate-950 p-3 rounded-lg border border-slate-800 text-center font-mono tabular-nums">
                <div>
                  <div className="text-[10px] text-slate-400">Estabilización</div>
                  <div className="text-sm font-bold text-emerald-400 mt-0.5">
                    {evaluation.systemStabilizationScore} / 40
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Auditoría S.M.A.R.T.</div>
                  <div className="text-sm font-bold text-sky-400 mt-0.5">
                    {evaluation.smartAuditScore} / 30
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Parte Preventivo</div>
                  <div className="text-sm font-bold text-purple-400 mt-0.5">
                    {evaluation.preventiveReportScore} / 30
                  </div>
                </div>
              </div>

              <div className="text-xs font-mono text-slate-300 space-y-1">
                <div>
                  Nivel alcanzado: <strong className="text-white">{evaluation.gradeLabel}</strong>
                </div>
                <div className="text-slate-400">{modeLabel}</div>
                {firstScore !== null && evaluation.totalScore !== firstScore && (
                  <div className="text-amber-300">
                    Revisión: {evaluation.totalScore} / 100. La nota que cuenta es la del primer intento ({firstScore}).
                  </div>
                )}
              </div>

              {/* Detailed Feedback List */}
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {evaluation.feedbackItems.map((item, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg border text-xs leading-relaxed flex items-start gap-2.5 ${
                      item.passed
                        ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-200'
                        : 'bg-red-950/30 border-red-800/60 text-red-200'
                    }`}
                  >
                    {item.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div className="font-semibold">{item.category}</div>
                      <div className="text-slate-300 mt-0.5">{item.message}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 text-xs text-slate-300 space-y-1.5">
                <div className="font-semibold text-slate-100">Conclusión de referencia</div>
                <p className="leading-relaxed">{scenario.expectedReport.sampleTechnicalConclusion}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
