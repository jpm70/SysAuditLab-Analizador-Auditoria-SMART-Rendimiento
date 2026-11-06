import React, { useState, useMemo, useEffect } from 'react';
import { SmartDrive, SmartAttribute, SmartHealthStatus } from '../types/telemetry';
import {
  NVME,
  driveTemperature,
  fanTempDelta as fanDelta,
  isNvme,
  nvmeCriticalWarning,
  shortSelfTest,
  temperatureId,
  temperatureStatus,
} from '../engine/smart';
import {
  HardDrive,
  RefreshCw,
  ShieldAlert,
  Info,
  Grid,
  Play,
} from 'lucide-react';

interface SmartAuditorProps {
  drives: SmartDrive[];
  fanProfile: 'silent' | 'balanced' | 'performance';
  /** En modo examen no se muestra la interpretación de cada atributo. */
  guidedMode: boolean;
}

const SEVERITY: Record<SmartHealthStatus, number> = { NOMINAL: 0, ADVERTENCIA: 1, CRÍTICO: 2 };

/** Valor y estado de un atributo con la temperatura actual (la ventilación cambia la temperatura y el aviso crítico NVMe). */
function liveAttr(d: SmartDrive, a: SmartAttribute, tempC: number): { value: number; status: SmartHealthStatus } {
  if (a.idHex === temperatureId(d)) return { value: tempC, status: temperatureStatus(d, tempC) };
  if (isNvme(d) && a.idHex === NVME.criticalWarning) {
    const cw = nvmeCriticalWarning(d, tempC);
    return { value: cw, status: cw ? 'CRÍTICO' : 'NOMINAL' };
  }
  return { value: a.rawDecimal, status: a.status };
}

/** Estado de la unidad: el peor de sus atributos con la temperatura actual. */
function liveDriveStatus(d: SmartDrive, tempC: number): SmartHealthStatus {
  return d.attributes.reduce<SmartHealthStatus>((worst, a) => {
    const st = liveAttr(d, a, tempC).status;
    return SEVERITY[st] > SEVERITY[worst] ? st : worst;
  }, 'NOMINAL');
}

interface LbaBlock {
  index: number;
  lbaHex: string;
  state: 'ok' | 'slow' | 'reallocated_05' | 'pending_c5';
  latencyMs: number;
}

