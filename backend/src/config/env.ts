import './zona';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function texto(nombre: string, valorPorDefecto?: string): string {
  const valor = process.env[nombre];
  if (valor === undefined || valor.trim() === '') {
    if (valorPorDefecto !== undefined) return valorPorDefecto;
    throw new Error(`Falta la variable de entorno obligatoria ${nombre}`);
  }
  return valor.trim();
}

function entero(nombre: string, valorPorDefecto: number): number {
  const crudo = process.env[nombre];
  if (crudo === undefined || crudo.trim() === '') return valorPorDefecto;
  const numero = Number(crudo);
  if (!Number.isInteger(numero)) {
    throw new Error(`La variable ${nombre} debe ser un entero`);
  }
  return numero;
}

function bandera(nombre: string, valorPorDefecto: boolean): boolean {
  const crudo = process.env[nombre];
  if (crudo === undefined || crudo.trim() === '') return valorPorDefecto;
  const normalizado = crudo.trim().toLowerCase();
  if (['1', 'true', 'si', 'sí', 'yes'].includes(normalizado)) return true;
  if (['0', 'false', 'no'].includes(normalizado)) return false;
  throw new Error(`La variable ${nombre} debe ser true o false`);
}

const puerto = entero('PORT', 8088);
if (puerto < 1 || puerto > 65535) {
  throw new Error('PORT fuera de rango');
}

const limiteConexiones = entero('DB_CONNECTION_LIMIT', 10);
if (limiteConexiones < 1 || limiteConexiones > 50) {
  throw new Error('DB_CONNECTION_LIMIT debe estar entre 1 y 50');
}

function esDireccionIp(valor: string): boolean {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(valor)) {
    return valor.split('.').every((octeto) => Number(octeto) <= 255);
  }
  return valor.includes(':') && /^[0-9a-fA-F:]+$/.test(valor);
}

function listaIps(nombre: string): string[] {
  const crudo = process.env[nombre];
  if (crudo === undefined || crudo.trim() === '') return [];
  return crudo.split(',').map((ip) => ip.trim()).filter(Boolean).map((ip) => {
    if (!esDireccionIp(ip)) throw new Error(`La variable ${nombre} contiene una IP invalida: ${ip}`);
    return ip;
  });
}

const cierreCron = texto('CIERRE_CRON', '59 23 * * *');
if (!/^[\d*,/\- ]+$/.test(cierreCron) || cierreCron.split(/\s+/).length < 5) {
  throw new Error('CIERRE_CRON debe ser una expresion cron de 5 campos');
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: puerto,
  trustProxy: bandera('TRUST_PROXY', false),
  apiKey: process.env.API_KEY?.trim() ?? '',
  corsOrigin: texto('CORS_ORIGIN', '*'),
  admsCommKey: process.env.ADMS_COMM_KEY?.trim() ?? '',
  admsIpAllowlist: listaIps('ADMS_IP_ALLOWLIST'),
  admsBodyLimit: texto('ADMS_BODY_LIMIT', '20mb'),
  cierreCron,
  cierreAutomatico: bandera('CIERRE_AUTOMATICO', true),
  adminUsuario: process.env.ADMIN_USUARIO?.trim().toLowerCase() ?? '',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  adminNombre: process.env.ADMIN_NOMBRE?.trim() || 'Administrador',
  db: {
    host: texto('DB_HOST', '127.0.0.1'),
    port: entero('DB_PORT', 3306),
    user: texto('DB_USER'),
    password: process.env.DB_PASSWORD ?? '',
    database: texto('DB_NAME'),
    connectionLimit: limiteConexiones,
  },
};

/** La clave de la API solo es obligatoria al servir HTTP, no al crear tablas. */
export function afirmarApiKey(): void {
  if (env.apiKey.length < 16 || env.apiKey.includes('cambia-esta') || env.apiKey.includes('reemplaza-por-una')) {
    throw new Error('Define API_KEY con al menos 16 caracteres y no uses el valor de .env.example');
  }
}
