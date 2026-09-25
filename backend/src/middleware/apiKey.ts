import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { buscarSesion } from '../services/auth.service';
import { compararSeguro, ipCliente, responderTextoPlano, textoConsulta } from '../utils/http';
import { logger } from '../utils/logger';

function claveMaquinaValida(valor: string): boolean {
  return Boolean(env.apiKey) && compararSeguro(valor, env.apiKey);
}

/**
 * El panel entra con el token de /api/auth/login.
 * X-API-Key sigue valiendo para llamadas de servidor a servidor.
 */
export function exigirAcceso(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.header('x-api-key')?.trim() ?? '';
  if (apiKey && claveMaquinaValida(apiKey)) {
    next();
    return;
  }

  const bearer = /^Bearer\s+(\S+)$/i.exec(req.header('authorization') ?? '')?.[1] ?? '';
  if (bearer && claveMaquinaValida(bearer)) {
    next();
    return;
  }
  if (!bearer) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }

  buscarSesion(bearer)
    .then((sesion) => {
      if (!sesion) {
        res.status(401).json({ error: 'Sesión expirada' });
        return;
      }
      next();
    })
    .catch(next);
}

/**
 * El protocolo ADMS no firma las peticiones. Si ADMS_COMM_KEY tiene valor,
 * el reloj debe enviarla en ?comkey= o ?token=. Vacia, el puerto queda abierto
 * y conviene filtrarlo en el firewall del VPS.
 */
export function exigirClaveAdmsSiEstaConfigurada(req: Request, res: Response, next: NextFunction): void {
  if (!env.admsCommKey) {
    next();
    return;
  }
  const recibida =
    textoConsulta(req.query.comkey) ||
    textoConsulta(req.query.token) ||
    (req.header('x-comm-key') ?? '').trim();
  if (!compararSeguro(recibida, env.admsCommKey)) {
    logger.adms('Clave ADMS rechazada', { ip: ipCliente(req), metodo: req.method, ruta: req.originalUrl });
    responderTextoPlano(res, 'ERROR', 401);
    return;
  }
  next();
}

/**
 * Puerta del receptor. Si ADMS_IP_ALLOWLIST tiene IPs, descarta el resto con 403.
 * Si ADMS_COMM_KEY tiene valor, exige ?comkey=, ?token= o X-Comm-Key y responde 401.
 */
export function exigirRecepcionAdms(req: Request, res: Response, next: NextFunction): void {
  const ip = ipCliente(req);
  if (env.admsIpAllowlist.length > 0 && !env.admsIpAllowlist.includes(ip)) {
    logger.adms('Conexion ADMS ignorada: IP fuera de la lista blanca', {
      ip,
      metodo: req.method,
      ruta: req.originalUrl,
    });
    responderTextoPlano(res, 'ERROR', 403);
    return;
  }
  exigirClaveAdmsSiEstaConfigurada(req, res, next);
}
