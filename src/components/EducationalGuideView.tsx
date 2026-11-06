import React, { useState } from 'react';
import {
  Cpu,
  HardDrive,
  MemoryStick,
  FileCheck2,
  ExternalLink,
  CheckCircle2,
  XCircle,
  RotateCcw,
  HelpCircle,
} from 'lucide-react';

interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: 'q1',
    question:
      '1. Un equipo muestra el disco al 100% de actividad con latencia de 420 ms, pero la velocidad de transferencia es de apenas 4 MB/s. En la tabla S.M.A.R.T., el atributo 0xC5 (Current Pending Sector Count) muestra un valor crudo de 14. ¿Qué está ocurriendo físicamente?',
    options: [
      'El bus SATA/NVMe tiene el ancho de banda saturado por archivos demasiado grandes.',
      'La controladora del disco está bloqueada en reintentos de lectura CRC sobre 14 sectores inestables pendientes de reasignar.',
      'La memoria RAM es insuficiente y está desfragmentando el disco automáticamente.',
      'El atributo 0xC5 indica los grados Celsius por encima del umbral térmico.',
    ],
    correctIndex: 1,
    explanation:
      'Correcto: Los sectores pendientes (0xC5 > 0) obligan al firmware del disco a reintentar la lectura durante cientos de milisegundos por bloque, disparando el tiempo activo al 100% aunque apenas se transfieran megabytes.',
  },
  {
    id: 'q2',
    question:
      '2. ¿Por qué nunca debe configurarse un proceso intensivo de usuario (ej. renderizador CAD o compresor) en prioridad "Tiempo Real" con afinidad restringida a CPU 0 y CPU 1?',
    options: [
      'Porque Windows borra automáticamente el archivo de paginación al usar Tiempo Real.',
      'Porque sus hilos pasan por delante de casi todos los del sistema (entrada del ratón y el teclado, gestor de ventanas), que se quedan sin CPU, y concentrar la carga en 2 núcleos los calienta hasta el estrangulamiento térmico.',
      'Porque los núcleos 0 y 1 solo sirven para gráficos integrados.',
      'Porque el proceso pasa a ser huérfano inmediatamente.',
    ],
    correctIndex: 1,
    explanation:
      'Correcto: la clase "Tiempo Real" adelanta a casi todos los hilos del sistema, que esperan su turno (por eso el ratón da tirones). Las interrupciones en sí no se bloquean, porque se atienden por encima de cualquier hilo, pero el trabajo que generan sí espera. Y encerrar la carga en 2 núcleos concentra el calor.',
  },
  {
    id: 'q3',
    question:
      '3. En el Administrador de tareas ves un proceso cuyo padre ya no existe y un servicio cuya memoria crece sin parar. ¿Qué es cada cosa?',
    options: [
      'El primero es un proceso cuyo padre terminó (en Windows no es un fallo por sí mismo, pero importa si debía haberse cerrado con él y sigue consumiendo); el segundo es una fuga de memoria: reserva RAM (+MB/s) sin liberarla.',
      'Son exactamente lo mismo, solo cambia el nombre en Linux y Windows.',
      'Un proceso huérfano solo consume red, mientras que la fuga de memoria solo afecta a la GPU.',
      'Los procesos huérfanos siempre pertenecen al usuario SYSTEM y no pueden finalizarse.',
    ],
    correctIndex: 0,
    explanation:
      'Exacto: Windows no adopta los procesos sin padre como Linux, y muchos son normales (explorer.exe tampoco tiene padre vivo). El problema es el que debía cerrarse con su aplicación y sigue reteniendo recursos. La fuga de memoria, en cambio, crece sin liberar y acaba llevando al sistema a paginar contra pagefile.sys.',
  },
  {
    id: 'q4',
    question:
      '4. Al ejecutar "wmic diskdrive get status" en consola, el resultado es "OK", pero el equipo sufre micro-cortes de disco. ¿Por qué "wmic" no alertó del fallo?',
    options: [
      'Porque WMI solo cambia a "Pred Fail" cuando el valor normalizado cae por debajo del umbral límite del fabricante, ignorando las primeras decenas de sectores reasignados (0x05) o pendientes (0xC5).',
      'Porque el comando WMIC solo funciona en discos externos por USB.',
      'Porque los discos SSD NVMe no tienen sensores S.M.A.R.T.',
      'Porque el sistema operativo oculta los errores hasta reiniciar en Modo Seguro.',
    ],
    correctIndex: 0,
    explanation:
      'Muy bien: La consulta básica WMI solo reporta fallo cuando se rebasa el Threshold final. Un auditor profesional inspecciona siempre los valores crudos (Raw) con herramientas como smartctl o CrystalDiskInfo.',
  },
  {
    id: 'q5',
    question:
      '5. ¿Qué efecto colateral provoca en un disco SSD NVMe sufrir "Thrashing" crónico del archivo de paginación (pagefile.sys) por culpa de una fuga de memoria RAM?',
    options: [
      'Aumenta la capacidad total del SSD al comprimir los bloques.',
      'Dispara las escrituras en la memoria flash: suben Data Units Written y Percentage Used del registro de salud NVMe (y la temperatura).',
      'Desactiva la tarjeta de red para ahorrar energía.',
      'Convierte los sectores pendientes en memoria RAM caché.',
    ],
    correctIndex: 1,
    explanation:
      'Correcto: Cuando la RAM se agota, el sistema operativo escribe gigabytes por minuto en pagefile.sys sobre el SSD, degradando prematuramente los ciclos de borrado/escritura (P/E) de la memoria flash NAND.',
  },
];

