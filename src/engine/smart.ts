import type { SmartAttribute, SmartDrive, SmartHealthStatus } from '../types/telemetry';

export const isNvme = (d: SmartDrive) => d.interfaceType.startsWith('NVMe');

/** Campos del registro SMART/Health de NVMe (log 02h): el identificador es su desplazamiento en bytes. */
export const NVME = {
  criticalWarning: '00',
  temperature: '01',
  availableSpare: '03',
  percentageUsed: '05',
  dataUnitsWritten: '30',
  unsafeShutdowns: '90',
  mediaErrors: 'A0',
} as const;

export const attr = (d: SmartDrive, id: string) => d.attributes.find((a) => a.idHex === id);

/** Identificador del atributo de temperatura (C2 en ATA, 01h en NVMe). */
export const temperatureId = (d: SmartDrive) => (isNvme(d) ? NVME.temperature : 'C2');

/** Temperatura que marca el sensor con el perfil de ventilación actual. */
export function driveTemperature(d: SmartDrive, fanTempDelta: number): number {
  return Math.max(28, d.baseTempC + fanTempDelta);
}

/** Umbral de aviso de temperatura: WCTEMP en NVMe; 50 °C como referencia en un disco mecánico. */
export function temperatureLimit(d: SmartDrive): number {
  const t = attr(d, temperatureId(d));
  return isNvme(d) && t && t.threshold > 0 ? t.threshold : 50;
}

/** Estado del atributo de temperatura con la temperatura actual (depende de la ventilación). */
export function temperatureStatus(d: SmartDrive, tempC: number): SmartHealthStatus {
  const limit = temperatureLimit(d);
  if (tempC >= limit) return isNvme(d) ? 'CRÍTICO' : 'ADVERTENCIA';
  return tempC >= limit - 5 ? 'ADVERTENCIA' : 'NOMINAL';
}

/**
 * Lo que responde la propia unidad («SMART overall-health»): en ATA, FAILED solo si algún valor
 * normalizado ha llegado a su umbral; en NVMe, si el byte Critical Warning no es 0.
 */
export function selfAssessmentPassed(d: SmartDrive, tempC = d.baseTempC): boolean {
  if (isNvme(d)) {
    const spare = attr(d, NVME.availableSpare);
    const media = attr(d, NVME.mediaErrors);
    const overTemp = tempC >= temperatureLimit(d);
    const spareLow = spare ? spare.rawDecimal < spare.threshold : false;
    return !overTemp && !spareLow && !(media && media.rawDecimal > 0 && media.status === 'CRÍTICO');
  }
  return !d.attributes.some((a) => a.threshold > 0 && a.current <= a.threshold);
}

/** Byte Critical Warning de NVMe con la temperatura actual (bit 1 = temperatura por encima del umbral). */
export function nvmeCriticalWarning(d: SmartDrive, tempC: number): number {
  let cw = 0;
  const spare = attr(d, NVME.availableSpare);
  if (spare && spare.rawDecimal < spare.threshold) cw |= 0x01;
  if (tempC >= temperatureLimit(d)) cw |= 0x02;
  return cw;
}

/** Valor de Win32_DiskDrive.Status: solo pasa a «Pred Fail» cuando la unidad da el FAILED. */
export function wmiStatus(d: SmartDrive, tempC = d.baseTempC): 'OK' | 'Pred Fail' {
  return selfAssessmentPassed(d, tempC) ? 'OK' : 'Pred Fail';
}

/** Nombres de dispositivo que usa smartctl en Windows (/dev/sda, /dev/sdb… y /dev/nvme0…). */
export function deviceNames(drives: SmartDrive[]): Record<string, string> {
  let sata = 0;
  let nvme = 0;
  const names: Record<string, string> = {};
  for (const d of drives) {
    names[d.id] = isNvme(d) ? `/dev/nvme${nvme++}` : `/dev/sd${String.fromCharCode(97 + sata++)}`;
  }
  return names;
}

const pad = (s: string | number, n: number, left = false) => (left ? String(s).padStart(n) : String(s).padEnd(n));

