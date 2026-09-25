import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Request } from 'express';
import { pool } from '../config/database';
import { nombreEvento, nombreMetodo } from '../protocolo/adms';
import type { ComandoApi, DispositivoApi, EmpleadoApi, EstadoComando, MarcacionApi, Paginacion } from '../types';
import { fechaDeHoy, horaEnTexto, normalizarFechaHora } from '../utils/datetime';
import { HttpError, textoConsulta } from '../utils/http';

interface DispositivoFila extends RowDataPacket {
  id: number;
  sn: string;
  alias: string | null;
  ip_origen: string | null;
  firmware: string | null;
  push_version: string | null;
  ultima_conexion: string | null;
  en_linea: number;
}

interface EmpleadoFila extends RowDataPacket {
  id: number;
  pin: string;
  nombre: string;
  privilegio: number;
  tarjeta: string | null;
  grupo: string | null;
  activo: number;
  origen: EmpleadoApi['origen'];
  creado_en: string;
  actualizado_en: string;
  turno_id: number | null;
  turno_nombre: string | null;
  turno_entrada: string | null;
  turno_tolerancia: number | null;
  turno_salida: string | null;
  turno_dias: string | null;
  turno_desde: string | null;
  turno_hasta: string | null;
}

interface MarcacionFila extends RowDataPacket {
  id: number;
  pin: string;
  empleado_id: number;
  empleado_nombre: string;
  fecha_hora: string;
  tipo_evento: number;
  metodo_verificacion: number;
  codigo_trabajo: string | null;
  creado_en: string;
  dispositivo_id: number;
  dispositivo_sn: string;
  dispositivo_alias: string | null;
  dispositivo_ip: string | null;
}

interface ComandoFila extends RowDataPacket {
  id: number;
  dispositivo_id: number;
  sn: string;
  comando: string;
  estado: EstadoComando;
  retorno: string | null;
  intentos: number;
  creado_en: string;
  enviado_en: string | null;
  ejecutado_en: string | null;
}

interface TotalFila extends RowDataPacket {
  total: number;
}

function enteroConsulta(valor: unknown, defecto: number, minimo: number, maximo: number, nombre: string): number {
  const texto = textoConsulta(valor);
  if (!texto) return defecto;
  if (!/^\d+$/.test(texto)) throw new HttpError(400, `${nombre} debe ser un entero positivo`);
  const numero = Number(texto);
  if (numero < minimo || numero > maximo) {
    throw new HttpError(400, `${nombre} debe estar entre ${minimo} y ${maximo}`);
  }
  return numero;
}

function fechaFiltro(valor: string, finDeDia: boolean, nombre: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    const ancla = normalizarFechaHora(`${valor} 00:00:00`);
    if (!ancla) throw new HttpError(400, `${nombre} no es una fecha valida`);
    return finDeDia ? `${valor} 23:59:59` : `${valor} 00:00:00`;
  }
  const normalizada = normalizarFechaHora(valor);
  if (!normalizada) {
    throw new HttpError(400, `${nombre} debe tener formato YYYY-MM-DD o YYYY-MM-DD HH:mm:ss`);
  }
  return normalizada;
}

function mapearDispositivo(fila: DispositivoFila): DispositivoApi {
  return {
    id: Number(fila.id),
    sn: fila.sn,
    alias: fila.alias,
    ip_origen: fila.ip_origen,
    firmware: fila.firmware,
    push_version: fila.push_version,
    ultima_conexion: fila.ultima_conexion,
    en_linea: Boolean(fila.en_linea),
  };
}

function mapearEmpleado(fila: EmpleadoFila): EmpleadoApi {
  return {
    id: Number(fila.id),
    pin: fila.pin,
    nombre: fila.nombre,
    privilegio: Number(fila.privilegio),
    tarjeta: fila.tarjeta,
    grupo: fila.grupo,
    activo: Boolean(fila.activo),
    origen: fila.origen,
    creado_en: fila.creado_en,
    actualizado_en: fila.actualizado_en,
    turno: fila.turno_id
      ? {
          id: Number(fila.turno_id),
          nombre: fila.turno_nombre ?? '',
          hora_entrada: horaEnTexto(fila.turno_entrada),
          tolerancia_minutos: Number(fila.turno_tolerancia ?? 0),
          hora_salida: horaEnTexto(fila.turno_salida),
          dias_semana: fila.turno_dias ?? '1111100',
          vigente_desde: String(fila.turno_desde).slice(0, 10),
          vigente_hasta: fila.turno_hasta ? String(fila.turno_hasta).slice(0, 10) : null,
        }
      : null,
  };
}

