import '../config/zona';
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { env } from '../config/env';

function afirmarIdentificador(nombre: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(nombre)) {
    throw new Error(`Nombre de base invalido: ${nombre}`);
  }
  return nombre;
}

async function main(): Promise<void> {
  const base = afirmarIdentificador(env.db.database);
  const esquema = fs.readFileSync(path.resolve(__dirname, '../../sql/schema.sql'), 'utf8');
  const conexion = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    multipleStatements: true,
    timezone: '-05:00',
    charset: 'utf8mb4',
    connectTimeout: 10000,
  });

  try {
    try {
      await conexion.query(
        `CREATE DATABASE IF NOT EXISTS \`${base}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      console.warn(`No se pudo crear la base (se intentara usarla igual): ${mensaje}`);
    }
    await conexion.query(`USE \`${base}\``);
    await conexion.query("SET time_zone = '-05:00'");
    await conexion.query(esquema);
    console.log(`Esquema aplicado en '${base}' con zona de sesion -05:00 (America/Lima).`);
  } finally {
    await conexion.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
