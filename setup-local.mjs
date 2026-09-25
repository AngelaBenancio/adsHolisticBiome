/**
 * Prepara el entorno local: .env, base MySQL, tablas asist_* y usuario del panel.
 * Desde la raíz del repositorio: node setup-local.mjs
 */
import { randomBytes, scrypt as scryptCb } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const backendDir = path.join(raiz, 'backend');
const frontendDir = path.join(raiz, 'frontend');

const USUARIO_PANEL_LOCAL = 'admin';
const CLAVE_PANEL_LOCAL = 'local-dev-1';

class FalloLocal extends Error {}

function requireMysql() {
  try {
    const requerir = createRequire(path.join(backendDir, 'package.json'));
    return requerir('mysql2/promise');
  } catch {
    throw new FalloLocal(
      'No está instalado mysql2 en backend. Desde backend ejecuta npm install y vuelve a lanzar node setup-local.mjs.',
    );
  }
}

function leerTexto(archivo) {
  return fs.readFileSync(archivo, 'utf8');
}

function parsearEnv(texto) {
  const valores = {};
  for (const linea of texto.split(/\r?\n/)) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith('#')) continue;
    const separador = limpia.indexOf('=');
    if (separador <= 0) continue;
    const clave = limpia.slice(0, separador).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(clave)) continue;
    valores[clave] = limpia.slice(separador + 1).trim();
  }
  return valores;
}

function aplicarValores(ejemplo, cambios) {
  const usadas = new Set();
  const lineas = ejemplo.split(/\r?\n/).map((linea) => {
    const coincidencia = linea.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*)=(.*)$/);
    if (!coincidencia || !Object.prototype.hasOwnProperty.call(cambios, coincidencia[2])) {
      return linea;
    }
    usadas.add(coincidencia[2]);
    return `${coincidencia[1]}${coincidencia[2]}${coincidencia[3]}=${cambios[coincidencia[2]]}`;
  });
  for (const [clave, valor] of Object.entries(cambios)) {
    if (!usadas.has(clave)) lineas.push(`${clave}=${valor}`);
  }
  const texto = lineas.join('\n');
  return texto.endsWith('\n') ? texto : `${texto}\n`;
}

function asegurarEnv(directorio, cambios) {
  const destino = path.join(directorio, '.env');
  const ejemplo = path.join(directorio, '.env.example');
  if (fs.existsSync(destino)) {
    return { creado: false, valores: parsearEnv(leerTexto(destino)) };
  }
  if (!fs.existsSync(ejemplo)) {
    throw new FalloLocal(`Falta ${ejemplo}`);
  }
  const contenido = aplicarValores(leerTexto(ejemplo), cambios);
  fs.writeFileSync(destino, contenido, 'utf8');
  return { creado: true, valores: parsearEnv(contenido) };
}

function identificador(nombre, etiqueta) {
  if (!/^[A-Za-z0-9_]+$/.test(nombre)) {
    throw new FalloLocal(`${etiqueta} no es un identificador válido: ${nombre}`);
  }
  return nombre;
}

function credencialesDe(valores) {
  const puerto = Number(valores.DB_PORT || 3306);
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
    throw new FalloLocal('DB_PORT debe ser un entero entre 1 y 65535');
  }
  const usuario = (valores.DB_USER || '').trim();
  const base = (valores.DB_NAME || '').trim();
  if (!usuario) throw new FalloLocal('backend/.env no trae DB_USER');
  if (!base) throw new FalloLocal('backend/.env no trae DB_NAME');
  return {
    host: (valores.DB_HOST || '127.0.0.1').trim(),
    port: puerto,
    user: usuario,
    password: valores.DB_PASSWORD ?? '',
    database: identificador(base, 'DB_NAME'),
  };
}

function esFalloDeRed(error) {
  return ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'EAI_AGAIN'].includes(error?.code);
}

function esAccesoDenegado(error) {
  return error?.code === 'ER_ACCESS_DENIED_ERROR' || error?.errno === 1045;
}

async function abrir(mysql, credencial) {
  return mysql.createConnection({
    host: credencial.host,
    port: credencial.port,
    user: credencial.user,
    password: credencial.password,
    multipleStatements: true,
    timezone: '-05:00',
    charset: 'utf8mb4',
    connectTimeout: 8000,
  });
}