export async function listarDispositivos(): Promise<DispositivoApi[]> {
  const [filas] = await pool.query<DispositivoFila[]>(
    `SELECT id, sn, alias, ip_origen, firmware, push_version, ultima_conexion,
            (ultima_conexion IS NOT NULL AND ultima_conexion >= DATE_SUB(NOW(), INTERVAL 3 MINUTE)) AS en_linea
     FROM asist_dispositivos
     ORDER BY ultima_conexion DESC, id ASC`,
  );
  return filas.map(mapearDispositivo);
}

export async function actualizarAliasDispositivo(id: number, alias: string | null): Promise<DispositivoApi | null> {
  const [existe] = await pool.query<TotalFila[]>(
    'SELECT COUNT(*) AS total FROM asist_dispositivos WHERE id = ?',
    [id],
  );
  if (Number(existe[0]?.total ?? 0) === 0) return null;

  await pool.query(
    'UPDATE asist_dispositivos SET alias = ? WHERE id = ?',
    [alias, id],
  );
  const [filas] = await pool.query<DispositivoFila[]>(
    `SELECT id, sn, alias, ip_origen, firmware, push_version, ultima_conexion,
            (ultima_conexion IS NOT NULL AND ultima_conexion >= DATE_SUB(NOW(), INTERVAL 3 MINUTE)) AS en_linea
     FROM asist_dispositivos WHERE id = ?`,
    [id],
  );
  const fila = filas[0];
  return fila ? mapearDispositivo(fila) : null;
}

