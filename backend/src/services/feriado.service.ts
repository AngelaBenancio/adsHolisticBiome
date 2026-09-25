import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../config/database';
import { normalizarFechaHora } from '../utils/datetime';
import { HttpError } from '../utils/http';
import { logger } from '../utils/logger';

interface FeriadoFila extends RowDataPacket {
  id: number;
  fecha: string;
  descripcion: string;
}

export interface FeriadoApi {
  id: number;
  fecha: string;
  descripcion: string;
}

function mapear(fila: FeriadoFila): FeriadoApi {
  return {
    id: Number(fila.id),
    fecha: String(fila.fecha).slice(0, 10),
    descripcion: fila.descripcion,
  };
}

function tablaAusente(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'ER_NO_SUCH_TABLE';
}

export function fechaFeriadoValida(valor: string): string {
  if (normalizarFechaHora(`${valor} 12:00:00`) === null) {
    throw new HttpError(400, 'fecha debe tener formato YYYY-MM-DD');
  }
  return valor;
}

export async function esFeriado(fecha: string): Promise<boolean> {
  try {
    const [filas] = await pool.query<FeriadoFila[]>(
      'SELECT id, fecha, descripcion FROM asist_feriados WHERE fecha = ? LIMIT 1',
      [fecha],
    );
    return filas.length > 0;
  } catch (error) {
    if (!tablaAusente(error)) throw error;
    logger.error('Falta la tabla asist_feriados. Ejecuta npm run db:init');
    return false;
  }
}

export async function listarFeriados(anio?: string): Promise<FeriadoApi[]> {
  if (anio !== undefined && !/^\d{4}$/.test(anio)) throw new HttpError(400, 'anio invalido');
  const [filas] = await pool.query<FeriadoFila[]>(
    anio
      ? 'SELECT id, fecha, descripcion FROM asist_feriados WHERE YEAR(fecha) = ? ORDER BY fecha ASC'
      : 'SELECT id, fecha, descripcion FROM asist_feriados ORDER BY fecha ASC',
    anio ? [Number(anio)] : [],
  );
  return filas.map(mapear);
}

export async function crearFeriado(fecha: string, descripcion: string): Promise<FeriadoApi> {
  try {
    const [resultado] = await pool.query<ResultSetHeader>(
      'INSERT INTO asist_feriados (fecha, descripcion) VALUES (?, ?)',
      [fechaFeriadoValida(fecha), descripcion],
    );
    return { id: resultado.insertId, fecha, descripcion };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'ER_DUP_ENTRY') {
      throw new HttpError(409, 'Esa fecha ya esta registrada como feriado');
    }
    throw error;
  }
}

export async function eliminarFeriado(id: number): Promise<boolean> {
  const [resultado] = await pool.query<ResultSetHeader>('DELETE FROM asist_feriados WHERE id = ?', [id]);
  return resultado.affectedRows > 0;
}