async function conectar(mysql, aplicacion) {
  const intentos = [aplicacion];
  const yaEsRootLocal = aplicacion.user === 'root' && aplicacion.password === '';
  if (!yaEsRootLocal) {
    intentos.push({
      host: aplicacion.host,
      port: aplicacion.port,
      user: 'root',
      password: '',
      database: aplicacion.database,
    });
  }

  let ultimo = null;
  let huboRed = false;
  let huboAcceso = false;
  for (const credencial of intentos) {
    try {
      const conexion = await abrir(mysql, credencial);
      return { conexion, credencial };
    } catch (error) {
      ultimo = error;
      huboRed = huboRed || esFalloDeRed(error);
      huboAcceso = huboAcceso || esAccesoDenegado(error);
    }
  }

  const donde = `${aplicacion.host}:${aplicacion.port}`;
  if (huboRed && !huboAcceso) {
    throw new FalloLocal(
      `No hay un MySQL escuchando en ${donde}. Inícialo y vuelve a ejecutar node setup-local.mjs.`,
    );
  }
  if (huboAcceso) {
    throw new FalloLocal(
      `MySQL en ${donde} rechazó el usuario de backend/.env y también root sin contraseña. Ajusta DB_USER y DB_PASSWORD, y vuelve a ejecutar node setup-local.mjs.`,
    );
  }
  throw new FalloLocal(ultimo instanceof Error ? ultimo.message : 'No se pudo conectar a MySQL');
}

function literalSql(valor) {
  return `'${String(valor).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

async function asegurarCuentaAplicacion(conexion, aplicacion) {
  if (!/^[A-Za-z0-9._-]+$/.test(aplicacion.user)) {
    throw new FalloLocal(`DB_USER no se puede crear de forma segura: ${aplicacion.user}`);
  }
  const base = aplicacion.database;
  for (const host of ['127.0.0.1', 'localhost']) {
    const cuenta = `${literalSql(aplicacion.user)}@${literalSql(host)}`;
    const clave = literalSql(aplicacion.password);
    await conexion.query(`CREATE USER IF NOT EXISTS ${cuenta} IDENTIFIED BY ${clave}`);
    await conexion.query(`ALTER USER ${cuenta} IDENTIFIED BY ${clave}`);
    await conexion.query(`GRANT ALL PRIVILEGES ON \`${base}\`.* TO ${cuenta}`);
  }
  await conexion.query('FLUSH PRIVILEGES');
}

async function baseExiste(conexion, nombre) {
  const [filas] = await conexion.query(
    'SELECT SCHEMA_NAME AS nombre FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
    [nombre],
  );
  return filas.length > 0;
}

async function aplicarEsquema(conexion, base) {
  const yaExistia = await baseExiste(conexion, base);
  await conexion.query(
    `CREATE DATABASE IF NOT EXISTS \`${base}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await conexion.query(`USE \`${base}\``);
  await conexion.query("SET time_zone = '-05:00'");
  const esquema = leerTexto(path.join(backendDir, 'sql', 'schema.sql'));
  await conexion.query(esquema);
  const [filas] = await conexion.query(
    `SELECT TABLE_NAME AS nombre
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ?`,
    [base],
  );
  const tablas = filas.map((fila) => String(fila.nombre)).filter((nombre) => nombre.startsWith('asist_'));
  return { yaExistia, tablas };
}

async function hashClave(clave) {
  const sal = randomBytes(16).toString('hex');
  const derivado = await scrypt(clave, sal, 64);
  return `${sal}:${derivado.toString('hex')}`;
}

function claveApiInvalida(valor) {
  const clave = (valor ?? '').trim();
  return clave.length < 16 || clave.includes('cambia-esta') || clave.includes('reemplaza-por-una');
}

async function asegurarAdmin(conexion, valores) {
  const [conteo] = await conexion.query('SELECT COUNT(*) AS total FROM asist_usuarios');
  const total = Number(conteo[0]?.total ?? 0);
  if (total > 0) {
    return { creado: false, usuario: (valores.ADMIN_USUARIO || '').trim() || USUARIO_PANEL_LOCAL };
  }

  const usuario = (valores.ADMIN_USUARIO || '').trim().toLowerCase();
  const clave = valores.ADMIN_PASSWORD ?? '';
  const nombre = (valores.ADMIN_NOMBRE || 'Administrador').trim().slice(0, 120) || 'Administrador';
  if (!/^[a-z0-9._-]{3,60}$/.test(usuario) || clave.length < 8 || clave.length > 128) {
    throw new FalloLocal(
      'Las tablas quedaron creadas, pero no hay usuario de panel. Define ADMIN_USUARIO y ADMIN_PASSWORD (mínimo 8 caracteres) en backend/.env y vuelve a ejecutar node setup-local.mjs.',
    );
  }

  const claveHash = await hashClave(clave);
  await conexion.query(
    'INSERT INTO asist_usuarios (usuario, nombre, clave_hash, activo) VALUES (?, ?, ?, 1)',
    [usuario, nombre, claveHash],
  );
  return { creado: true, usuario, clave };
}

