import { Router } from 'express';
import { autenticar, buscarSesion, cerrarSesion, normalizarUsuario } from '../services/auth.service';
import { asyncHandler, HttpError, ipCliente } from '../utils/http';
import { logger } from '../utils/logger';

const INTENTOS_MAXIMOS = 10;
const VENTANA_MS = 15 * 60 * 1000;
const intentos = new Map<string, { cantidad: number; reinicia: number }>();

function limitado(ip: string): boolean {
  const ahora = Date.now();
  const registro = intentos.get(ip);
  if (!registro || registro.reinicia < ahora) return false;
  return registro.cantidad >= INTENTOS_MAXIMOS;
}

function anotarFallo(ip: string): void {
  const ahora = Date.now();
  const registro = intentos.get(ip);
  if (!registro || registro.reinicia < ahora) {
    intentos.set(ip, { cantidad: 1, reinicia: ahora + VENTANA_MS });
    return;
  }
  registro.cantidad += 1;
}

function limpiarFallos(ip: string): void {
  intentos.delete(ip);
}

function tokenDe(req: { header: (nombre: string) => string | undefined }): string {
  const autorizacion = req.header('authorization') ?? '';
  return /^Bearer\s+(\S+)$/i.exec(autorizacion)?.[1] ?? '';
}

export const authRouter = Router();

authRouter.post('/login', asyncHandler(async (req, res) => {
  const ip = ipCliente(req);
  if (limitado(ip)) {
    throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.');
  }

  const cuerpo = req.body as { usuario?: unknown; contrasena?: unknown };
  const usuario = typeof cuerpo?.usuario === 'string' ? normalizarUsuario(cuerpo.usuario) : '';
  const contrasena = typeof cuerpo?.contrasena === 'string' ? cuerpo.contrasena : '';
  if (!/^[a-z0-9._-]{3,60}$/.test(usuario) || contrasena.length < 8 || contrasena.length > 128) {
    anotarFallo(ip);
    throw new HttpError(401, 'Usuario o contraseña incorrectos');
  }

  const sesion = await autenticar(usuario, contrasena);
  if (!sesion) {
    anotarFallo(ip);
    logger.info('Ingreso rechazado', { usuario, ip });
    throw new HttpError(401, 'Usuario o contraseña incorrectos');
  }

  limpiarFallos(ip);
  logger.info('Ingreso al panel', { usuario: sesion.usuario.usuario, ip });
  res.json({ datos: { token: sesion.token, expira_en: sesion.expiraEn, usuario: sesion.usuario } });
}));

authRouter.post('/logout', asyncHandler(async (req, res) => {
  await cerrarSesion(tokenDe(req));
  res.json({ datos: { cerrada: true } });
}));

authRouter.get('/yo', asyncHandler(async (req, res) => {
  const sesion = await buscarSesion(tokenDe(req));
  if (!sesion) throw new HttpError(401, 'Sesión expirada');
  res.json({ datos: sesion });
}));
