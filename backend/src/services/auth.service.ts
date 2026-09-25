import { createHash, randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { env } from '../config/env';
import { pool } from '../config/database';
import { logger } from '../utils/logger';

const derivar = promisify(scrypt);
const HORAS_SESION = 12;
const DUMMY_SALT = 'a1b2c3d4e5f60718';

export interface UsuarioSesion {
  id: number;
  usuario: string;
  nombre: string;
}

interface UsuarioFila extends RowDataPacket {
  id: number;
  usuario: string;
  nombre: string;
  clave_hash: string;
  activo: number;
}

interface SesionFila extends RowDataPacket {
  id: number;
  usuario_id: number;
  usuario: string;
  nombre: string;
  expira_en: string;
}

interface TotalFila extends RowDataPacket {
  total: number;
}

export function normalizarUsuario(valor: string): string {
  return valor.trim().toLowerCase();
}

export async function hashClave(clave: string): Promise<string> {
  const sal = randomBytes(16).toString('hex');
  const derivado = (await derivar(clave, sal, 64)) as Buffer;
  return `${sal}:${derivado.toString('hex')}`;
}

async function clavesCoinciden(clave: string, almacenada: string): Promise<boolean> {
  const [sal, hash] = almacenada.split(':');
  if (!sal || !hash || !/^[0-9a-f]+$/i.test(hash)) return false;
  const derivado = (await derivar(clave, sal, 64)) as Buffer;
  const esperado = Buffer.from(hash, 'hex');
  if (derivado.length !== esperado.length) return false;
  return timingSafeEqual(derivado, esperado);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function autenticar(usuario: string, clave: string): Promise<{ token: string; expiraEn: string; usuario: UsuarioSesion } | null> {
  const normalizado = normalizarUsuario(usuario);
  const [filas] = await pool.query<UsuarioFila[]>(
    `SELECT id, usuario, nombre, clave_hash, activo
     FROM asist_usuarios WHERE usuario = ? LIMIT 1`,
    [normalizado],
  );
  const fila = filas[0];
  if (!fila) {
    await clavesCoinciden(clave, `${DUMMY_SALT}:${'ab'.repeat(64)}`);
    return null;
  }
  const coincide = await clavesCoinciden(clave, fila.clave_hash);
  if (!fila.activo || !coincide) return null;

  const token = randomBytes(32).toString('base64url');
  await pool.query('DELETE FROM asist_sesiones WHERE expira_en < NOW()');
  const [resultado] = await pool.query<ResultSetHeader>(
    `INSERT INTO asist_sesiones (usuario_id, token_hash, expira_en)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ${HORAS_SESION} HOUR))`,
    [fila.id, hashToken(token)],
  );
  const [creada] = await pool.query<Array<RowDataPacket & { expira_en: string }>>(
    'SELECT expira_en FROM asist_sesiones WHERE id = ?',
    [resultado.insertId],
  );

  return {
    token,
    expiraEn: creada[0]?.expira_en ?? '',
    usuario: { id: Number(fila.id), usuario: fila.usuario, nombre: fila.nombre },
  };
}

export async function buscarSesion(token: string): Promise<UsuarioSesion | null> {
  if (!token || token.length < 20) return null;
  const [filas] = await pool.query<SesionFila[]>(
    `SELECT s.id, u.id AS usuario_id, u.usuario, u.nombre, s.expira_en
     FROM asist_sesiones s
     INNER JOIN asist_usuarios u ON u.id = s.usuario_id
     WHERE s.token_hash = ? AND s.expira_en > NOW() AND u.activo = 1
     LIMIT 1`,
    [hashToken(token)],
  );
  const fila = filas[0];
  if (!fila) return null;
  return { id: Number(fila.usuario_id), usuario: fila.usuario, nombre: fila.nombre };
}

export async function cerrarSesion(token: string): Promise<void> {
  if (!token) return;
  await pool.query('DELETE FROM asist_sesiones WHERE token_hash = ?', [hashToken(token)]);
}

/** Crea el primer usuario de panel si la tabla está vacía y el entorno trae clave. */
export async function asegurarUsuarioInicial(): Promise<void> {
  const [conteo] = await pool.query<TotalFila[]>('SELECT COUNT(*) AS total FROM asist_usuarios');
  if (Number(conteo[0]?.total ?? 0) > 0) return;

  const usuario = env.adminUsuario;
  const clave = env.adminPassword;
  if (!usuario || !clave) {
    logger.info('asist_usuarios está vacía. Define ADMIN_USUARIO y ADMIN_PASSWORD para crear el acceso al panel.');
    return;
  }
  if (!/^[a-z0-9._-]{3,60}$/.test(usuario) || clave.length < 8 || clave.length > 128) {
    logger.error('ADMIN_USUARIO o ADMIN_PASSWORD no cumplen el mínimo. No se creó el usuario inicial.');
    return;
  }

  const claveHash = await hashClave(clave);
  await pool.query(
    `INSERT INTO asist_usuarios (usuario, nombre, clave_hash, activo) VALUES (?, ?, ?, 1)`,
    [usuario, env.adminNombre.slice(0, 120), claveHash],
  );
  logger.info(`Usuario de panel creado: ${usuario}`);
}
