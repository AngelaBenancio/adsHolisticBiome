import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../config/database';
import type { TurnoApi } from '../types';
import { fechaDeHoy, horaEnTexto, sumarDias } from '../utils/datetime';
import { HttpError } from '../utils/http';
import { asegurarRango } from './calculo.service';

interface TurnoFila extends RowDataPacket {
  id: number;
  nombre: string;
  hora_entrada: string;
  tolerancia_minutos: number;
  hora_salida: string;
  dias_semana: string;
  activo: number;
}

interface IdFila extends RowDataPacket {
  id: number;
}

function esDuplicado(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'ER_DUP_ENTRY';
}

export function normalizarHora(valor: string, etiqueta: string): string {
  const coincidencia = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(valor.trim());
  if (!coincidencia) throw new HttpError(400, `${etiqueta} debe tener formato HH:mm`);
  const hora = Number(coincidencia[1]);
  const minuto = Number(coincidencia[2]);
  const segundo = Number(coincidencia[3] ?? '0');
  if (hora > 23 || minuto > 59 || segundo > 59) throw new HttpError(400, `${etiqueta} invalida`);
  return `${coincidencia[1]}:${coincidencia[2]}:${(coincidencia[3] ?? '00').padStart(2, '0')}`;
}

export function normalizarDias(valor: string): string {
  if (!/^[01]{7}$/.test(valor) || !valor.includes('1')) {
    throw new HttpError(400, 'dias_semana debe tener 7 digitos 0 o 1 y al menos un dia laboral');
  }
  return valor;
}

function mapearTurno(fila: TurnoFila): TurnoApi {
  return {
    id: Number(fila.id),
    nombre: fila.nombre,
    hora_entrada: horaEnTexto(fila.hora_entrada),
    tolerancia_minutos: Number(fila.tolerancia_minutos),
    hora_salida: horaEnTexto(fila.hora_salida),
    dias_semana: fila.dias_semana,
    activo: Boolean(fila.activo),
  };
}

export async function listarTurnos(): Promise<TurnoApi[]> {
  const [filas] = await pool.query<TurnoFila[]>(
    `SELECT id, nombre, hora_entrada, tolerancia_minutos, hora_salida, dias_semana, activo
     FROM asist_turnos ORDER BY activo DESC, nombre ASC`,
  );
  return filas.map(mapearTurno);
}

