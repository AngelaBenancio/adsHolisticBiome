import type { RowDataPacket } from 'mysql2/promise';
import { pool } from '../config/database';
import { evaluarAsistencia, type MarcaEvaluable, type TurnoEvaluable } from '../domain/asistencia';
import type { EstadoAsistencia, ResultadoAsistenciaApi } from '../types';
import { enumerarDias, fechaDeHoy, formatLima, horaEnTexto } from '../utils/datetime';
import { HttpError, textoConsulta } from '../utils/http';
import { logger } from '../utils/logger';
import { esFeriado } from './feriado.service';
import { despacharMarcacion } from './webhook.service';

interface TurnoFila extends RowDataPacket {
  empleado_id: number;
  turno_id: number;
  nombre: string;
  hora_entrada: string;
  tolerancia_minutos: number;
  hora_salida: string;
  dias_semana: string;
}

interface MarcaFila extends RowDataPacket {
  id: number;
  empleado_id: number;
  fecha_hora: string;
  tipo_evento: number;
}

interface ResultadoFila extends RowDataPacket {
  id: number;
  fecha: string;
  estado: EstadoAsistencia;
  minutos_tarde: number;
  hora_entrada_real: string | null;
  hora_salida_real: string | null;
  empleado_id: number;
  pin: string;
  empleado_nombre: string;
  turno_id: number | null;
  turno_nombre: string | null;
  turno_entrada: string | null;
  turno_tolerancia: number | null;
  turno_salida: string | null;
}

interface ConteoFila extends RowDataPacket {
  estado: EstadoAsistencia;
  total: number;
}

interface TotalFila extends RowDataPacket {
  total: number;
  en_linea?: number;
}

export interface MarcaNueva {
  id: number;
  empleadoId: number;
  pin: string;
  fechaHora: string;
  tipoEvento: number;
}

function turnoDesdeFila(fila: TurnoFila): TurnoEvaluable & { id: number; nombre: string } {
  return {
    id: Number(fila.turno_id),
    nombre: fila.nombre,
    horaEntrada: horaEnTexto(fila.hora_entrada),
    toleranciaMinutos: Number(fila.tolerancia_minutos),
    horaSalida: horaEnTexto(fila.hora_salida),
    diasSemana: fila.dias_semana,
  };
}

async function turnoDelDia(empleadoId: number, fecha: string) {
  const [filas] = await pool.query<TurnoFila[]>(
    `SELECT a.empleado_id, t.id AS turno_id, t.nombre, t.hora_entrada, t.tolerancia_minutos,
            t.hora_salida, t.dias_semana
     FROM asist_asignaciones a
     INNER JOIN asist_turnos t ON t.id = a.turno_id AND t.activo = 1
     WHERE a.empleado_id = ?
       AND a.vigente_desde <= ?
       AND (a.vigente_hasta IS NULL OR a.vigente_hasta >= ?)
     ORDER BY a.vigente_desde DESC
     LIMIT 1`,
    [empleadoId, fecha, fecha],
  );
  const fila = filas[0];
  return fila ? turnoDesdeFila(fila) : null;
}

async function marcasDelDia(empleadoId: number, fecha: string): Promise<MarcaEvaluable[]> {
  const [filas] = await pool.query<MarcaFila[]>(
    `SELECT id, empleado_id, fecha_hora, tipo_evento
     FROM asist_marcaciones
     WHERE empleado_id = ? AND fecha_hora >= ? AND fecha_hora <= ?
     ORDER BY fecha_hora ASC, id ASC`,
    [empleadoId, `${fecha} 00:00:00`, `${fecha} 23:59:59`],
  );
  return filas.map((fila) => ({
    id: Number(fila.id),
    fechaHora: fila.fecha_hora,
    tipoEvento: Number(fila.tipo_evento),
  }));
}

