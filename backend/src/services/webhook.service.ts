import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../config/database';
import { nombreEvento } from '../protocolo/adms';
import type { EstadoAsistencia, WebhookApi } from '../types';
import { formatLima } from '../utils/datetime';
import { HttpError } from '../utils/http';
import { logger } from '../utils/logger';

interface MarcaNueva {
  id: number;
  empleadoId: number;
  pin: string;
  fechaHora: string;
  tipoEvento: number;
}

interface WebhookFila extends RowDataPacket {
  id: number;
  nombre: string;
  url: string;
  secreto: string;
  activo: number;
  ultimo_http: number | null;
  ultimo_envio: string | null;
  ultimo_error: string | null;
  creado_en: string;
}

interface ContextoFila extends RowDataPacket {
  nombre: string;
  estado: EstadoAsistencia | null;
  minutos_tarde: number | null;
  turno_nombre: string | null;
}

function mapear(fila: WebhookFila): WebhookApi {
  return {
    id: Number(fila.id),
    nombre: fila.nombre,
    url: fila.url,
    activo: Boolean(fila.activo),
    ultimo_http: fila.ultimo_http === null ? null : Number(fila.ultimo_http),
    ultimo_envio: fila.ultimo_envio,
    ultimo_error: fila.ultimo_error,
    creado_en: fila.creado_en,
  };
}

export function validarUrlWebhook(valor: string): string {
  let url: URL;
  try {
    url = new URL(valor.trim());
  } catch {
    throw new HttpError(400, 'URL invalida');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new HttpError(400, 'La URL debe usar http o https');
  }
  if (url.toString().length > 500) throw new HttpError(400, 'URL demasiado larga');
  return url.toString();
}

export async function listarWebhooks(): Promise<WebhookApi[]> {
  const [filas] = await pool.query<WebhookFila[]>(
    `SELECT id, nombre, url, secreto, activo, ultimo_http, ultimo_envio, ultimo_error, creado_en
     FROM asist_webhooks ORDER BY id DESC`,
  );
  return filas.map(mapear);
}

export async function crearWebhook(entrada: { nombre: string; url: string; secreto: string }): Promise<WebhookApi> {
  const [resultado] = await pool.query<ResultSetHeader>(
    `INSERT INTO asist_webhooks (nombre, url, secreto, activo) VALUES (?, ?, ?, 1)`,
    [entrada.nombre, validarUrlWebhook(entrada.url), entrada.secreto],
  );
  const [filas] = await pool.query<WebhookFila[]>(
    `SELECT id, nombre, url, secreto, activo, ultimo_http, ultimo_envio, ultimo_error, creado_en
     FROM asist_webhooks WHERE id = ?`,
    [resultado.insertId],
  );
  const fila = filas[0];
  if (!fila) throw new Error('No se pudo leer el webhook creado');
  return mapear(fila);
}

export async function actualizarWebhook(
  id: number,
  cambios: { nombre?: string; url?: string; secreto?: string; activo?: boolean },
): Promise<WebhookApi | null> {
  const asignaciones: string[] = [];
  const parametros: Array<string | number> = [];
  if (cambios.nombre !== undefined) {
    asignaciones.push('nombre = ?');
    parametros.push(cambios.nombre);
  }
  if (cambios.url !== undefined) {
    asignaciones.push('url = ?');
    parametros.push(validarUrlWebhook(cambios.url));
  }
  if (cambios.secreto !== undefined) {
    asignaciones.push('secreto = ?');
    parametros.push(cambios.secreto);
  }
  if (cambios.activo !== undefined) {
    asignaciones.push('activo = ?');
    parametros.push(cambios.activo ? 1 : 0);
  }
  if (asignaciones.length === 0) throw new HttpError(400, 'Nada que actualizar');
  parametros.push(id);
  await pool.query(`UPDATE asist_webhooks SET ${asignaciones.join(', ')} WHERE id = ?`, parametros);
  const [filas] = await pool.query<WebhookFila[]>(
    `SELECT id, nombre, url, secreto, activo, ultimo_http, ultimo_envio, ultimo_error, creado_en
     FROM asist_webhooks WHERE id = ?`,
    [id],
  );
  return filas[0] ? mapear(filas[0]) : null;
}

export async function eliminarWebhook(id: number): Promise<boolean> {
  const [resultado] = await pool.query<ResultSetHeader>('DELETE FROM asist_webhooks WHERE id = ?', [id]);
  return resultado.affectedRows > 0;
}

export async function despacharMarcacion(sn: string, marca: MarcaNueva): Promise<void> {
  const [destinos] = await pool.query<WebhookFila[]>(
    `SELECT id, nombre, url, secreto, activo, ultimo_http, ultimo_envio, ultimo_error, creado_en
     FROM asist_webhooks WHERE activo = 1`,
  );
  if (destinos.length === 0) return;

  const fecha = marca.fechaHora.slice(0, 10);
  const [contexto] = await pool.query<ContextoFila[]>(
    `SELECT e.nombre, r.estado, r.minutos_tarde, t.nombre AS turno_nombre
     FROM asist_empleados e
     LEFT JOIN asist_resultados r ON r.empleado_id = e.id AND r.fecha = ?
     LEFT JOIN asist_turnos t ON t.id = r.turno_id
     WHERE e.id = ?
     LIMIT 1`,
    [fecha, marca.empleadoId],
  );
  const fila = contexto[0];
  const cuerpo = {
    evento: 'marcacion.creada',
    zona_horaria: 'America/Lima',
    enviado_en: formatLima(),
    marcacion: {
      id: marca.id,
      pin: marca.pin,
      empleado: fila?.nombre ?? `Empleado ${marca.pin}`,
      fecha_hora: marca.fechaHora,
      tipo_evento: marca.tipoEvento,
      tipo_evento_nombre: nombreEvento(marca.tipoEvento),
      dispositivo_sn: sn,
    },
    resultado: fila?.estado
      ? {
          fecha,
          estado: fila.estado,
          minutos_tarde: Number(fila.minutos_tarde ?? 0),
          turno: fila.turno_nombre,
        }
      : null,
  };

  await Promise.all(destinos.map(async (destino) => {
    let http: number | null = null;
    let error = '';
    try {
      const respuesta = await fetch(destino.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': destino.secreto,
          'User-Agent': 'asistencias-zkteco',
        },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(8000),
      });
      http = respuesta.status;
      if (!respuesta.ok) error = `HTTP ${respuesta.status}`;
    } catch (fallo) {
      error = fallo instanceof Error ? fallo.message : 'Error de red';
      logger.error('Entrega de webhook fallida', { id: destino.id, url: destino.url, error });
    }
    await pool.query(
      `UPDATE asist_webhooks
       SET ultimo_http = ?, ultimo_envio = ?, ultimo_error = ?
       WHERE id = ?`,
      [http, formatLima(), error ? error.slice(0, 255) : null, destino.id],
    );
  }));
}
