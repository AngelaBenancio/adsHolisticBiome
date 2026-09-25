import type { NextFunction, Request, Response } from 'express';
import { HttpError, responderTextoPlano } from '../utils/http';
import { logger } from '../utils/logger';

function esCuerpoDemasiadoGrande(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'type' in error && (error as { type?: string }).type === 'entity.too.large';
}

export function manejadorErrores(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return;

  if (req.originalUrl.startsWith('/iclock') && esCuerpoDemasiadoGrande(error)) {
    logger.error('Cuerpo ADMS demasiado grande; se responde OK para no bloquear el reloj', {
      ruta: req.originalUrl,
    });
    responderTextoPlano(res, 'OK');
    return;
  }

  logger.error('Error de peticion', {
    metodo: req.method,
    ruta: req.originalUrl,
    error,
  });

  if (req.originalUrl.startsWith('/iclock')) {
    const estado = error instanceof HttpError ? error.status : 500;
    responderTextoPlano(res, 'ERROR', estado);
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  res.status(500).json({ error: 'Error interno del servidor' });
}