async function guardarEvaluacion(
  empleadoId: number,
  fecha: string,
  turnoId: number | null,
  evaluacion: ReturnType<typeof evaluarAsistencia>,
): Promise<void> {
  if (!evaluacion) {
    await pool.query('DELETE FROM asist_resultados WHERE empleado_id = ? AND fecha = ?', [empleadoId, fecha]);
    return;
  }
  await pool.query(
    `INSERT INTO asist_resultados (
       empleado_id, fecha, turno_id, marcacion_entrada_id, marcacion_salida_id,
       hora_entrada_real, hora_salida_real, estado, minutos_tarde
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       turno_id = VALUES(turno_id),
       marcacion_entrada_id = VALUES(marcacion_entrada_id),
       marcacion_salida_id = VALUES(marcacion_salida_id),
       hora_entrada_real = VALUES(hora_entrada_real),
       hora_salida_real = VALUES(hora_salida_real),
       estado = VALUES(estado),
       minutos_tarde = VALUES(minutos_tarde)`,
    [
      empleadoId,
      fecha,
      turnoId,
      evaluacion.entrada?.id ?? null,
      evaluacion.salida?.id ?? null,
      evaluacion.entrada?.fechaHora ?? null,
      evaluacion.salida?.fechaHora ?? null,
      evaluacion.estado,
      evaluacion.minutosTarde,
    ],
  );
}

export async function calcularEmpleadoDia(empleadoId: number, fecha: string, ahora = formatLima()): Promise<void> {
  const turno = await turnoDelDia(empleadoId, fecha);
  const marcaciones = await marcasDelDia(empleadoId, fecha);
  const evaluacion = evaluarAsistencia({
    fecha,
    ahora,
    turno,
    marcaciones,
    feriado: await esFeriado(fecha),
  });
  await guardarEvaluacion(empleadoId, fecha, turno?.id ?? null, evaluacion);
}

export async function asegurarDia(fecha: string): Promise<void> {
  const ahora = formatLima();
  const feriado = await esFeriado(fecha);
  const [turnos] = await pool.query<TurnoFila[]>(
    `SELECT e.id AS empleado_id, t.id AS turno_id, t.nombre, t.hora_entrada, t.tolerancia_minutos,
            t.hora_salida, t.dias_semana
     FROM asist_empleados e
     INNER JOIN asist_asignaciones a ON a.empleado_id = e.id
     INNER JOIN asist_turnos t ON t.id = a.turno_id AND t.activo = 1
     WHERE e.activo = 1
       AND a.vigente_desde <= ?
       AND (a.vigente_hasta IS NULL OR a.vigente_hasta >= ?)
     ORDER BY e.id ASC, a.vigente_desde DESC`,
    [fecha, fecha],
  );
  const [marcas] = await pool.query<MarcaFila[]>(
    `SELECT id, empleado_id, fecha_hora, tipo_evento
     FROM asist_marcaciones
     WHERE fecha_hora >= ? AND fecha_hora <= ?
     ORDER BY empleado_id ASC, fecha_hora ASC, id ASC`,
    [`${fecha} 00:00:00`, `${fecha} 23:59:59`],
  );

  const turnoPorEmpleado = new Map<number, ReturnType<typeof turnoDesdeFila>>();
  for (const fila of turnos) {
    const empleadoId = Number(fila.empleado_id);
    if (!turnoPorEmpleado.has(empleadoId)) turnoPorEmpleado.set(empleadoId, turnoDesdeFila(fila));
  }
  const marcasPorEmpleado = new Map<number, MarcaEvaluable[]>();
  for (const fila of marcas) {
    const empleadoId = Number(fila.empleado_id);
    const lista = marcasPorEmpleado.get(empleadoId) ?? [];
    lista.push({ id: Number(fila.id), fechaHora: fila.fecha_hora, tipoEvento: Number(fila.tipo_evento) });
    marcasPorEmpleado.set(empleadoId, lista);
  }

  const ids = new Set<number>([...turnoPorEmpleado.keys(), ...marcasPorEmpleado.keys()]);
  for (const empleadoId of ids) {
    const turno = turnoPorEmpleado.get(empleadoId) ?? null;
    const evaluacion = evaluarAsistencia({
      fecha,
      ahora,
      turno,
      marcaciones: marcasPorEmpleado.get(empleadoId) ?? [],
      feriado,
    });
    await guardarEvaluacion(empleadoId, fecha, turno?.id ?? null, evaluacion);
  }
}