export async function crearTurno(entrada: {
  nombre: string;
  horaEntrada: string;
  toleranciaMinutos: number;
  horaSalida: string;
  diasSemana: string;
}): Promise<TurnoApi> {
  if (entrada.horaSalida <= entrada.horaEntrada) {
    throw new HttpError(400, 'La salida debe ser posterior a la entrada en el mismo dia');
  }
  const [resultado] = await pool.query<ResultSetHeader>(
    `INSERT INTO asist_turnos (nombre, hora_entrada, tolerancia_minutos, hora_salida, dias_semana, activo)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [entrada.nombre, entrada.horaEntrada, entrada.toleranciaMinutos, entrada.horaSalida, entrada.diasSemana],
  );
  const [filas] = await pool.query<TurnoFila[]>(
    `SELECT id, nombre, hora_entrada, tolerancia_minutos, hora_salida, dias_semana, activo
     FROM asist_turnos WHERE id = ?`,
    [resultado.insertId],
  );
  const fila = filas[0];
  if (!fila) throw new Error('No se pudo leer el turno creado');
  return mapearTurno(fila);
}

export async function actualizarTurno(
  id: number,
  cambios: {
    nombre?: string;
    horaEntrada?: string;
    toleranciaMinutos?: number;
    horaSalida?: string;
    diasSemana?: string;
    activo?: boolean;
  },
): Promise<TurnoApi | null> {
  const [actuales] = await pool.query<TurnoFila[]>(
    `SELECT id, nombre, hora_entrada, tolerancia_minutos, hora_salida, dias_semana, activo
     FROM asist_turnos WHERE id = ?`,
    [id],
  );
  const actual = actuales[0];
  if (!actual) return null;
  const horaEntrada = cambios.horaEntrada ?? horaEnTexto(actual.hora_entrada);
  const horaSalida = cambios.horaSalida ?? horaEnTexto(actual.hora_salida);
  if (horaSalida <= horaEntrada) {
    throw new HttpError(400, 'La salida debe ser posterior a la entrada en el mismo dia');
  }
  await pool.query(
    `UPDATE asist_turnos
     SET nombre = ?, hora_entrada = ?, tolerancia_minutos = ?, hora_salida = ?, dias_semana = ?, activo = ?
     WHERE id = ?`,
    [
      cambios.nombre ?? actual.nombre,
      horaEntrada,
      cambios.toleranciaMinutos ?? Number(actual.tolerancia_minutos),
      horaSalida,
      cambios.diasSemana ?? actual.dias_semana,
      cambios.activo === undefined ? actual.activo : (cambios.activo ? 1 : 0),
      id,
    ],
  );
  const [filas] = await pool.query<TurnoFila[]>(
    `SELECT id, nombre, hora_entrada, tolerancia_minutos, hora_salida, dias_semana, activo
     FROM asist_turnos WHERE id = ?`,
    [id],
  );
  return filas[0] ? mapearTurno(filas[0]) : null;
}

export async function crearEmpleado(pin: string, nombre: string): Promise<number> {
  try {
    const [resultado] = await pool.query<ResultSetHeader>(
      `INSERT INTO asist_empleados (pin, nombre, origen) VALUES (?, ?, 'manual')`,
      [pin, nombre],
    );
    return resultado.insertId;
  } catch (error) {
    if (esDuplicado(error)) throw new HttpError(409, 'Ya existe un colaborador con ese PIN');
    throw error;
  }
}

export async function asignarTurno(entrada: {
  empleadoId: number;
  turnoId: number;
  vigenteDesde: string;
  vigenteHasta: string | null;
}): Promise<void> {
  const [empleado] = await pool.query<IdFila[]>('SELECT id FROM asist_empleados WHERE id = ?', [entrada.empleadoId]);
  if (!empleado[0]) throw new HttpError(404, 'Empleado no encontrado');
  const [turno] = await pool.query<IdFila[]>('SELECT id FROM asist_turnos WHERE id = ? AND activo = 1', [entrada.turnoId]);
  if (!turno[0]) throw new HttpError(404, 'Turno no encontrado');
  if (entrada.vigenteHasta && entrada.vigenteHasta < entrada.vigenteDesde) {
    throw new HttpError(400, 'La vigencia final es anterior al inicio');
  }

  const cierre = sumarDias(entrada.vigenteDesde, -1);
  await pool.query(
    `UPDATE asist_asignaciones
     SET vigente_hasta = ?
     WHERE empleado_id = ?
       AND vigente_desde < ?
       AND (vigente_hasta IS NULL OR vigente_hasta >= ?)`,
    [cierre, entrada.empleadoId, entrada.vigenteDesde, entrada.vigenteDesde],
  );
  await pool.query(
    `INSERT INTO asist_asignaciones (empleado_id, turno_id, vigente_desde, vigente_hasta)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE turno_id = VALUES(turno_id), vigente_hasta = VALUES(vigente_hasta)`,
    [entrada.empleadoId, entrada.turnoId, entrada.vigenteDesde, entrada.vigenteHasta],
  );

  const hoy = fechaDeHoy();
  let fin = hoy;
  if (entrada.vigenteHasta && entrada.vigenteHasta < hoy) fin = entrada.vigenteHasta;
  let inicio = entrada.vigenteDesde;
  const piso = sumarDias(fin, -61);
  if (inicio < piso) inicio = piso;
  if (inicio <= fin) await asegurarRango(inicio, fin);
}