export const EducationalGuideView: React.FC = () => {
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});

  const answeredCount = Object.keys(selectedAnswers).length;
  const correctCount = QUIZ_QUESTIONS.filter(
    (q) => selectedAnswers[q.id] === q.correctIndex
  ).length;

  return (
    <div className="space-y-6">
      {/* Main Theoretical Cards */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <p className="text-xs font-mono text-sky-400">
              MANUAL DE REFERENCIA PARA AUDITORÍA DE SISTEMAS Y HARDWARE
            </p>
            <h2 className="text-xl font-bold text-white mt-1">
              Guía Didáctica: Interpretación de Telemetría y Mantenimiento Preventivo
            </h2>
          </div>
          <a
            href="https://www.unfantasmaenelsistema.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 transition-colors whitespace-nowrap shrink-0"
          >
            <span>Visitar Un Fantasma en el Sistema</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          {/* Card 1: S.M.A.R.T. */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2.5 text-white font-semibold text-sm">
              <HardDrive className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>1. Lectura de Sensores S.M.A.R.T. (Anticipación al Fallo)</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Los discos HDD y SSD/NVMe incorporan telemetría <strong>S.M.A.R.T.</strong> Un técnico no mira únicamente si el estado global dice &ldquo;OK&rdquo;, sino los <strong>Valores Crudos (Raw Values)</strong> de cuatro registros críticos:
            </p>
            <ul className="space-y-2 text-xs text-slate-300 font-mono">
              <li>
                <strong className="text-sky-300">ATA 0x05 (Reallocated Sectors Count):</strong> sectores que fallaron y se sustituyeron por otros de reserva. Si sube día tras día, la superficie se está degradando.
              </li>
              <li>
                <strong className="text-red-400">ATA 0xC5 (Current Pending Sector Count):</strong> sectores que no se pueden leer y esperan a reasignarse cuando se escriba en ellos (lo que contienen se pierde). Cada lectura provoca reintentos y latencias de cientos de milisegundos. smartctl los marca como Old_age, pero son de los mejores indicadores de fallo: con C5 &gt; 0, se clona el disco antes de nada.
              </li>
              <li>
                <strong className="text-amber-300">Temperatura (ATA 0xC2, NVMe «Temperature»):</strong> un NVMe que supera su temperatura de aviso (WCTEMP, entre 70 y 85 °C según el modelo) activa el bit 0x02 del aviso crítico y baja su velocidad para enfriarse.
              </li>
              <li>
                <strong className="text-purple-300">Desgaste del SSD (NVMe «Percentage Used» y «Data Units Written»):</strong> NVMe no usa IDs de atributo como ATA; informa con su registro de salud (log 02h). Una fuga de RAM que obligue a paginar dispara las escrituras y gasta la vida útil.
              </li>
            </ul>
          </div>

          {/* Card 2: Memory Leaks, Orphans & Thrashing */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2.5 text-white font-semibold text-sm">
              <MemoryStick className="w-4 h-4 text-purple-400 shrink-0" />
              <span>2. Fugas de memoria, procesos que no se cerraron y Thrashing</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Cuando un equipo se vuelve lento tras varias horas encendido, debemos distinguir tres patologías de procesos:
            </p>
            <ul className="space-y-2 text-xs text-slate-300">
              <li>
                <strong className="text-white">Proceso que no se cerró:</strong> su padre (<code className="font-mono text-sky-300">PPID</code>) ya terminó y él sigue vivo consumiendo CPU, GPU o disco. En Windows tener el padre muerto no es un fallo (explorer.exe tampoco lo tiene vivo); lo es seguir consumiendo cuando debía haberse cerrado. Solución: <em>Finalizar tarea</em> y averiguar por qué no se cerró.
              </li>
              <li>
                <strong className="text-white">Fuga de Memoria (Memory Leak):</strong> Un servicio reserva bloques en el <em>Heap</em> dinámicamente pero olvida liberarlos (<code className="font-mono text-red-400">+MB/s constante</code>). Solución temporal: <em>Reiniciar el servicio</em>; solución definitiva: <em>Actualizar/parchear el binario</em>.
              </li>
              <li>
                <strong className="text-white">Thrashing (Estrangulamiento de Paginación):</strong> Al superar el 92–95% de RAM física, el kernel mueve páginas constantemente entre la RAM y <code className="font-mono text-amber-300">pagefile.sys</code> en el disco, disparando los <em>Hard Page Faults/s</em> y bloqueando el sistema.
              </li>
            </ul>
          </div>

          {/* Card 3: CPU Affinity & Priority */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2.5 text-white font-semibold text-sm">
              <Cpu className="w-4 h-4 text-sky-400 shrink-0" />
              <span>3. Prioridad del Planificador vs. Afinidad de Núcleos</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              El planificador del sistema operativo reparte el tiempo de CPU según dos parámetros configurables en el Administrador de Tareas:
            </p>
            <ul className="space-y-2 text-xs text-slate-300">
              <li>
                <strong className="text-white">El peligro de la prioridad &ldquo;Tiempo Real&rdquo;:</strong> Coloca un proceso por encima del propio ratón, teclado y subrutinas de red del kernel. Nunca debe asignarse a programas pesados de usuario; usa <code className="font-mono text-sky-300">Normal</code> o <code className="font-mono text-sky-300">Por debajo de lo normal</code> para tareas de fondo.
              </li>
              <li>
                <strong className="text-white">Afinidad de Procesador (Core Affinity 0–7):</strong> Si un proceso intensivo se restringe sólo a <code className="font-mono text-amber-300">CPU 0</code> y <code className="font-mono text-amber-300">CPU 1</code>, esos dos núcleos alcanzan más de 95°C (activando <em>Thermal Throttling</em>) mientras los núcleos 2–7 están ociosos. Habilitar todos los núcleos o aislar tareas secundarias en los núcleos 4–7 estabiliza la temperatura y la latencia.
              </li>
            </ul>
          </div>

          {/* Card 4: Preventive Maintenance Report */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2.5 text-white font-semibold text-sm">
              <FileCheck2 className="w-4 h-4 text-amber-400 shrink-0" />
              <span>4. Cómo Redactar el Parte Técnico Preventivo</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Un buen técnico no solo &ldquo;mata procesos&rdquo; para salir del paso; documenta la causa raíz para evitar que la avería se repita:
            </p>
            <ul className="space-y-2 text-xs text-slate-300">
              <li>
                <strong className="text-white">Evidencia Cuantitativa:</strong> Cita siempre métricas exactas en el parte (ej. <em>&ldquo;Latencia de disco de 420ms con 14 sectores pendientes en registro S.M.A.R.T. 0xC5&rdquo;</em>).
              </li>
              <li>
                <strong className="text-white">Acción Inmediata vs. Acción Preventiva:</strong> Distingue lo que hiciste en caliente (finalizar proceso huérfano, subir curva PWM) de la prescripción preventiva (clonar unidad con <code className="font-mono text-sky-300">ddrescue</code>, limpiar radiador y renovar pasta térmica).
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Interactive Self-Assessment Quiz */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <HelpCircle className="w-5 h-5 text-sky-400 shrink-0" />
            <div>
              <h3 className="text-base font-bold text-white">
                Autoevaluación Teórica de Diagnóstico y Auditoría (5 Preguntas Clave)
              </h3>
              <p className="text-xs text-slate-400">
                Pon a prueba tus conocimientos sobre S.M.A.R.T., Thermal Throttling, Thrashing y planificación de núcleos.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-sky-300 tabular-nums">
              Aciertos: {correctCount} / {QUIZ_QUESTIONS.length} ({answeredCount} respondidas)
            </span>
            {answeredCount > 0 && (
              <button
                type="button"
                onClick={() => setSelectedAnswers({})}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reiniciar Test</span>
              </button>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {QUIZ_QUESTIONS.map((q) => {
            const picked = selectedAnswers[q.id];
            const isAnswered = picked !== undefined;
            const isCorrect = picked === q.correctIndex;

            return (
              <div
                key={q.id}
                className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3"
              >
                <p className="text-xs sm:text-sm font-semibold text-slate-100 leading-relaxed">
                  {q.question}
                </p>
                <div className="space-y-1.5">
                  {q.options.map((opt, idx) => {
                    const isThisPicked = picked === idx;
                    const isThisCorrect = idx === q.correctIndex;
                    let btnStyle =
                      'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700';

                    if (isAnswered) {
                      if (isThisCorrect) {
                        btnStyle =
                          'bg-emerald-950/50 border-emerald-500/60 text-emerald-200 font-medium';
                      } else if (isThisPicked && !isThisCorrect) {
                        btnStyle = 'bg-red-950/50 border-red-500/60 text-red-200';
                      }
                    }

                    return (
                      <button
                        key={idx}
                        type="button"
                        disabled={isAnswered}
                        onClick={() =>
                          // Solo cuenta la primera respuesta de cada pregunta
                          setSelectedAnswers((prev) => (q.id in prev ? prev : { ...prev, [q.id]: idx }))
                        }
                        className={`w-full text-left p-2.5 rounded-lg border text-xs transition-colors flex items-start gap-2.5 ${btnStyle}`}
                      >
                        <span className="font-mono text-slate-400 shrink-0">
                          {String.fromCharCode(65 + idx)}.
                        </span>
                        <span>{opt}</span>
                      </button>
                    );
                  })}
                </div>

                {isAnswered && (
                  <div
                    className={`p-3 rounded-lg border text-xs flex items-start gap-2 leading-relaxed ${
                      isCorrect
                        ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-200'
                        : 'bg-amber-950/30 border-amber-800/60 text-amber-200'
                    }`}
                  >
                    {isCorrect ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    )}
                    <span>{q.explanation}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