export async function asegurarRango(desde: string, hasta: string): Promise<void> {
  if (desde > hasta) throw new HttpError(400, 'La fecha inicial es posterior a la final');
  const dias = enumerarDias(desde, hasta, 63);
  if (dias.length === 0 || dias[dias.length - 1] !== hasta) {
    throw new HttpError(400, 'El rango maximo de calculo es de 62 dias');
  }
  for (const dia of dias) {
    await asegurarDia(dia);
  }
}

export async function procesarMarcacionesNuevas(sn: string, marcas: MarcaNueva[]): Promise<void> {
  const dias = new Map<string, { empleadoId: number; fecha: string }>();
  for (const marca of marcas) {
    const fecha = marca.fechaHora.slice(0, 10);
    dias.set(`${marca.empleadoId}|${fecha}`, { empleadoId: marca.empleadoId, fecha });
  }
  for (const dia of dias.values()) {
    await calcularEmpleadoDia(dia.empleadoId, dia.fecha);
  }
  for (const marca of marcas) {
    void despacharMarcacion(sn, marca).catch((error: unknown) => {
      logger.error('No se pudo enviar la marcacion al webhook', error);
    });
  }
}

function mapearResultado(fila: ResultadoFila): ResultadoAsistenciaApi {
  return {
    id: Number(fila.id),
    fecha: String(fila.fecha).slice(0, 10),
    estado: fila.estado,
    minutos_tarde: Number(fila.minutos_tarde),
    hora_entrada_real: fila.hora_entrada_real,
    hora_salida_real: fila.hora_salida_real,
    empleado: {
      id: Number(fila.empleado_id),
      pin: fila.pin,
      nombre: fila.empleado_nombre,
    },
    turno: fila.turno_id
      ? {
          id: Number(fila.turno_id),
          nombre: fila.turno_nombre ?? '',
          hora_entrada: horaEnTexto(fila.turno_entrada),
          tolerancia_minutos: Number(fila.turno_tolerancia ?? 0),
          hora_salida: horaEnTexto(fila.turno_salida),
        }
      : null,
  };
}

const SELECT_RESULTADO = `
  SELECT r.id, r.fecha, r.estado, r.minutos_tarde, r.hora_entrada_real, r.hora_salida_real,
         e.id AS empleado_id, e.pin, e.nombre AS empleado_nombre,
         t.id AS turno_id, t.nombre AS turno_nombre, t.hora_entrada AS turno_entrada,
         t.tolerancia_minutos AS turno_tolerancia, t.hora_salida AS turno_salida
  FROM asist_resultados r
  INNER JOIN asist_empleados e ON e.id = r.empleado_id
  LEFT JOIN asist_turnos t ON t.id = r.turno_id
`;