export async function listarEmpleados(consulta: Request['query']): Promise<{ datos: EmpleadoApi[]; paginacion: Paginacion }> {
  const pagina = enteroConsulta(consulta.pagina ?? consulta.page, 1, 1, 100000, 'pagina');
  const limite = enteroConsulta(consulta.limite ?? consulta.limit, 50, 1, 200, 'limite');
  const busqueda = textoConsulta(consulta.q).slice(0, 80);
  const condiciones: string[] = [];
  const parametros: string[] = [];
  const hoy = fechaDeHoy();

  if (busqueda) {
    condiciones.push('(e.pin LIKE ? OR e.nombre LIKE ?)');
    const comodin = `%${busqueda.replace(/[%_\\]/g, '')}%`;
    parametros.push(comodin, comodin);
  }
  const activo = textoConsulta(consulta.activo);
  if (activo === '1' || activo === '0') {
    condiciones.push('e.activo = ?');
    parametros.push(activo);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const [conteo] = await pool.query<TotalFila[]>(
    `SELECT COUNT(*) AS total FROM asist_empleados e ${where}`,
    parametros,
  );
  const total = Number(conteo[0]?.total ?? 0);
  const desplazamiento = (pagina - 1) * limite;
  const [filas] = await pool.query<EmpleadoFila[]>(
    `SELECT e.id, e.pin, e.nombre, e.privilegio, e.tarjeta, e.grupo, e.activo, e.origen,
            e.creado_en, e.actualizado_en,
            t.id AS turno_id, t.nombre AS turno_nombre, t.hora_entrada AS turno_entrada,
            t.tolerancia_minutos AS turno_tolerancia, t.hora_salida AS turno_salida,
            t.dias_semana AS turno_dias, a.vigente_desde AS turno_desde, a.vigente_hasta AS turno_hasta
     FROM asist_empleados e
     LEFT JOIN asist_asignaciones a ON a.id = (
       SELECT a2.id FROM asist_asignaciones a2
       WHERE a2.empleado_id = e.id
         AND a2.vigente_desde <= ?
         AND (a2.vigente_hasta IS NULL OR a2.vigente_hasta >= ?)
       ORDER BY a2.vigente_desde DESC
       LIMIT 1
     )
     LEFT JOIN asist_turnos t ON t.id = a.turno_id
     ${where}
     ORDER BY e.nombre ASC, e.id ASC
     LIMIT ${limite} OFFSET ${desplazamiento}`,
    [hoy, hoy, ...parametros],
  );

  return {
    datos: filas.map(mapearEmpleado),
    paginacion: { pagina, limite, total, paginas: Math.ceil(total / limite) },
  };
}

export async function actualizarEmpleado(
  id: number,
  cambios: { nombre?: string; activo?: boolean },
): Promise<EmpleadoApi | null> {
  const asignaciones: string[] = [];
  const parametros: Array<string | number> = [];
  if (cambios.nombre !== undefined) {
    asignaciones.push("nombre = ?", "origen = 'manual'");
    parametros.push(cambios.nombre);
  }
  if (cambios.activo !== undefined) {
    asignaciones.push('activo = ?');
    parametros.push(cambios.activo ? 1 : 0);
  }
  if (asignaciones.length === 0) {
    throw new HttpError(400, 'Nada que actualizar');
  }
  parametros.push(id);
  const [resultado] = await pool.query<ResultSetHeader>(
    `UPDATE asist_empleados SET ${asignaciones.join(', ')} WHERE id = ?`,
    parametros,
  );
  if (resultado.affectedRows === 0) {
    const [existe] = await pool.query<TotalFila[]>('SELECT COUNT(*) AS total FROM asist_empleados WHERE id = ?', [id]);
    if (Number(existe[0]?.total ?? 0) === 0) return null;
  }
  const hoy = fechaDeHoy();
  const [filas] = await pool.query<EmpleadoFila[]>(
    `SELECT e.id, e.pin, e.nombre, e.privilegio, e.tarjeta, e.grupo, e.activo, e.origen,
            e.creado_en, e.actualizado_en,
            t.id AS turno_id, t.nombre AS turno_nombre, t.hora_entrada AS turno_entrada,
            t.tolerancia_minutos AS turno_tolerancia, t.hora_salida AS turno_salida,
            t.dias_semana AS turno_dias, a.vigente_desde AS turno_desde, a.vigente_hasta AS turno_hasta
     FROM asist_empleados e
     LEFT JOIN asist_asignaciones a ON a.id = (
       SELECT a2.id FROM asist_asignaciones a2
       WHERE a2.empleado_id = e.id
         AND a2.vigente_desde <= ?
         AND (a2.vigente_hasta IS NULL OR a2.vigente_hasta >= ?)
       ORDER BY a2.vigente_desde DESC
       LIMIT 1
     )
     LEFT JOIN asist_turnos t ON t.id = a.turno_id
     WHERE e.id = ?`,
    [hoy, hoy, id],
  );
  const fila = filas[0];
  return fila ? mapearEmpleado(fila) : null;
}

export async function listarMarcaciones(consulta: Request['query']): Promise<{ datos: MarcacionApi[]; paginacion: Paginacion }> {
  const pagina = enteroConsulta(consulta.pagina ?? consulta.page, 1, 1, 100000, 'pagina');
  const limite = enteroConsulta(consulta.limite ?? consulta.limit, 50, 1, 200, 'limite');
  const condiciones: string[] = [];
  const parametros: Array<string | number> = [];

  const desde = textoConsulta(consulta.desde);
  const hasta = textoConsulta(consulta.hasta);
  if (desde) {
    condiciones.push('m.fecha_hora >= ?');
    parametros.push(fechaFiltro(desde, false, 'desde'));
  }
  if (hasta) {
    condiciones.push('m.fecha_hora <= ?');
    parametros.push(fechaFiltro(hasta, true, 'hasta'));
  }

  const pin = textoConsulta(consulta.pin);
  if (pin) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(pin)) throw new HttpError(400, 'PIN invalido');
    condiciones.push('m.pin = ?');
    parametros.push(pin);
  }

  const sn = textoConsulta(consulta.sn);
  if (sn) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(sn)) throw new HttpError(400, 'Numero de serie invalido');
    condiciones.push('d.sn = ?');
    parametros.push(sn);
  }

  const dispositivoTexto = textoConsulta(consulta.dispositivo_id);
  if (dispositivoTexto) {
    const dispositivoId = enteroConsulta(dispositivoTexto, 0, 1, 2_000_000_000, 'dispositivo_id');
    condiciones.push('m.dispositivo_id = ?');
    parametros.push(dispositivoId);
  }

  const busqueda = textoConsulta(consulta.q).slice(0, 80);
  if (busqueda) {
    condiciones.push('(m.pin LIKE ? OR e.nombre LIKE ?)');
    const comodin = `%${busqueda.replace(/[%_\\]/g, '')}%`;
    parametros.push(comodin, comodin);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const [conteo] = await pool.query<TotalFila[]>(
    `SELECT COUNT(*) AS total
     FROM asist_marcaciones m
     INNER JOIN asist_empleados e ON e.id = m.empleado_id
     INNER JOIN asist_dispositivos d ON d.id = m.dispositivo_id
     ${where}`,
    parametros,
  );
  const total = Number(conteo[0]?.total ?? 0);
  const desplazamiento = (pagina - 1) * limite;
  const [filas] = await pool.query<MarcacionFila[]>(
    `SELECT
       m.id, m.pin, m.fecha_hora, m.tipo_evento, m.metodo_verificacion, m.codigo_trabajo, m.creado_en,
       e.id AS empleado_id, e.nombre AS empleado_nombre,
       d.id AS dispositivo_id, d.sn AS dispositivo_sn, d.alias AS dispositivo_alias, d.ip_origen AS dispositivo_ip
     FROM asist_marcaciones m
     INNER JOIN asist_empleados e ON e.id = m.empleado_id
     INNER JOIN asist_dispositivos d ON d.id = m.dispositivo_id
     ${where}
     ORDER BY m.fecha_hora DESC, m.id DESC
     LIMIT ${limite} OFFSET ${desplazamiento}`,
    parametros,
  );

  return {
    datos: filas.map((fila) => ({
      id: Number(fila.id),
      pin: fila.pin,
      empleado_id: Number(fila.empleado_id),
      empleado: fila.empleado_nombre,
      fecha_hora: fila.fecha_hora,
      tipo_evento: Number(fila.tipo_evento),
      tipo_evento_nombre: nombreEvento(Number(fila.tipo_evento)),
      metodo_verificacion: Number(fila.metodo_verificacion),
      metodo_verificacion_nombre: nombreMetodo(Number(fila.metodo_verificacion)),
      codigo_trabajo: fila.codigo_trabajo,
      creado_en: fila.creado_en,
      dispositivo: {
        id: Number(fila.dispositivo_id),
        sn: fila.dispositivo_sn,
        alias: fila.dispositivo_alias,
        ip_origen: fila.dispositivo_ip,
      },
    })),
    paginacion: { pagina, limite, total, paginas: Math.ceil(total / limite) },
  };
}

