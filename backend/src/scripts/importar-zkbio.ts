import '../config/zona';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../config/database';
import { asegurarDia } from '../services/calculo.service';
import { enumerarDias, normalizarFechaHora, sumarDias } from '../utils/datetime';

const RE_PIN = /^[A-Za-z0-9_-]{1,32}$/;
const RE_SN = /^[A-Za-z0-9_-]{1,64}$/;
const CARPETA_DEFECTO = path.join(os.homedir(), 'Downloads', 'Datos del Huellero');

interface EmpleadoCsv {
  pin: string;
  nombre: string;
  fechaIngreso: string | null;
  activo: boolean;
}

interface MarcaCsv {
  idOriginal: string;
  pin: string;
  fechaHora: string;
  sn: string;
}

function uso(): string {
  return [
    'Uso: npm run db:import -- [--empleados ruta.csv] [--marcas ruta.csv]',
    'También sirven IMPORT_DIR, IMPORT_EMPLEADOS e IMPORT_MARCAS.',
    `Por defecto lee ${CARPETA_DEFECTO}.`,
  ].join('\n');
}

function argumento(nombre: string): string | undefined {
  const indice = process.argv.indexOf(`--${nombre}`);
  if (indice === -1) return undefined;
  const valor = process.argv[indice + 1];
  if (!valor || valor.startsWith('--')) throw new Error(`Falta el valor de --${nombre}\n${uso()}`);
  return valor;
}

function resolverRutas(): { empleados: string; marcas: string } {
  const directorio = process.env.IMPORT_DIR?.trim() || CARPETA_DEFECTO;
  const empleados = argumento('empleados') || process.env.IMPORT_EMPLEADOS?.trim() || path.join(directorio, 'empleados.csv');
  const marcas = argumento('marcas') || process.env.IMPORT_MARCAS?.trim() || path.join(directorio, 'marcas-lima.csv');
  return { empleados, marcas };
}

function parsearCsv(texto: string): Array<Record<string, string>> {
  const limpio = texto.replace(/^\uFEFF/, '');
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let comillas = false;

  for (let i = 0; i < limpio.length; i += 1) {
    const caracter = limpio[i] ?? '';
    if (comillas) {
      if (caracter === '"') {
        if (limpio[i + 1] === '"') {
          campo += '"';
          i += 1;
        } else comillas = false;
      } else campo += caracter;
      continue;
    }
    if (caracter === '"') {
      comillas = true;
      continue;
    }
    if (caracter === ',') {
      fila.push(campo);
      campo = '';
      continue;
    }
    if (caracter === '\n' || caracter === '\r') {
      if (caracter === '\r' && limpio[i + 1] === '\n') i += 1;
      fila.push(campo);
      if (fila.some((valor) => valor.trim() !== '')) filas.push(fila);
      fila = [];
      campo = '';
      continue;
    }
    campo += caracter;
  }
  if (campo.length > 0 || fila.length > 0) {
    fila.push(campo);
    if (fila.some((valor) => valor.trim() !== '')) filas.push(fila);
  }
  if (filas.length === 0) return [];

  const encabezados = filas[0]?.map((columna) => columna.trim().toLowerCase()) ?? [];
  return filas.slice(1).map((columnas) => {
    const registro: Record<string, string> = {};
    encabezados.forEach((clave, indice) => {
      registro[clave] = (columnas[indice] ?? '').trim();
    });
    return registro;
  });
}

function leerTabla(ruta: string): Array<Record<string, string>> {
  if (!fs.existsSync(ruta)) throw new Error(`No existe el archivo ${ruta}`);
  return parsearCsv(fs.readFileSync(ruta, 'utf8'));
}

function activoDe(fila: Record<string, string>): boolean {
  const marca = (fila.is_active ?? '').trim().toLowerCase();
  if (['t', 'true', '1', 'si', 'sí', 'yes', 'y'].includes(marca)) return true;
  if (['f', 'false', '0', 'no', 'n'].includes(marca)) return false;
  return (fila.status ?? '').trim() === '0';
}

function fechaIngresoDe(valor: string): string | null {
  if (!valor) return null;
  return normalizarFechaHora(`${valor} 12:00:00`) ? valor : null;
}

function empleadosDesde(filas: Array<Record<string, string>>): { validos: EmpleadoCsv[]; ignorados: number } {
  const validos: EmpleadoCsv[] = [];
  let ignorados = 0;
  for (const fila of filas) {
    const pin = fila.emp_code ?? '';
    const nombre = `${fila.first_name ?? ''} ${fila.last_name ?? ''}`.replace(/\s+/g, ' ').trim();
    if (!RE_PIN.test(pin) || !nombre) {
      ignorados += 1;
      continue;
    }
    validos.push({
      pin,
      nombre: nombre.slice(0, 150),
      fechaIngreso: fechaIngresoDe(fila.hire_date ?? ''),
      activo: activoDe(fila),
    });
  }
  return { validos, ignorados };
}

function marcasDesde(filas: Array<Record<string, string>>): { validas: MarcaCsv[]; ignoradas: number } {
  const validas: MarcaCsv[] = [];
  let ignoradas = 0;
  for (const fila of filas) {
    const pin = fila.emp_code ?? '';
    const sn = fila.terminal_sn ?? '';
    const fechaHora = normalizarFechaHora(`${fila.fecha_lima ?? ''} ${fila.hora_lima ?? ''}`);
    if (!RE_PIN.test(pin) || !RE_SN.test(sn) || !fechaHora) {
      ignoradas += 1;
      continue;
    }
    validas.push({
      idOriginal: fila.id ?? '',
      pin,
      fechaHora,
      sn,
    });
  }
  return { validas, ignoradas };
}

