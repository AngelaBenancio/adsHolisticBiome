import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../config/database';
import type {
  EstadisticasIngreso,
  OrigenEmpleado,
  RegistroDispositivo,
  ResultadoComando,
  UsuarioCrudo,
  MarcacionCruda,
} from '../types';
import { esFechaFutura, formatLima } from '../utils/datetime';
import { logger } from '../utils/logger';
import { procesarMarcacionesNuevas, type MarcaNueva } from './calculo.service';

interface IdFila extends RowDataPacket {
  id: number;
}

const TOLERANCIA_FUTURO_MINUTOS = 10;
const REINTENTOS_COMANDO = 8;
const MAX_COMANDOS_POR_SONDEO = 20;

function esDuplicado(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'ER_DUP_ENTRY';
}

export async function registrarDispositivo(datos: RegistroDispositivo): Promise<number> {
  const ahora = formatLima();
  const [existentes] = await pool.query<IdFila[]>(
    'SELECT id FROM asist_dispositivos WHERE sn = ? LIMIT 1',
    [datos.sn],
  );

  if (existentes.length > 0) {
    const id = existentes[0]?.id;
    if (!id) throw new Error('Dispositivo sin identificador');
    await pool.query(
      `UPDATE asist_dispositivos
       SET ip_origen = ?,
           ultima_conexion = ?,
           firmware = COALESCE(?, firmware),
           push_version = COALESCE(?, push_version),
           alias = COALESCE(alias, ?)
       WHERE id = ?`,
      [datos.ip || null, ahora, datos.firmware ?? null, datos.pushVersion ?? null, datos.alias ?? null, id],
    );
    return id;
  }

  try {
    const [resultado] = await pool.query<ResultSetHeader>(
      `INSERT INTO asist_dispositivos (sn, alias, ip_origen, firmware, push_version, ultima_conexion)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [datos.sn, datos.alias ?? null, datos.ip || null, datos.firmware ?? null, datos.pushVersion ?? null, ahora],
    );
    return resultado.insertId;
  } catch (error) {
    if (!esDuplicado(error)) throw error;
    const [reintento] = await pool.query<IdFila[]>(
      'SELECT id FROM asist_dispositivos WHERE sn = ? LIMIT 1',
      [datos.sn],
    );
    const id = reintento[0]?.id;
    if (!id) throw error;
    return id;
  }
}

async function asegurarEmpleado(
  db: Pool | PoolConnection,
  pin: string,
  nombre: string,
  origen: OrigenEmpleado,
  privilegio: number,
  tarjeta: string | null,
  grupo: string | null,
): Promise<number> {
  const [resultado] = await db.query<ResultSetHeader>(
    `INSERT INTO asist_empleados (pin, nombre, privilegio, tarjeta, grupo, origen)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       nombre = IF(
         origen = 'manual' OR VALUES(nombre) = CONCAT('Empleado ', pin),
         nombre,
         VALUES(nombre)
       ),
       origen = IF(
         origen = 'manual' OR VALUES(nombre) = CONCAT('Empleado ', pin),
         origen,
         VALUES(origen)
       ),
       privilegio = IF(VALUES(origen) = 'marcacion', privilegio, VALUES(privilegio)),
       tarjeta = IF(VALUES(tarjeta) IS NULL OR VALUES(tarjeta) = '', tarjeta, VALUES(tarjeta)),
       grupo = IF(VALUES(grupo) IS NULL OR VALUES(grupo) = '', grupo, VALUES(grupo))`,
    [pin, nombre, privilegio, tarjeta, grupo, origen],
  );
  if (!resultado.insertId) {
    throw new Error(`No se pudo resolver el colaborador ${pin}`);
  }
  return resultado.insertId;
}

export async function ingerirMarcaciones(
  dispositivoId: number,
  sn: string,
  registros: MarcacionCruda[],
): Promise<EstadisticasIngreso> {
  const stats: EstadisticasIngreso = {
    recibidas: registros.length,
    insertadas: 0,
    duplicadas: 0,
    ignoradas: 0,
  };
  if (registros.length === 0) return stats;

  const nuevas: MarcaNueva[] = [];
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    for (const registro of registros) {
      if (esFechaFutura(registro.fechaHora, TOLERANCIA_FUTURO_MINUTOS)) {
        stats.ignoradas += 1;
        continue;
      }
      const empleadoId = await asegurarEmpleado(
        conexion,
        registro.pin,
        `Empleado ${registro.pin}`,
        'marcacion',
        0,
        null,
        null,
      );
      const [resultado] = await conexion.query<ResultSetHeader>(
        `INSERT IGNORE INTO asist_marcaciones
          (dispositivo_id, empleado_id, pin, fecha_hora, tipo_evento, metodo_verificacion, codigo_trabajo)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          dispositivoId,
          empleadoId,
          registro.pin,
          registro.fechaHora,
          registro.tipoEvento,
          registro.metodoVerificacion,
          registro.codigoTrabajo,
        ],
      );
      if (resultado.affectedRows === 1) {
        stats.insertadas += 1;
        if (resultado.insertId > 0) {
          nuevas.push({
            id: resultado.insertId,
            empleadoId,
            pin: registro.pin,
            fechaHora: registro.fechaHora,
            tipoEvento: registro.tipoEvento,
          });
        }
      } else stats.duplicadas += 1;
    }
    await conexion.commit();
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }

  if (nuevas.length > 0) {
    void procesarMarcacionesNuevas(sn, nuevas).catch((error: unknown) => {
      logger.error('La marcacion quedo guardada, pero el calculo de asistencia fallo', error);
    });
  }
  return stats;
}