function anotar(texto) {
  console.log(`  ${texto}`);
}

function resumen(acceso) {
  console.log('');
  console.log('Entorno local listo.');
  if (acceso) {
    console.log(`  Panel     usuario ${acceso.usuario} / ${acceso.clave}`);
  }
  console.log('');
  console.log('Arranca los servidores en dos terminales:');
  console.log('');
  console.log('  cd backend');
  console.log('  npm run dev');
  console.log('');
  console.log('  cd frontend');
  console.log('  npm run dev');
  console.log('');
  console.log('  Panel  http://127.0.0.1:5173');
  console.log('  API    http://127.0.0.1:8088/health');
  console.log('');
}

async function main() {
  const mysql = requireMysql();
  console.log('');

  const frontend = asegurarEnv(frontendDir, { VITE_API_URL: '' });
  anotar(frontend.creado
    ? 'Frontend  .env creado. VITE_API_URL vacía: npm run dev usa el proxy hacia el puerto 8088.'
    : 'Frontend  .env ya existía. No se modificó.');

  const apiKey = randomBytes(24).toString('hex');
  const backend = asegurarEnv(backendDir, {
    DB_HOST: '127.0.0.1',
    DB_PORT: '3306',
    DB_USER: 'root',
    DB_PASSWORD: '',
    DB_NAME: 'asistencias',
    API_KEY: apiKey,
    ADMIN_USUARIO: USUARIO_PANEL_LOCAL,
    ADMIN_PASSWORD: CLAVE_PANEL_LOCAL,
    ADMIN_NOMBRE: 'Administrador',
    CORS_ORIGIN: '*',
  });
  anotar(backend.creado
    ? 'Backend   .env creado con root sin contraseña, base asistencias y una API_KEY local.'
    : 'Backend   .env ya existía. No se modificó.');

  if (claveApiInvalida(backend.valores.API_KEY)) {
    throw new FalloLocal(
      'backend/.env tiene una API_KEY vacía o de ejemplo. Pon al menos 16 caracteres propios y vuelve a ejecutar node setup-local.mjs.',
    );
  }

  const aplicacion = credencialesDe(backend.valores);
  const { conexion, credencial } = await conectar(mysql, aplicacion);
  const mismaCuenta = credencial.user === aplicacion.user && credencial.password === aplicacion.password;
  let privilegiada = mismaCuenta ? null : conexion;
  let operativa = mismaCuenta ? conexion : null;
  try {
    if (!mismaCuenta) {
      await privilegiada.query(
        `CREATE DATABASE IF NOT EXISTS \`${aplicacion.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
      await asegurarCuentaAplicacion(privilegiada, aplicacion);
      operativa = await abrir(mysql, aplicacion);
    }

    const esquema = await aplicarEsquema(operativa, aplicacion.database);
    const admin = await asegurarAdmin(operativa, backend.valores);
    const origen = mismaCuenta ? credencial.user : `root, y el servidor entra como ${aplicacion.user}`;
    anotar(`MySQL     ${aplicacion.host}:${aplicacion.port} como ${origen}. Base ${aplicacion.database} ${esquema.yaExistia ? 'ya existía' : 'creada'}.`);
    if (!mismaCuenta) {
      anotar(`MySQL     cuenta ${aplicacion.user} con permisos sobre ${aplicacion.database}.`);
    }
    anotar(`Tablas    ${esquema.tablas.length} asist_* (${esquema.tablas.join(', ')})`);
    anotar(admin.creado
      ? 'Admin     usuario de panel creado. La clave queda abajo y en backend/.env.'
      : 'Admin     asist_usuarios ya tenía registros. No se cambió ninguna clave.');
    resumen(admin.creado ? { usuario: admin.usuario, clave: admin.clave } : null);
  } finally {
    await operativa?.end().catch(() => {});
    await privilegiada?.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error('');
  if (error instanceof FalloLocal) {
    console.error(error.message);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  console.error('');
  process.exit(1);
});
