import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, mensaje: string) {
    super(mensaje);
    this.name = 'HttpError';
    this.status = status;
  }
}

type Controlador = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export function asyncHandler(controlador: Controlador) {
  return (req: Request, res: Response, next: NextFunction): void => {
    controlador(req, res, next).catch(next);
  };
}

/**
 * El firmware ZKTeco corta la respuesta si Express la envia en trozos
 * (Transfer-Encoding: chunked). Content-Length + end() evita ese corte.
 * El tipo es exactamente text/plain, sin charset agregado por res.send().
 */
export function responderTextoPlano(respuesta: Response, cuerpo: string, estado = 200): void {
  const texto = cuerpo.endsWith('\n') ? cuerpo : `${cuerpo}\n`;
  respuesta.status(estado);
  respuesta.setHeader('Content-Type', 'text/plain');
  respuesta.setHeader('Content-Length', Buffer.byteLength(texto));
  respuesta.end(texto);
}

export function textoConsulta(valor: unknown): string {
  if (typeof valor === 'string') return valor.trim();
  if (Array.isArray(valor)) return textoConsulta(valor[0]);
  return '';
}

export function cuerpoTexto(body: unknown): string {
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  return '';
}

/** Usa req.ip. Con TRUST_PROXY, Express ya resolvio el salto del proxy. */
export function ipCliente(req: Request): string {
  const ip = req.ip ?? req.socket.remoteAddress ?? '';
  return ip.replace(/^::ffff:/, '').slice(0, 45);
}

export function compararSeguro(recibida: string, esperada: string): boolean {
  const izquierda = Buffer.from(recibida);
  const derecha = Buffer.from(esperada);
  if (izquierda.length !== derecha.length) {
    timingSafeEqual(derecha, derecha);
    return false;
  }
  return timingSafeEqual(izquierda, derecha);
}

export function leerSn(req: Request): string {
  return textoConsulta(req.query.SN) || textoConsulta(req.query.sn);
}

export function leerTabla(req: Request): string {
  return textoConsulta(req.query.table) || textoConsulta(req.query.Table);
}