/** Volcado con el formato de smartctl -a (ATA o NVMe). */
export function smartctlReport(d: SmartDrive, tempC: number): string {
  const passed = selfAssessmentPassed(d, tempC);
  const head = [
    'smartctl 7.4 2023-08-01 r5530 [x86_64-w64-mingw32-w10-22H2] (sf-7.4-1)',
    '',
    '=== START OF INFORMATION SECTION ===',
    `${isNvme(d) ? 'Model Number:   ' : 'Device Model:   '}  ${d.model}`,
    `Serial Number:     ${d.serial}`,
    `Firmware Version:  ${d.firmware}`,
    `${isNvme(d) ? 'Total NVM Capacity:' : 'User Capacity:     '} ${d.capacityGb.toLocaleString('es-ES')} GB`,
    '',
    '=== START OF READ SMART DATA SECTION ===',
    `SMART overall-health self-assessment test result: ${passed ? 'PASSED' : 'FAILED!'}`,
    '',
  ];
  if (isNvme(d)) {
    const v = (id: string) => attr(d, id)?.rawDecimal ?? 0;
    const spare = attr(d, NVME.availableSpare);
    const written = v(NVME.dataUnitsWritten);
    return [
      ...head,
      'SMART/Health Information (NVMe Log 0x02)',
      `Critical Warning:                   0x${nvmeCriticalWarning(d, tempC).toString(16).padStart(2, '0')}`,
      `Temperature:                        ${tempC} Celsius`,
      `Available Spare:                    ${v(NVME.availableSpare)}%`,
      `Available Spare Threshold:          ${spare?.threshold ?? 10}%`,
      `Percentage Used:                    ${v(NVME.percentageUsed)}%`,
      ...(written ? [`Data Units Written:                 ${(written * 1e12 / 512000).toLocaleString('en-US', { maximumFractionDigits: 0 })} [${written} TB]`] : []),
      `Power Cycles:                       ${d.powerCount}`,
      `Power On Hours:                     ${d.powerOnHours}`,
      `Unsafe Shutdowns:                   ${v(NVME.unsafeShutdowns)}`,
      `Media and Data Integrity Errors:    ${v(NVME.mediaErrors)}`,
      `Warning  Comp. Temperature Threshold: ${temperatureLimit(d)} Celsius`,
    ].join('\n');
  }
  return [
    ...head,
    'ID# ATTRIBUTE_NAME          FLAG     VALUE WORST THRESH TYPE      UPDATED  WHEN_FAILED RAW_VALUE',
    ...d.attributes.map((a) => {
      const id = parseInt(a.idHex, 16);
      const failed = a.threshold > 0 && a.current <= a.threshold ? 'FAILING_NOW' : '-';
      const raw = a.idHex === 'C2' ? String(tempC) : String(a.rawDecimal);
      return `${pad(id, 3, true)} ${pad(a.name, 23)} 0x${a.isCriticalPreFail ? '000f' : '0032'}   ${pad(String(a.current).padStart(3, '0'), 5)} ${pad(String(a.worst).padStart(3, '0'), 5)} ${pad(String(a.threshold).padStart(3, '0'), 6)} ${pad(a.isCriticalPreFail ? 'Pre-fail' : 'Old_age', 9)} Always   ${pad(failed, 11)} ${raw}`;
    }),
  ].join('\n');
}

/** Resultado de un autotest corto (smartctl -t short) con el formato del registro de autotests. */
export function shortSelfTest(d: SmartDrive): { ok: boolean; text: string } {
  if (isNvme(d)) {
    const media = attr(d, NVME.mediaErrors)?.rawDecimal ?? 0;
    return media > 0
      ? { ok: false, text: 'Self-test Log: Short — Completed: failed segments (errores de integridad de datos en la memoria flash).' }
      : { ok: true, text: 'Self-test Log: Short — Completed without error. (La temperatura no forma parte del autotest: mírala en el registro de salud.)' };
  }
  const pending = attr(d, 'C5')?.rawDecimal ?? 0;
  const uncorrectable = attr(d, 'C6')?.rawDecimal ?? 0;
  if (pending > 0 || uncorrectable > 0) {
    return {
      ok: false,
      text: `# 1  Short offline  Completed: read failure  90%  ${d.powerOnHours}  LBA_of_first_error 0x1B3F47A2 — el disco no ha podido leer un sector. No lo sometas a más lecturas de prueba: clónalo.`,
    };
  }
  return { ok: true, text: `# 1  Short offline  Completed without error  00%  ${d.powerOnHours}  -` };
}

/** Atributos que conviene vigilar aunque smartctl los marque como Old_age. */
export function isKeyAtaAttribute(a: SmartAttribute): boolean {
  return ['05', 'C5', 'C6', 'BB', 'BC', 'C4'].includes(a.idHex);
}

/** Variación de la temperatura de las unidades según el perfil de ventilación del chasis. */
export function fanTempDelta(profile: 'silent' | 'balanced' | 'performance'): number {
  return profile === 'performance' ? -9 : profile === 'silent' ? 5 : 0;
}