export async function listarAsistencias(consulta: { desde?: unknown; hasta?: unknown; estado?: unknown; q?: unknown; pagina?: unknown; page?: unknown; limite?: unknown; limit?: unknown }): Promise<{ datos: ResultadoAsistenciaApi[]; paginacion: { pagina: number; limite: number; total: number; paginas: number } }> {
  const hoy = fechaDeHoy();
  const desde = textoConsulta(consulta.desde) || hoy;
  const hasta = textoConsulta(consulta.hasta) || desde;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    throw new HttpError(400, 'desde y hasta deben tener formato YYYY-MM-DD');
  }
  await asegurarRango(desde, hasta);

  const pagina = Number(textoConsulta(consulta.pagina ?? consulta.page) || '1');
  const limite = Number(textoConsulta(consulta.limite ?? consulta.limit) || '50');
  if (!Number.isInteger(pagina) || pagina < 1 || pagina > 100000) throw new HttpError(400, 'pagina invalida');
  if (!Number.isInteger(limite) || limite < 1 || limite > 200) throw new HttpError(400, 'limite invalido');

  const condiciones = ['r.fecha >= ?', 'r.fecha <= ?'];
  const parametros: Array<string | number> = [desde, hasta];
  const estado = textoConsulta(consulta.estado);
  if (estado) {
    if (!['a_tiempo', 'tardanza', 'falta', 'sin_turno', 'feriado'].includes(estado)) {
      throw new HttpError(400, 'Estado de asistencia invalido');
    }
    condiciones.push('r.estado = ?');
    parametros.push(estado);
  }
  const busqueda = textoConsulta(consulta.q).slice(0, 80);
  if (busqueda) {
    condiciones.push('(e.pin LIKE ? OR e.nombre LIKE ?)');
    const comodin = `%${busqueda.replace(/[%_\\]/g, '')}%`;
    parametros.push(comodin, comodin);
  }
  const where = `WHERE ${condiciones.join(' AND ')}`;
  const [conteo] = await pool.query<TotalFila[]>(
    `SELECT COUNT(*) AS total
     FROM asist_resultados r
     INNER JOIN asist_empleados e ON e.id = r.empleado_id
     ${where}`,
    parametros,
  );
  const total = Number(conteo[0]?.total ?? 0);
  const desplazamiento = (pagina - 1) * limite;
  const [filas] = await pool.query<ResultadoFila[]>(
    `${SELECT_RESULTADO}
     ${where}
     ORDER BY r.fecha DESC, FIELD(r.estado, 'falta', 'tardanza', 'sin_turno', 'a_tiempo', 'feriado'), e.nombre ASC
     LIMIT ${limite} OFFSET ${desplazamiento}`,
    parametros,
  );
  return {
    datos: filas.map(mapearResultado),
    paginacion: { pagina, limite, total, paginas: Math.ceil(total / limite) },
  };
}

export async function resumenDelDia(fechaEntrada?: string) {
  const fecha = fechaEntrada && /^\d{4}-\d{2}-\d{2}$/.test(fechaEntrada) ? fechaEntrada : fechaDeHoy();
  if (fechaEntrada && fecha !== fechaEntrada) throw new HttpError(400, 'fecha invalida');
  await asegurarDia(fecha);

  const [conteos] = await pool.query<ConteoFila[]>(
    `SELECT estado, COUNT(*) AS total FROM asist_resultados WHERE fecha = ? GROUP BY estado`,
    [fecha],
  );
  const porEstado: Record<EstadoAsistencia, number> = {
    a_tiempo: 0,
    tardanza: 0,
    falta: 0,
    sin_turno: 0,
    feriado: 0,
  };
  for (const fila of conteos) porEstado[fila.estado] = Number(fila.total);

  const [marcas] = await pool.query<TotalFila[]>(
    `SELECT COUNT(*) AS total FROM asist_marcaciones WHERE fecha_hora >= ? AND fecha_hora <= ?`,
    [`${fecha} 00:00:00`, `${fecha} 23:59:59`],
  );
  const [dispositivos] = await pool.query<TotalFila[]>(
    `SELECT COUNT(*) AS total,
            SUM(ultima_conexion IS NOT NULL AND ultima_conexion >= DATE_SUB(NOW(), INTERVAL 3 MINUTE)) AS en_linea
     FROM asist_dispositivos`,
  );
  const [alertas] = await pool.query<ResultadoFila[]>(
    `${SELECT_RESULTADO}
     WHERE r.fecha = ? AND r.estado IN ('falta', 'tardanza', 'sin_turno')
     ORDER BY FIELD(r.estado, 'falta', 'tardanza', 'sin_turno'), r.minutos_tarde DESC
     LIMIT 8`,
    [fecha],
  );

  return {
    fecha,
    a_tiempo: porEstado.a_tiempo,
    tardanza: porEstado.tardanza,
    falta: porEstado.falta,
    sin_turno: porEstado.sin_turno,
    feriado: porEstado.feriado,
    marcaciones: Number(marcas[0]?.total ?? 0),
    dispositivos: Number(dispositivos[0]?.total ?? 0),
    dispositivos_en_linea: Number(dispositivos[0]?.en_linea ?? 0),
    alertas: alertas.map(mapearResultado),
  };
}