export const SmartAuditor: React.FC<SmartAuditorProps> = ({
  drives,
  fanProfile,
  guidedMode,
}) => {
  const [selectedDriveId, setSelectedDriveId] = useState<string>(drives[0]?.id || 'drive-0');
  const [selectedAttrHex, setSelectedAttrHex] = useState<string | null>(null);
  const [selfTestRunning, setSelfTestRunning] = useState(false);
  const [selfTestResult, setSelfTestResult] = useState<string | null>(null);
  const [surfaceScanProgress, setSurfaceScanProgress] = useState<number>(128);
  const [isScanningSurface, setIsScanningSurface] = useState<boolean>(false);
  const [selectedBlockIndex, setSelectedBlockIndex] = useState<number | null>(null);

  const activeDrive = drives.find((d) => d.id === selectedDriveId) || drives[0];

  // Al cambiar de caso, el resultado de un autotest anterior ya no corresponde a estas unidades
  useEffect(() => {
    setSelfTestResult(null);
    setSelectedAttrHex(null);
    setSelectedBlockIndex(null);
  }, [drives]);
  const activeAttr: SmartAttribute | undefined =
    activeDrive?.attributes.find((a) => a.idHex === selectedAttrHex) ||
    activeDrive?.attributes.find((a) => a.status !== 'NOMINAL') ||
    activeDrive?.attributes[0];

  const fanTempDelta = fanDelta(fanProfile);

  // Build deterministic 128-block LBA surface map from drive S.M.A.R.T. attributes
  const lbaBlocks: LbaBlock[] = useMemo(() => {
    if (!activeDrive) return [];
    // En NVMe no hay sectores reasignados ni pendientes como en ATA (el 05h es la vida útil consumida)
    const reallocCount = isNvme(activeDrive) ? 0 : activeDrive.attributes.find((a) => a.idHex === '05')?.rawDecimal || 0;
    const pendingCount = isNvme(activeDrive) ? 0 : activeDrive.attributes.find((a) => a.idHex === 'C5')?.rawDecimal || 0;

    const visualRealloc = Math.min(18, Math.ceil(reallocCount / 4));
    const visualPending = Math.min(12, Math.ceil(pendingCount / 2));

    const blocks: LbaBlock[] = [];
    for (let i = 0; i < 128; i++) {
      const lbaAddr = (0x00400000 + i * 0x1080).toString(16).toUpperCase().padStart(8, '0');
      let state: LbaBlock['state'] = 'ok';
      let latencyMs = activeDrive.interfaceType.includes('NVMe') ? 1 : 6;

      // Place pending sectors around block 42..65
      if (visualPending > 0 && i >= 44 && i < 44 + visualPending) {
        state = 'pending_c5';
        latencyMs = 460 + (i % 5) * 35;
      } else if (visualRealloc > 0 && i >= 68 && i < 68 + visualRealloc) {
        state = 'reallocated_05';
        latencyMs = 18 + (i % 4) * 4;
      } else if (
        !isNvme(activeDrive) &&
        (reallocCount > 0 || activeDrive.overallStatus !== 'NOMINAL') &&
        (i === 39 || i === 43 || i === 66 || i === 95 || i === 104)
      ) {
        state = 'slow';
        latencyMs = 95 + (i % 3) * 28;
      } else {
        latencyMs += i % 4;
      }

      blocks.push({
        index: i,
        lbaHex: `0x${lbaAddr}`,
        state,
        latencyMs,
      });
    }
    return blocks;
  }, [activeDrive]);

  const handleRunShortTest = () => {
    setSelfTestRunning(true);
    setSelfTestResult(null);
    setTimeout(() => {
      setSelfTestRunning(false);
      setSelfTestResult(shortSelfTest(activeDrive).text);
    }, 650);
  };

  const handleStartSurfaceScan = () => {
    if (isScanningSurface) return;
    setIsScanningSurface(true);
    setSurfaceScanProgress(0);
    let current = 0;
    const timer = setInterval(() => {
      current += 8;
      if (current >= 128) {
        setSurfaceScanProgress(128);
        setIsScanningSurface(false);
        clearInterval(timer);
      } else {
        setSurfaceScanProgress(current);
      }
    }, 80);
  };

  if (!activeDrive) return null;

  const currentDriveTemp = driveTemperature(activeDrive, fanTempDelta);
  const nvme = isNvme(activeDrive);
  const pendingAttr = nvme ? undefined : activeDrive.attributes.find((a) => a.idHex === 'C5');
  const hasPendingSectors = Boolean(pendingAttr && pendingAttr.rawDecimal > 0);
  const inspectedBlock =
    selectedBlockIndex !== null
      ? lbaBlocks[selectedBlockIndex]
      : lbaBlocks.find((b) => b.state === 'pending_c5') ||
        lbaBlocks.find((b) => b.state === 'reallocated_05') ||
        lbaBlocks[0];

  return (
    <div className="space-y-6">
      {/* Drive Selector Strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {drives.map((drive) => {
          const isSelected = drive.id === activeDrive.id;
          const driveTemp = driveTemperature(drive, fanTempDelta);
          const live = liveDriveStatus(drive, driveTemp);
          const statusLabel =
            live === 'CRÍTICO'
              ? '▲ CRÍTICO'
              : live === 'ADVERTENCIA'
              ? '◆ ADVERTENCIA'
              : '● CORRECTO';
          const statusColor =
            live === 'CRÍTICO'
              ? 'text-red-400'
              : live === 'ADVERTENCIA'
              ? 'text-amber-400'
              : 'text-emerald-400';

          return (
            <button
              key={drive.id}
              type="button"
              onClick={() => {
                setSelectedDriveId(drive.id);
                setSelectedAttrHex(null);
                setSelectedBlockIndex(null);
                setSelfTestResult(null);
              }}
              className={`text-left p-4 rounded-xl border transition-colors ${
                isSelected
                  ? 'bg-slate-900 border-sky-500/70'
                  : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <HardDrive className="w-5 h-5 text-sky-400 shrink-0" />
                  <div>
                    <div className="font-semibold text-sm text-white">{drive.model}</div>
                    <div className="text-xs text-slate-400 font-mono mt-0.5">
                      {drive.interfaceType} · S/N {drive.serial} · FW {drive.firmware}
                    </div>
                  </div>
                </div>
                <span className={`font-mono text-xs font-semibold tabular-nums ${statusColor}`}>
                  {statusLabel}
                </span>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-300">
                <span>{isNvme(drive) ? `Vida útil restante: ${drive.healthPercent}%` : `Salud estimada: ${drive.healthPercent}%`}</span>
                <span>·</span>
                <span className={temperatureStatus(drive, driveTemp) !== 'NOMINAL' ? 'text-red-400 font-semibold' : 'text-slate-300'}>
                  Temperatura: {driveTemp} °C
                </span>
                <span>·</span>
                <span>Encendido: {drive.powerOnHours} h</span>
                <span>·</span>
                <span>Ciclos: {drive.powerCount}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Main S.M.A.R.T. Table + Attribute Educational Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 8 cols: S.M.A.R.T. Hex Table + LBA Surface Block Map */}
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Tabla de Atributos S.M.A.R.T. — {activeDrive.model}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {nvme
                    ? 'NVMe no usa los atributos ATA (05, C5…): informa con el registro SMART/Health (log 02h). Haz clic en un campo para ver qué significa.'
                    : 'Haz clic en una fila para ver qué mide el atributo y cómo se interpreta.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRunShortTest}
                  disabled={selfTestRunning}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 transition-colors whitespace-nowrap"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${selfTestRunning ? 'animate-spin' : ''}`} />
                  <span>{selfTestRunning ? 'Verificando...' : 'Autotest S.M.A.R.T.'}</span>
                </button>


              </div>
            </div>

            {hasPendingSectors && (
              <div role="note" className="px-4 py-2.5 bg-amber-950/40 border-b border-amber-800/60 text-xs text-amber-200 flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Hay {pendingAttr?.rawDecimal} sectores pendientes. No fuerces su reasignación ni pases <code>chkdsk /r</code>: el disco los reasigna al escribir encima, y lo que contienen se pierde. Primero se clona la unidad (ddrescue) y se sustituye.
                </span>
              </div>
            )}

            {selfTestResult && (
              <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800 text-xs font-mono text-sky-300">
                {selfTestResult}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400 bg-slate-950/60">
                    <th className="py-2.5 px-3">{nvme ? 'Byte' : 'ID'}</th>
                    <th className="py-2.5 px-3">{nvme ? 'Campo del registro de salud' : 'Atributo S.M.A.R.T.'}</th>
                    {!nvme && <th className="py-2.5 px-2 text-right">Actual</th>}
                    {!nvme && <th className="py-2.5 px-2 text-right">Peor</th>}
                    <th className="py-2.5 px-2 text-right">Umbral</th>
                    <th className="py-2.5 px-3 text-right">{nvme ? 'Valor' : 'Valor crudo (Raw)'}</th>
                    <th className="py-2.5 px-3 text-right">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 text-xs">
                  {activeDrive.attributes.map((attr) => {
                    const isSelected = activeAttr?.idHex === attr.idHex;
                    const live = liveAttr(activeDrive, attr, currentDriveTemp);
                    const displayRaw =
                      nvme && attr.idHex === NVME.criticalWarning
                        ? `0x${live.value.toString(16).padStart(2, '0')}`
                        : live.value;
                    const displayStatus = live.status;

                    const statusText =
                      displayStatus === 'CRÍTICO'
                        ? '▲ CRÍTICO'
                        : displayStatus === 'ADVERTENCIA'
                        ? '◆ ADVERTENCIA'
                        : '● NOMINAL';

                    const statusColor =
                      displayStatus === 'CRÍTICO'
                        ? 'text-red-400 font-semibold'
                        : displayStatus === 'ADVERTENCIA'
                        ? 'text-amber-400 font-semibold'
                        : 'text-emerald-400';

                    return (
                      <tr
                        key={attr.idHex}
                        onClick={() => setSelectedAttrHex(attr.idHex)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-sky-950/50 hover:bg-sky-950/70'
                            : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-2.5 px-3 font-mono font-bold text-sky-400">
                          {nvme ? parseInt(attr.idHex, 16) : `0x${attr.idHex}`}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-slate-100">{attr.spanishName}</div>
                          <div className="text-[11px] font-mono text-slate-400">
                            {attr.name}
                            {!nvme && ` · ${attr.isCriticalPreFail ? 'Pre-fail' : 'Old_age'}`}
                          </div>
                        </td>
                        {!nvme && (
                          <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-200">
                            {attr.current}
                          </td>
                        )}
                        {!nvme && (
                          <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-400">
                            {attr.worst}
                          </td>
                        )}
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-400">
                          {attr.threshold > 0 ? `${attr.threshold}${nvme ? ` ${attr.unit}` : ''}` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-200">
                          <div>
                            {displayRaw} {nvme && attr.idHex === NVME.criticalWarning ? '' : attr.unit || ''}
                          </div>
                          {!nvme && <div className="text-[10px] text-slate-500">0x{attr.rawHex}</div>}
                        </td>
                        <td className={`py-2.5 px-3 text-right font-mono tabular-nums ${statusColor}`}>
                          {statusText}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Interactive LBA Surface Block Scanner (solo discos ATA: un NVMe no tiene superficie) */}
          {nvme ? (
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 text-xs text-slate-400 leading-relaxed">
              Un NVMe no tiene platos ni sectores que se reasignen como un disco mecánico: su salud se lee en el registro de arriba (aviso crítico, reserva disponible, vida útil consumida y errores de integridad).
            </div>
          ) : (
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <Grid className="w-4 h-4 text-sky-400 shrink-0" />
                <div>
                  <h4 className="text-sm font-semibold text-white">
                    Mapa de Superficie LBA y Tiempos de Acceso (128 Clústeres Muestreados)
                  </h4>
                  <p className="text-xs text-slate-400">
                    Haz clic en cualquier bloque para inspeccionar su dirección LBA hexadecimal y latencia de lectura en milisegundos.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleStartSurfaceScan}
                disabled={isScanningSurface}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors whitespace-nowrap shrink-0"
              >
                <Play className="w-3.5 h-3.5 text-emerald-400" />
                <span>{isScanningSurface ? 'Escaneando LBA...' : 'Re-escanear Superficie'}</span>
              </button>
            </div>

            {/* 16x8 Grid of LBA Blocks */}
            <div className="grid grid-cols-8 sm:grid-cols-16 gap-1.5 bg-slate-950 p-3.5 rounded-lg border border-slate-800">
              {lbaBlocks.map((blk) => {
                const scanned = blk.index < surfaceScanProgress;
                const isSelected = inspectedBlock?.index === blk.index;
                let cellStyle = 'bg-slate-900 border-slate-800 text-slate-600';
                if (scanned) {
                  if (blk.state === 'pending_c5') {
                    cellStyle = 'bg-red-500/80 border-red-400 text-white font-bold';
                  } else if (blk.state === 'reallocated_05') {
                    cellStyle = 'bg-sky-500/40 border-sky-400 text-sky-100';
                  } else if (blk.state === 'slow') {
                    cellStyle = 'bg-amber-500/50 border-amber-400 text-amber-100';
                  } else {
                    cellStyle = 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300';
                  }
                }

                return (
                  <button
                    key={blk.index}
                    type="button"
                    onClick={() => setSelectedBlockIndex(blk.index)}
                    title={`Bloque #${blk.index} (${blk.lbaHex}) — ${blk.latencyMs} ms`}
                    className={`h-6 rounded border text-[10px] font-mono tabular-nums flex items-center justify-center transition-transform ${cellStyle} ${
                      isSelected ? 'ring-2 ring-white scale-110 z-10' : 'hover:scale-105'
                    }`}
                  >
                    {scanned
                      ? blk.state === 'pending_c5'
                        ? '!'
                        : blk.state === 'reallocated_05'
                        ? 'R'
                        : blk.state === 'slow'
                        ? '~'
                        : '·'
                      : ''}
                  </button>
                );
              })}
            </div>

            {/* Legend & Selected Block Telemetry */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs font-mono text-slate-400 pt-1">
              <div className="flex flex-wrap items-center gap-4">
                <span className="text-emerald-400">· &lt;15ms Nominal</span>
                <span className="text-amber-300">~ 50-150ms Lento</span>
                <span className="text-sky-300">R Reasignado (Spare 0x05)</span>
                <span className="text-red-400 font-semibold">! Pendiente Ilegible (0xC5 &gt;400ms)</span>
              </div>
              {inspectedBlock && (
                <div className="text-slate-200 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-lg tabular-nums">
                  LBA {inspectedBlock.lbaHex} · Latencia: {inspectedBlock.latencyMs} ms ·{' '}
                  {inspectedBlock.state === 'pending_c5'
                    ? '▲ ERROR CRC PENDIENTE'
                    : inspectedBlock.state === 'reallocated_05'
                    ? '◆ REMAPEADO A SPARE AREA'
                    : inspectedBlock.state === 'slow'
                    ? '◆ LECTURA LENTA'
                    : '● ÓPTIMO'}
                </div>
              )}
            </div>
          </div>
          )}
        </div>

        {/* Right 4 cols: Pedagogical S.M.A.R.T. Attribute Interpreter */}
        <div className="lg:col-span-4 space-y-4">
          {activeAttr && (
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="border-b border-slate-800 pb-3">
                <p className="text-xs font-mono text-sky-400">
                  INTÉRPRETE TÉCNICO DE TELEMETRÍA S.M.A.R.T.
                </p>
                <h4 className="text-base font-bold text-white mt-1">
                  {nvme ? `Byte ${parseInt(activeAttr.idHex, 16)}` : `ID 0x${activeAttr.idHex}`} — {activeAttr.spanishName}
                </h4>
                <p className="text-xs font-mono text-slate-400 mt-0.5">{activeAttr.name}</p>
              </div>

              <div className={`grid ${nvme ? 'grid-cols-2' : 'grid-cols-3'} gap-2 bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-center tabular-nums`}>
                {!nvme && (
                  <div>
                    <div className="text-[10px] text-slate-400">Normalizado</div>
                    <div className="text-sm font-bold text-white mt-0.5">{activeAttr.current}</div>
                  </div>
                )}
                <div>
                  <div className="text-[10px] text-slate-400">Umbral</div>
                  <div className="text-sm font-bold text-amber-300 mt-0.5">{activeAttr.threshold > 0 ? activeAttr.threshold : '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">{nvme ? 'Valor' : 'Valor crudo'}</div>
                  <div className="text-sm font-bold text-sky-300 mt-0.5">
                    {liveAttr(activeDrive, activeAttr, currentDriveTemp).value}
                  </div>
                </div>
              </div>

              <div className="text-xs text-slate-300 leading-relaxed space-y-2">
                <div className="flex items-center gap-1.5 font-semibold text-slate-100">
                  <Info className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>Cómo interpretar este parámetro en auditoría:</span>
                </div>
                <p>
                  {guidedMode
                    ? activeAttr.explanation
                    : 'Modo examen: interpreta tú el valor comparándolo con el umbral, con los otros atributos y con lo que muestra la telemetría.'}
                </p>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 text-xs text-slate-300 space-y-1.5">
                <div className="font-semibold text-slate-200">
                  Regla de Oro para el Parte Preventivo:
                </div>
                <p className="text-slate-400 leading-relaxed">
                  En S.M.A.R.T., el valor <strong>Actual (Normalized)</strong> empieza en 100 o 200 y baja hacia el{' '}
                  <strong>Umbral (Threshold)</strong> conforme la unidad envejece. Sin embargo, en los atributos{' '}
                  <code className="text-sky-300">0x05</code> (Sectores Reasignados) y{' '}
                  <code className="text-sky-300">0xC5</code> (Sectores Pendientes), cualquier{' '}
                  <strong>valor crudo mayor que 0</strong> es una alerta temprana de fallo físico que exige respaldo inmediato, aunque smartctl marque C5 como Old_age y la unidad siga diciendo PASSED. En NVMe se miran el aviso crítico, la reserva disponible, la vida útil consumida y los errores de integridad.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
