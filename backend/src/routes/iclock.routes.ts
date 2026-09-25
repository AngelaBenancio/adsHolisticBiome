import type { Request, Response } from 'express';
import { Router } from 'express';
import { exigirRecepcionAdms } from '../middleware/apiKey';
import { construirHandshake, formatearComandos } from '../protocolo/adms';
import {
  confirmarComandos,
  ingerirMarcaciones,
  ingerirUsuarios,
  registrarDispositivo,
  tomarComandosPendientes,
} from '../services/adms.service';
import { clasificarPaquete, parsearResultadosComando } from '../services/parser';
import { asyncHandler, cuerpoTexto, ipCliente, leerSn, leerTabla, responderTextoPlano, textoConsulta } from '../utils/http';
import { logger } from '../utils/logger';

const RE_SN = /^[A-Za-z0-9_-]{1,64}$/;

function datosDispositivo(req: Request, sn: string) {
  return {
    sn,
    ip: ipCliente(req),
    firmware: textoConsulta(req.query.fw) || undefined,
    pushVersion: textoConsulta(req.query.pushver) || textoConsulta(req.query.PushVersion) || undefined,
  };
}

async function tocarSilencioso(req: Request, sn: string): Promise<void> {
  try {
    await registrarDispositivo(datosDispositivo(req, sn));
  } catch (error) {
    logger.error('No se pudo actualizar la ultima conexion del reloj', error);
  }
}

/**
 * ADMS / Push SDK.
 * GET  /iclock/cdata        handshake (opciones, hora de Peru, Stamp=9999)
 * GET  /iclock/getrequest   comandos pendientes o OK
 * POST /iclock/cdata        ATTLOG, USER/USERINFO/BIODATA; BIOPHOTO y OPLOG se descartan
 * POST /iclock/devicecmd    acuse del reloj
 * Las rutas .php cubren firmware antiguo que apunta a un servidor PHP.
 */
export const iclockRouter = Router();

iclockRouter.use(exigirRecepcionAdms);

iclockRouter.get(['/cdata', '/cdata.php'], asyncHandler(async (req, res) => {
  const sn = leerSn(req);
  if (!RE_SN.test(sn)) {
    responderTextoPlano(res, 'ERROR', 400);
    return;
  }
  await registrarDispositivo(datosDispositivo(req, sn));
  logger.adms('Handshake', { sn, ip: ipCliente(req) });
  responderTextoPlano(res, construirHandshake(sn));
}));

iclockRouter.post(['/cdata', '/cdata.php'], asyncHandler(async (req, res) => {
  const sn = leerSn(req);
  if (!RE_SN.test(sn)) {
    responderTextoPlano(res, 'ERROR', 400);
    return;
  }

  const tabla = leerTabla(req);
  const cuerpo = cuerpoTexto(req.body);
  const paquete = clasificarPaquete(tabla, cuerpo);

  logger.adms('Trama recibida', {
    sn,
    tabla: tabla || null,
    bytes: Buffer.byteLength(cuerpo),
    clasificacion: paquete.tipo,
    motivo: paquete.tipo === 'descartado' ? paquete.motivo : undefined,
  });

  if (paquete.tipo === 'descartado' || paquete.tipo === 'vacio') {
    await tocarSilencioso(req, sn);
    responderTextoPlano(res, 'OK');
    return;
  }

  const dispositivoId = await registrarDispositivo({
    ...datosDispositivo(req, sn),
    ...(paquete.tipo === 'opciones' ? paquete.opciones : {}),
  });

  if (paquete.tipo === 'attlog') {
    if (paquete.registros.length === 0 && cuerpo.trim()) {
      logger.adms('ATTLOG sin filas reconocidas', {
        sn,
        vista: cuerpo.replace(/\s+/g, ' ').slice(0, 160),
      });
    }
    const stats = await ingerirMarcaciones(dispositivoId, sn, paquete.registros);
    logger.adms('Marcaciones procesadas', { sn, ...stats });
  } else if (paquete.tipo === 'usuarios') {
    const stats = await ingerirUsuarios(paquete.usuarios, paquete.origen);
    logger.adms('Colaboradores procesados', { sn, origen: paquete.origen, ...stats });
  }

  responderTextoPlano(res, 'OK');
}));

const entregarComandos = asyncHandler(async (req, res) => {
  const sn = leerSn(req);
  if (!RE_SN.test(sn)) {
    responderTextoPlano(res, 'ERROR', 400);
    return;
  }
  const dispositivoId = await registrarDispositivo(datosDispositivo(req, sn));
  const comandos = await tomarComandosPendientes(dispositivoId);
  if (comandos.length > 0) {
    logger.adms('Comandos entregados', { sn, ids: comandos.map((comando) => comando.id) });
  }
  responderTextoPlano(res, formatearComandos(comandos));
});

iclockRouter.get(['/getrequest', '/getrequest.php'], entregarComandos);
iclockRouter.post(['/getrequest', '/getrequest.php'], entregarComandos);

async function acusarComando(req: Request, res: Response): Promise<void> {
  const sn = leerSn(req);
  if (!RE_SN.test(sn)) {
    responderTextoPlano(res, 'ERROR', 400);
    return;
  }
  const dispositivoId = await registrarDispositivo(datosDispositivo(req, sn));
  const resultados = parsearResultadosComando(
    cuerpoTexto(req.body),
    textoConsulta(req.query.ID) || textoConsulta(req.query.id),
    textoConsulta(req.query.Return) || textoConsulta(req.query.return),
  );
  await confirmarComandos(dispositivoId, resultados);
  if (resultados.length > 0) {
    logger.adms('Acuse de comando', { sn, resultados });
  }
  responderTextoPlano(res, 'OK');
}

iclockRouter.get(['/devicecmd', '/devicecmd.php'], asyncHandler(acusarComando));
iclockRouter.post(['/devicecmd', '/devicecmd.php'], asyncHandler(acusarComando));

iclockRouter.get(['/registry', '/registry.php'], asyncHandler(async (req, res) => {
  const sn = leerSn(req);
  if (!RE_SN.test(sn)) {
    responderTextoPlano(res, 'ERROR', 400);
    return;
  }
  await registrarDispositivo(datosDispositivo(req, sn));
  responderTextoPlano(res, 'OK');
}));

iclockRouter.post(['/registry', '/registry.php'], asyncHandler(async (req, res) => {
  const sn = leerSn(req);
  if (!RE_SN.test(sn)) {
    responderTextoPlano(res, 'ERROR', 400);
    return;
  }
  const paquete = clasificarPaquete('OPTIONS', cuerpoTexto(req.body));
  await registrarDispositivo({
    ...datosDispositivo(req, sn),
    ...(paquete.tipo === 'opciones' ? paquete.opciones : {}),
  });
  logger.adms('Registro de reloj', { sn });
  responderTextoPlano(res, 'OK');
}));

iclockRouter.use((req, res) => {
  logger.adms('Ruta ADMS no especifica; se responde OK', { metodo: req.method, ruta: req.originalUrl });
  responderTextoPlano(res, 'OK');
});
