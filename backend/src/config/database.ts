import mysql from 'mysql2';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { env } from './env';
import { logger } from '../utils/logger';

interface ZonaFila extends RowDataPacket {
  zona: string;
}

/**
 * America/Lima equivale a -05:00 todo el año.
 * El desplazamiento numerico funciona aunque MySQL no tenga cargadas
 * las tablas de zonas (mysql_tzinfo_to_sql), habitual en un VPS nuevo.
 * Se aplica en cada conexion fisica del pool, no solo al arrancar.
 *
 * dateStrings evita que el driver reinterpret DATETIME como instante UTC
 * y desplace la hora de la marcacion al leerla o escribirla.
 */
const SQL_ZONA = "SET time_zone = '-05:00'";

const poolNativo = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: env.db.connectionLimit,
  queueLimit: 0,
  timezone: '-05:00',
  dateStrings: true,
  charset: 'utf8mb4',
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  connectTimeout: 10000,
});

poolNativo.on('connection', (conexion) => {
  conexion.query(SQL_ZONA, (error) => {
    if (error) {
      logger.error('No se pudo fijar America/Lima (-05:00) en la sesion MySQL', error);
    }
  });
});

export const pool: Pool = poolNativo.promise();

export async function prepararBaseDatos(): Promise<void> {
  const conexion = await pool.getConnection();
  try {
    await conexion.query(SQL_ZONA);
    const [filas] = await conexion.query<ZonaFila[]>(
      'SELECT @@session.time_zone AS zona',
    );
    const zona = filas[0]?.zona ?? '';
    if (zona !== '-05:00') {
      throw new Error(`La sesion MySQL quedo en '${zona}' en lugar de -05:00 (America/Lima)`);
    }
    await conexion.query('SELECT 1');
    logger.info('MySQL listo con zona horaria -05:00 (America/Lima)');
  } finally {
    conexion.release();
  }
}