export async function ingerirUsuarios(
  usuarios: UsuarioCrudo[],
  origen: Exclude<OrigenEmpleado, 'manual' | 'marcacion'>,
): Promise<EstadisticasIngreso> {
  const stats: EstadisticasIngreso = {
    recibidas: usuarios.length,
    insertadas: 0,
    duplicadas: 0,
    ignoradas: 0,
  };
  for (const usuario of usuarios) {
    const [antes] = await pool.query<IdFila[]>(
      'SELECT id FROM asist_empleados WHERE pin = ? LIMIT 1',
      [usuario.pin],
    );
    await asegurarEmpleado(pool, usuario.pin, usuario.nombre, origen, usuario.privilegio, usuario.tarjeta, usuario.grupo);
    if (antes.length === 0) stats.insertadas += 1;
    else stats.duplicadas += 1;
  }
  return stats;
}

interface ComandoFila extends RowDataPacket {
  id: number;
  comando: string;
}

export async function tomarComandosPendientes(dispositivoId: number): Promise<ComandoFila[]> {
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const [filas] = await conexion.query<ComandoFila[]>(
      `SELECT id, comando
       FROM asist_comandos
       WHERE dispositivo_id = ?
         AND (
           estado = 'pendiente'
           OR (
             estado = 'enviado'
             AND enviado_en < DATE_SUB(NOW(), INTERVAL 3 MINUTE)
             AND intentos < ?
           )
         )
       ORDER BY id ASC
       LIMIT ${MAX_COMANDOS_POR_SONDEO}
       FOR UPDATE`,
      [dispositivoId, REINTENTOS_COMANDO],
    );

    if (filas.length > 0) {
      const ids = filas.map((fila) => fila.id);
      await conexion.query(
        `UPDATE asist_comandos
         SET estado = 'enviado',
             intentos = intentos + 1,
             enviado_en = NOW()
         WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids,
      );
    }
    await conexion.commit();
    return filas;
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

export async function confirmarComandos(dispositivoId: number, resultados: ResultadoComando[]): Promise<void> {
  for (const resultado of resultados) {
    const ejecutado = resultado.retorno === '' || resultado.retorno === '0';
    await pool.query(
      `UPDATE asist_comandos
       SET estado = ?,
           retorno = ?,
           ejecutado_en = NOW()
       WHERE id = ? AND dispositivo_id = ?`,
      [ejecutado ? 'ejecutado' : 'error', resultado.retorno || null, resultado.id, dispositivoId],
    );
  }
}

export async function encolarComando(dispositivoId: number, comando: string): Promise<number> {
  const [resultado] = await pool.query<ResultSetHeader>(
    `INSERT INTO asist_comandos (dispositivo_id, comando, estado)
     VALUES (?, ?, 'pendiente')`,
    [dispositivoId, comando],
  );
  return resultado.insertId;
}

export async function buscarDispositivoPorSn(sn: string): Promise<number | null> {
  const [filas] = await pool.query<IdFila[]>(
    'SELECT id FROM asist_dispositivos WHERE sn = ? LIMIT 1',
    [sn],
  );
  return filas[0]?.id ?? null;
}

export async function existeDispositivo(id: number): Promise<boolean> {
  const [filas] = await pool.query<IdFila[]>(
    'SELECT id FROM asist_dispositivos WHERE id = ? LIMIT 1',
    [id],
  );
  return Boolean(filas[0]?.id);
}
