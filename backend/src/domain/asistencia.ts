import type { EstadoAsistencia } from '../types';

export interface TurnoEvaluable {
  horaEntrada: string;
  toleranciaMinutos: number;
  horaSalida: string;
  diasSemana: string;
}

export interface MarcaEvaluable {
  id: number;
  fechaHora: string;
  tipoEvento: number;
}

export interface EvaluacionAsistencia {
  estado: EstadoAsistencia;
  minutosTarde: number;
  entrada: MarcaEvaluable | null;
  salida: MarcaEvaluable | null;
}

const TIPOS_ENTRADA = new Set([0, 3, 4]);
const TIPOS_SALIDA = new Set([1, 2, 5]);

function minutos(hora: string): number {
  const [h, m] = hora.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

/** Lunes = 0. La fecha es un dia calendario, sin zona. */
export function esDiaLaboral(fecha: string, diasSemana: string): boolean {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const instante = new Date(Date.UTC(anio, mes - 1, dia));
  const domingoCero = instante.getUTCDay();
  const lunesCero = domingoCero === 0 ? 6 : domingoCero - 1;
  return diasSemana[lunesCero] === '1';
}

function ordenar(marcaciones: MarcaEvaluable[]): MarcaEvaluable[] {
  return [...marcaciones].sort((a, b) => a.fechaHora.localeCompare(b.fechaHora) || a.id - b.id);
}

function elegirEntrada(marcaciones: MarcaEvaluable[]): MarcaEvaluable | null {
  return marcaciones.find((marca) => TIPOS_ENTRADA.has(marca.tipoEvento)) ?? marcaciones[0] ?? null;
}

function elegirSalida(marcaciones: MarcaEvaluable[], entrada: MarcaEvaluable | null): MarcaEvaluable | null {
  const salidas = marcaciones.filter((marca) => TIPOS_SALIDA.has(marca.tipoEvento));
  const explicita = salidas.length > 0 ? salidas[salidas.length - 1] : null;
  if (explicita && (!entrada || explicita.id !== entrada.id)) return explicita;
  const ultima = marcaciones[marcaciones.length - 1];
  if (ultima && entrada && ultima.id !== entrada.id) return ultima;
  return null;
}

/**
 * Cruza las marcaciones del dia con el turno.
 * "A tiempo" incluye la tolerancia. Los minutos de tardanza se cuentan
 * desde la hora oficial, no desde el fin de la tolerancia.
 * Antes de que venza la tolerancia no se escribe falta: el colaborador aun puede llegar.
 * Devuelve null cuando todavia no corresponde guardar un resultado.
 */
export function evaluarAsistencia(params: {
  fecha: string;
  ahora: string;
  turno: TurnoEvaluable | null;
  marcaciones: MarcaEvaluable[];
  feriado?: boolean;
}): EvaluacionAsistencia | null {
  const marcaciones = ordenar(params.marcaciones);
  const entrada = elegirEntrada(marcaciones);
  const salida = elegirSalida(marcaciones, entrada);

  if (params.feriado) {
    if (!params.turno && !entrada) return null;
    return { estado: 'feriado', minutosTarde: 0, entrada, salida };
  }

  if (!params.turno) {
    if (!entrada) return null;
    return { estado: 'sin_turno', minutosTarde: 0, entrada, salida };
  }

  const laboral = esDiaLaboral(params.fecha, params.turno.diasSemana);
  if (!laboral && !entrada) return null;

  const oficial = minutos(params.turno.horaEntrada);
  const limite = Math.min(oficial + params.turno.toleranciaMinutos, 24 * 60 - 1);
  const hoy = params.ahora.slice(0, 10);
  const minutosAhora = minutos(params.ahora.slice(11, 16));

  if (!entrada) {
    if (params.fecha > hoy) return null;
    if (params.fecha === hoy && minutosAhora <= limite) return null;
    return { estado: 'falta', minutosTarde: 0, entrada: null, salida: null };
  }

  const real = minutos(entrada.fechaHora.slice(11, 16));
  if (real <= limite) {
    return { estado: 'a_tiempo', minutosTarde: 0, entrada, salida };
  }
  return {
    estado: 'tardanza',
    minutosTarde: Math.max(0, real - oficial),
    entrada,
    salida,
  };
}