async function asegurarColumnaIngreso(): Promise<void> {
  const [filas] = await pool.query<Array<RowDataPacket & { total: number }>>(
    `SELECT COUNT(*) AS total
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'asist_empleados'
       AND COLUMN_NAME = 'fecha_ingreso'`,
  );
  if (Number(filas[0]?.total ?? 0) > 0) return;
  await pool.query('ALTER TABLE asist_empleados ADD COLUMN fecha_ingreso DATE NULL AFTER activo');
}

async function guardarEmpleados(empleados: EmpleadoCsv[]): Promise<{ insertados: number; actualizados: number }> {
  let insertados = 0;
  let actualizados = 0;
  for (const empleado of empleados) {
    const yaExistia = await empleadoIdDe(empleado.pin);
    await pool.query(
      `INSERT INTO asist_empleados (pin, nombre, activo, fecha_ingreso, origen)
       VALUES (?, ?, ?, ?, 'manual')
       ON DUPLICATE KEY UPDATE
         nombre = VALUES(nombre),
         activo = VALUES(activo),
         fecha_ingreso = COALESCE(VALUES(fecha_ingreso), fecha_ingreso),
         origen = IF(origen = 'marcacion', 'manual', origen)`,
      [empleado.pin, empleado.nombre, empleado.activo ? 1 : 0, empleado.fechaIngreso],
    );
    if (yaExistia) actualizados += 1;
    else insertados += 1;
  }
  return { insertados, actualizados };
}

async function dispositivoDe(sn: string): Promise<number> {
  const [resultado] = await pool.query<ResultSetHeader>(
    `INSERT INTO asist_dispositivos (sn, alias)
     VALUES (?, 'ZKBio Time')
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [sn],
  );
  if (!resultado.insertId) throw new Error(`No se pudo resolver el reloj ${sn}`);
  return resultado.insertId;
}

async function empleadoIdDe(pin: string): Promise<number | null> {
  const [filas] = await pool.query<Array<RowDataPacket & { id: number }>>(
    'SELECT id FROM asist_empleados WHERE pin = ? LIMIT 1',
    [pin],
  );
  return filas[0] ? Number(filas[0].id) : null;
}

async function guardarMarcaciones(marcas: MarcaCsv[]): Promise<{ insertadas: number; duplicadas: number; sinEmpleado: number }> {
  let insertadas = 0;
  let duplicadas = 0;
  let sinEmpleado = 0;
  const dispositivos = new Map<string, number>();
  const vistos = new Set<string>();

  for (const marca of marcas) {
    const clave = `${marca.sn}|${marca.pin}|${marca.fechaHora}|${marca.idOriginal}`;
    if (vistos.has(clave)) {
      duplicadas += 1;
      continue;
    }
    vistos.add(clave);

    const empleadoId = await empleadoIdDe(marca.pin);
    if (!empleadoId) {
      sinEmpleado += 1;
      continue;
    }
    let dispositivoId = dispositivos.get(marca.sn);
    if (!dispositivoId) {
      dispositivoId = await dispositivoDe(marca.sn);
      dispositivos.set(marca.sn, dispositivoId);
    }
    const [resultado] = await pool.query<ResultSetHeader>(
      `INSERT IGNORE INTO asist_marcaciones
        (dispositivo_id, empleado_id, pin, fecha_hora, tipo_evento, metodo_verificacion)
       VALUES (?, ?, ?, ?, 0, 0)`,
      [dispositivoId, empleadoId, marca.pin, marca.fechaHora],
    );
    if (resultado.affectedRows === 1) insertadas += 1;
    else duplicadas += 1;
  }
  return { insertadas, duplicadas, sinEmpleado };
}

async function recalcular(marcas: MarcaCsv[]): Promise<string | null> {
  if (marcas.length === 0) return null;
  const fechas = marcas.map((marca) => marca.fechaHora.slice(0, 10)).sort();
  const desde = fechas[0];
  const hasta = fechas[fechas.length - 1];
  if (!desde || !hasta) return null;
  let cursor = desde;
  while (cursor <= hasta) {
    const fin = sumarDias(cursor, 59);
    const limite = fin < hasta ? fin : hasta;
    for (const dia of enumerarDias(cursor, limite, 60)) {
      await asegurarDia(dia);
    }
    cursor = sumarDias(limite, 1);
  }
  return `${desde} a ${hasta}`;
}

async function main(): Promise<void> {
  const rutas = resolverRutas();
  console.log(`Empleados: ${rutas.empleados}`);
  console.log(`Marcaciones: ${rutas.marcas}`);

  await asegurarColumnaIngreso();
  const empleados = empleadosDesde(leerTabla(rutas.empleados));
  const marcas = marcasDesde(leerTabla(rutas.marcas));
  const guardados = await guardarEmpleados(empleados.validos);
  const punches = await guardarMarcaciones(marcas.validas);
  const rango = await recalcular(marcas.validas);

  console.log(`Empleados importados: ${guardados.insertados} nuevos, ${guardados.actualizados} actualizados, ${empleados.ignorados} filas ignoradas.`);
  console.log(`Marcaciones importadas: ${punches.insertadas} nuevas, ${punches.duplicadas} duplicadas, ${marcas.ignoradas + punches.sinEmpleado} filas ignoradas.`);
  if (rango) console.log(`Asistencia recalculada del ${rango}, sin reenviar webhooks.`);
  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