export async function listarComandos(consulta: Request['query']): Promise<ComandoApi[]> {
  const limite = enteroConsulta(consulta.limite ?? consulta.limit, 50, 1, 200, 'limite');
  const condiciones: string[] = [];
  const parametros: string[] = [];
  const sn = textoConsulta(consulta.sn);
  const estado = textoConsulta(consulta.estado);
  if (sn) {
    condiciones.push('d.sn = ?');
    parametros.push(sn);
  }
  if (estado) {
    if (!['pendiente', 'enviado', 'ejecutado', 'error'].includes(estado)) {
      throw new HttpError(400, 'Estado de comando invalido');
    }
    condiciones.push('c.estado = ?');
    parametros.push(estado);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const [filas] = await pool.query<ComandoFila[]>(
    `SELECT c.id, c.dispositivo_id, d.sn, c.comando, c.estado, c.retorno, c.intentos,
            c.creado_en, c.enviado_en, c.ejecutado_en
     FROM asist_comandos c
     INNER JOIN asist_dispositivos d ON d.id = c.dispositivo_id
     ${where}
     ORDER BY c.id DESC
     LIMIT ${limite}`,
    parametros,
  );
  return filas.map((fila) => ({
    id: Number(fila.id),
    dispositivo_id: Number(fila.dispositivo_id),
    sn: fila.sn,
    comando: fila.comando,
    estado: fila.estado,
    retorno: fila.retorno,
    intentos: Number(fila.intentos),
    creado_en: fila.creado_en,
    enviado_en: fila.enviado_en,
    ejecutado_en: fila.ejecutado_en,
  }));
}
