import React from 'react';
import { TelemetryPoint } from '../types/telemetry';
import { Cpu, HardDrive, MemoryStick, Network, Thermometer, Flame, Gauge } from 'lucide-react';

interface TelemetryChartsProps {
  history: TelemetryPoint[];
  latest: TelemetryPoint;
  fanProfile: 'silent' | 'balanced' | 'performance';
  onChangeFanProfile: (profile: 'silent' | 'balanced' | 'performance') => void;
  onSelectTab: (tab: 'telemetry' | 'smart' | 'report' | 'guide') => void;
}

function buildPolylinePoints(values: number[], maxVal: number, width: number, height: number): string {
  if (values.length === 0) return '';
  const stepX = width / Math.max(values.length - 1, 1);
  return values
    .map((val, idx) => {
      const clamped = Math.max(0, Math.min(maxVal, val));
      const x = idx * stepX;
      const y = height - (clamped / maxVal) * (height - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function buildAreaPath(values: number[], maxVal: number, width: number, height: number): string {
  if (values.length === 0) return '';
  const line = buildPolylinePoints(values, maxVal, width, height);
  return `M 0,${height} L ${line.replace(/ /g, ' L ')} L ${width},${height} Z`;
}

export const TelemetryCharts: React.FC<TelemetryChartsProps> = ({
  history,
  latest,
  fanProfile,
  onChangeFanProfile,
  onSelectTab,
}) => {
  const chartW = 360;
  const chartH = 92;

  const cpuValues = history.map((h) => h.cpuTotal);
  const ramValues = history.map((h) => h.ramPercent);
  const diskValues = history.map((h) => h.diskActivePercent);
  const netValues = history.map((h) => Math.min(1000, h.netRxMbps + h.netTxMbps));

  const cpuState =
    latest.cpuTempC >= 90 || latest.cpuTotal >= 90
      ? { label: '▲ CRÍTICO (THROTTLING)', color: 'text-red-400', stroke: '#f87171', fill: 'rgba(248,113,113,0.16)' }
      : latest.cpuTempC >= 78 || latest.cpuTotal >= 75
      ? { label: '◆ CARGA ELEVADA', color: 'text-amber-400', stroke: '#fbbf24', fill: 'rgba(251,191,36,0.15)' }
      : { label: '● NOMINAL', color: 'text-emerald-400', stroke: '#38bdf8', fill: 'rgba(56,189,248,0.15)' };

  const ramState =
    latest.ramPercent >= 90 || latest.isThrashing
      ? { label: '▲ THRASHING (PAGINACIÓN)', color: 'text-red-400', stroke: '#f87171', fill: 'rgba(248,113,113,0.16)' }
      : latest.ramPercent >= 78
      ? { label: '◆ PRESIÓN DE MEMORIA', color: 'text-amber-400', stroke: '#fbbf24', fill: 'rgba(251,191,36,0.15)' }
      : { label: '● NOMINAL', color: 'text-emerald-400', stroke: '#a855f7', fill: 'rgba(168,85,247,0.15)' };

  const diskState =
    latest.diskActivePercent >= 92 || latest.diskLatencyMs >= 150
      ? { label: '▲ CUELLO DE BOTELLA I/O', color: 'text-red-400', stroke: '#f87171', fill: 'rgba(248,113,113,0.16)' }
      : latest.diskActivePercent >= 70
      ? { label: '◆ TRÁFICO INTENSO', color: 'text-amber-400', stroke: '#fbbf24', fill: 'rgba(251,191,36,0.15)' }
      : { label: '● NOMINAL', color: 'text-emerald-400', stroke: '#10b981', fill: 'rgba(16,185,129,0.15)' };

  const totalNetMbps = latest.netRxMbps + latest.netTxMbps;
  const netGpuState =
    totalNetMbps >= 500 || latest.gpuTempC >= 85
      ? { label: '▲ ANOMALÍA RED / GPU', color: 'text-red-400', stroke: '#f87171', fill: 'rgba(248,113,113,0.16)' }
      : totalNetMbps >= 200 || latest.gpuPercent >= 70
      ? { label: '◆ ACTIVIDAD ALTA', color: 'text-amber-400', stroke: '#fbbf24', fill: 'rgba(251,191,36,0.15)' }
      : { label: '● NOMINAL', color: 'text-emerald-400', stroke: '#38bdf8', fill: 'rgba(56,189,248,0.15)' };

  return (
    <section aria-label="Panel de Telemetría en Tiempo Real" className="space-y-4">
      {/* Top 4 Oscilloscope Telemetry Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* 1. CPU & Thermal Card */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 text-slate-200 font-semibold text-sm">
                <Cpu className="w-4 h-4 text-sky-400 shrink-0" />
                <span>CPU y Temperatura</span>
              </div>
              <span className={`font-mono text-xs font-semibold tabular-nums ${cpuState.color}`}>
                {cpuState.label}
              </span>
            </div>

            <div className="flex items-baseline justify-between mb-3">
              <div>
                <span className="text-2xl font-bold font-mono tabular-nums text-white">
                  {latest.cpuTotal.toFixed(0)}%
                </span>
                <span className="text-xs text-slate-400 font-mono tabular-nums ml-2">
                  {latest.cpuFreqGhz.toFixed(2)} GHz
                </span>
              </div>
              <div className="text-right font-mono tabular-nums">
                <span
                  className={`text-sm font-semibold ${
                    latest.cpuTempC >= 90
                      ? 'text-red-400'
                      : latest.cpuTempC >= 78
                      ? 'text-amber-400'
                      : 'text-slate-300'
                  }`}
                >
                  {latest.cpuTempC.toFixed(0)}°C
                </span>
                <span className="text-xs text-slate-500 ml-1">Pkg</span>
              </div>
            </div>

            {/* Live Oscilloscope SVG */}
            <div className="relative bg-slate-950 border border-slate-800/80 rounded-lg overflow-hidden h-24 mb-3">
              <svg
                viewBox={`0 0 ${chartW} ${chartH}`}
                className="w-full h-full preserve-3d"
                preserveAspectRatio="none"
              >
                {/* Grid lines */}
                <line x1="0" y1={chartH * 0.25} x2={chartW} y2={chartH * 0.25} stroke="#1e293b" strokeDasharray="3 3" strokeWidth="1" />
                <line x1="0" y1={chartH * 0.5} x2={chartW} y2={chartH * 0.5} stroke="#1e293b" strokeDasharray="3 3" strokeWidth="1" />
                <line x1="0" y1={chartH * 0.75} x2={chartW} y2={chartH * 0.75} stroke="#1e293b" strokeDasharray="3 3" strokeWidth="1" />
                <path d={buildAreaPath(cpuValues, 100, chartW, chartH)} fill={cpuState.fill} />
                <polyline
                  fill="none"
                  stroke={cpuState.stroke}
                  strokeWidth="2"
                  points={buildPolylinePoints(cpuValues, 100, chartW, chartH)}
                />
              </svg>
              {latest.isThermalThrottling && (
                <div className="absolute top-1.5 left-2 right-2 flex items-center justify-between text-[11px] font-mono text-red-300 bg-red-950/90 border border-red-800/80 px-2 py-0.5 rounded">
                  <span>▲ THERMAL THROTTLING ACTIVO</span>
                  <span>-55% Reloj</span>
                </div>
              )}
            </div>
          </div>

          {/* 8 Logical Cores Mini Load Matrix */}
          <div>
            <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5 font-mono tabular-nums">
              <span>Distribución 8 Núcleos (Afinidad)</span>
              <span>C0: {latest.cpuCores[0]?.toFixed(0)}% · C7: {latest.cpuCores[7]?.toFixed(0)}%</span>
            </div>
            <div className="grid grid-cols-8 gap-1">
              {latest.cpuCores.map((coreLoad, idx) => {
                const isHot = coreLoad >= 90;
                const isMed = coreLoad >= 65;
                return (
                  <div key={idx} className="bg-slate-950 border border-slate-800 rounded p-1 text-center">
                    <div className="text-[10px] font-mono text-slate-400">C{idx}</div>
                    <div className="h-6 bg-slate-900 rounded-sm overflow-hidden flex items-end mt-0.5">
                      <div
                        className={`w-full transition-transform duration-150 ${
                          isHot ? 'bg-red-500' : isMed ? 'bg-amber-400' : 'bg-sky-400'
                        }`}
                        style={{ height: `${Math.min(100, Math.max(6, coreLoad))}%` }}
                      />
                    </div>
                    <div className="text-[10px] font-mono tabular-nums text-slate-300 mt-0.5">
                      {coreLoad.toFixed(0)}%
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 2. RAM & Pagefile Thrashing Card */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 text-slate-200 font-semibold text-sm">
                <MemoryStick className="w-4 h-4 text-purple-400 shrink-0" />
                <span>Memoria RAM y Paginación</span>
              </div>
              <span className={`font-mono text-xs font-semibold tabular-nums ${ramState.color}`}>
                {ramState.label}
              </span>
            </div>

            <div className="flex items-baseline justify-between mb-3">
              <div>
                <span className="text-2xl font-bold font-mono tabular-nums text-white">
                  {latest.ramPercent.toFixed(1)}%
                </span>
                <span className="text-xs text-slate-400 font-mono tabular-nums ml-2">
                  {latest.ramUsedGb.toFixed(1)} / {latest.ramTotalGb} GB
                </span>
              </div>
              <div className="text-right font-mono tabular-nums">
                <span
                  className={`text-xs font-semibold ${
                    latest.pageFaultsPerSec > 1000 ? 'text-red-400' : 'text-slate-400'
                  }`}
                >
                  {latest.pageFaultsPerSec.toFixed(0)} PF/s
                </span>
              </div>
            </div>

            <div className="relative bg-slate-950 border border-slate-800/80 rounded-lg overflow-hidden h-24 mb-3">
              <svg
                viewBox={`0 0 ${chartW} ${chartH}`}
                className="w-full h-full"
                preserveAspectRatio="none"
              >
                <line x1="0" y1={chartH * 0.25} x2={chartW} y2={chartH * 0.25} stroke="#1e293b" strokeDasharray="3 3" strokeWidth="1" />
                <line x1="0" y1={chartH * 0.5} x2={chartW} y2={chartH * 0.5} stroke="#1e293b" strokeDasharray="3 3" strokeWidth="1" />
                <line x1="0" y1={chartH * 0.75} x2={chartW} y2={chartH * 0.75} stroke="#1e293b" strokeDasharray="3 3" strokeWidth="1" />
                <path d={buildAreaPath(ramValues, 100, chartW, chartH)} fill={ramState.fill} />
                <polyline
                  fill="none"
                  stroke={ramState.stroke}
                  strokeWidth="2"
                  points={buildPolylinePoints(ramValues, 100, chartW, chartH)}
                />
              </svg>
              {latest.isThrashing && (
                <div className="absolute top-1.5 left-2 right-2 flex items-center justify-between text-[11px] font-mono text-red-300 bg-red-950/90 border border-red-800/80 px-2 py-0.5 rounded">
                  <span>▲ PAGEFILE.SYS SATURADO</span>
                  <span>Fuga Activa</span>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5 text-xs font-mono tabular-nums border-t border-slate-800/80 pt-2.5">
            <div className="flex justify-between text-slate-400">
              <span>Memoria Confirmada (Commit):</span>
              <span className="text-slate-200">{(latest.ramUsedGb * 1.18).toFixed(1)} GB</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Fallos de Página Duros (Disco):</span>
              <span className={latest.pageFaultsPerSec > 1000 ? 'text-red-400 font-semibold' : 'text-slate-200'}>
                {latest.pageFaultsPerSec} fallos/s
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Estado de Reserva Heap:</span>
              <span className={latest.isThrashing ? 'text-red-400' : 'text-emerald-400'}>
                {latest.isThrashing ? 'Degradación por Fuga' : 'Estable'}
              </span>
            </div>
          </div>
        </div>

        {/* 3. Disk I/O & S.M.A.R.T. Latency Card */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 text-slate-200 font-semibold text-sm">
                <HardDrive className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Disco I/O y Latencia</span>
              </div>
              <span className={`font-mono text-xs font-semibold tabular-nums ${diskState.color}`}>
                {diskState.label}
              </span>
            </div>

            <div className="flex items-baseline justify-between mb-3">
              <div>
                <span className="text-2xl font-bold font-mono tabular-nums text-white">
                  {latest.diskActivePercent.toFixed(0)}%
                </span>
                <span className="text-xs text-slate-400 font-mono tabular-nums ml-2">
                  {(latest.diskReadMbps + latest.diskWriteMbps).toFixed(0)} MB/s
                </span>
              </div>
              <div className="text-right font-mono tabular-nums">
                <span
                  className={`text-sm font-semibold ${
                    latest.diskLatencyMs >= 150
                      ? 'text-red-400'
                      : latest.diskLatencyMs >= 40
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {latest.diskLatencyMs.toFixed(0)} ms
                </span>
                <span className="text-xs text-slate-500 ml-1">Latencia</span>
              </div>
            </div>

            <div className="relative bg-slate-950 border border-slate-800/80 rounded-lg overflow-hidden h-24 mb-3">
              <svg
                viewBox={`0 0 ${chartW} ${chartH}`}
                className="w-full h-full"
                preserveAspectRatio="none"
              >
                <line x1="0" y1={chartH * 0.25} x2={chartW} y2={chartH * 0.25} stroke="#1e293b" strokeDasharray="3 3" strokeWidth="1" />
                <line x1="0" y1={chartH * 0.5} x2={chartW} y2={chartH * 0.5} stroke="#1e293b" strokeDasharray="3 3" strokeWidth="1" />
                <line x1="0" y1={chartH * 0.75} x2={chartW} y2={chartH * 0.75} stroke="#1e293b" strokeDasharray="3 3" strokeWidth="1" />
                <path d={buildAreaPath(diskValues, 100, chartW, chartH)} fill={diskState.fill} />
                <polyline
                  fill="none"
                  stroke={diskState.stroke}
                  strokeWidth="2"
                  points={buildPolylinePoints(diskValues, 100, chartW, chartH)}
                />
              </svg>
              {latest.diskLatencyMs >= 150 && (
                <div className="absolute top-1.5 left-2 right-2 flex items-center justify-between text-[11px] font-mono text-red-300 bg-red-950/90 border border-red-800/80 px-2 py-0.5 rounded">
                  <span>▲ COLA I/O BLOQUEADA</span>
                  <span>Reintentos LBA</span>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5 text-xs font-mono tabular-nums border-t border-slate-800/80 pt-2.5">
            <div className="flex justify-between text-slate-400">
              <span>Lectura / Escritura:</span>
              <span className="text-slate-200">
                R: {latest.diskReadMbps.toFixed(0)} MB/s · W: {latest.diskWriteMbps.toFixed(0)} MB/s
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-400 pt-1">
              <span>Telemetría S.M.A.R.T.:</span>
              <button
                type="button"
                onClick={() => onSelectTab('smart')}
                className="text-sky-400 hover:text-sky-300 underline font-sans font-medium text-xs whitespace-nowrap"
              >
                Inspeccionar Sectores →
              </button>
            </div>
          </div>
        </div>

        {/* 4. Network, GPU & Thermal Fan PWM Controller Card */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 text-slate-200 font-semibold text-sm">
                <Network className="w-4 h-4 text-sky-400 shrink-0" />
                <span>Red Ethernet y GPU</span>
              </div>
              <span className={`font-mono text-xs font-semibold tabular-nums ${netGpuState.color}`}>
                {netGpuState.label}
              </span>
            </div>

            <div className="flex items-baseline justify-between mb-3">
              <div>
                <span className="text-2xl font-bold font-mono tabular-nums text-white">
                  {totalNetMbps.toFixed(0)}
                </span>
                <span className="text-xs text-slate-400 font-mono tabular-nums ml-1.5">Mbps</span>
              </div>
              <div className="text-right font-mono tabular-nums">
                <span
                  className={`text-sm font-semibold ${
                    latest.gpuTempC >= 85 ? 'text-red-400' : 'text-slate-300'
                  }`}
                >
                  GPU {latest.gpuPercent.toFixed(0)}% · {latest.gpuTempC.toFixed(0)}°C
                </span>
              </div>
            </div>

            <div className="relative bg-slate-950 border border-slate-800/80 rounded-lg overflow-hidden h-24 mb-3">
              <svg
                viewBox={`0 0 ${chartW} ${chartH}`}
                className="w-full h-full"
                preserveAspectRatio="none"
              >
                <line x1="0" y1={chartH * 0.25} x2={chartW} y2={chartH * 0.25} stroke="#1e293b" strokeDasharray="3 3" strokeWidth="1" />
                <line x1="0" y1={chartH * 0.5} x2={chartW} y2={chartH * 0.5} stroke="#1e293b" strokeDasharray="3 3" strokeWidth="1" />
                <line x1="0" y1={chartH * 0.75} x2={chartW} y2={chartH * 0.75} stroke="#1e293b" strokeDasharray="3 3" strokeWidth="1" />
                <path d={buildAreaPath(netValues, 1000, chartW, chartH)} fill={netGpuState.fill} />
                <polyline
                  fill="none"
                  stroke={netGpuState.stroke}
                  strokeWidth="2"
                  points={buildPolylinePoints(netValues, 1000, chartW, chartH)}
                />
              </svg>
            </div>
          </div>

          {/* Interactive Fan PWM Curve Control */}
          <div className="border-t border-slate-800/80 pt-2.5">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
              <span className="flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-sky-400" />
                <span>Curva Ventilación Chasis PWM:</span>
              </span>
              <span className="font-mono text-slate-300 tabular-nums">
                {fanProfile === 'silent' ? '900 RPM' : fanProfile === 'balanced' ? '1650 RPM' : '2800 RPM'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => onChangeFanProfile('silent')}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  fanProfile === 'silent'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Silencioso
              </button>
              <button
                type="button"
                onClick={() => onChangeFanProfile('balanced')}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  fanProfile === 'balanced'
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Equilibrado
              </button>
              <button
                type="button"
                onClick={() => onChangeFanProfile('performance')}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  fanProfile === 'performance'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                100% Max
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
