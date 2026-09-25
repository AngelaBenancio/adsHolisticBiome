import { Router } from 'express';
import { adminRouter } from './admin.routes';
import { buscarDispositivoPorSn, encolarComando, existeDispositivo } from '../services/adms.service';
import {
  actualizarAliasDispositivo,
  actualizarEmpleado,
  listarComandos,
  listarDispositivos,
  listarEmpleados,
  listarMarcaciones,
} from '../services/consulta.service';
import { asyncHandler, HttpError } from '../utils/http';

export const apiRouter = Router();

apiRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

function idRuta(valor: string | undefined): number {
  if (!valor || !/^\d+$/.test(valor)) throw new HttpError(400, 'Identificador invalido');
  const id = Number(valor);
  if (id < 1) throw new HttpError(400, 'Identificador invalido');
  return id;
}

apiRouter.get('/dispositivos', asyncHandler(async (_req, res) => {
  const datos = await listarDispositivos();
  res.json({ zona_horaria: 'America/Lima', datos });
}));

apiRouter.patch('/dispositivos/:id', asyncHandler(async (req, res) => {
  const id = idRuta(req.params.id);
  const cuerpo = req.body as { alias?: unknown };
  if (!cuerpo || typeof cuerpo !== 'object' || !('alias' in cuerpo)) {
    throw new HttpError(400, 'Indica alias');
  }
  if (cuerpo.alias !== null && typeof cuerpo.alias !== 'string') {
    throw new HttpError(400, 'alias debe ser texto o null');
  }
  const alias = typeof cuerpo.alias === 'string' ? cuerpo.alias.trim().slice(0, 120) : null;
  const dispositivo = await actualizarAliasDispositivo(id, alias || null);
  if (!dispositivo) throw new HttpError(404, 'Dispositivo no encontrado');
  res.json({ zona_horaria: 'America/Lima', datos: dispositivo });
}));

apiRouter.get('/marcaciones', asyncHandler(async (req, res) => {
  const resultado = await listarMarcaciones(req.query);
  res.json({ zona_horaria: 'America/Lima', ...resultado });
}));

apiRouter.get('/empleados', asyncHandler(async (req, res) => {
  const resultado = await listarEmpleados(req.query);
  res.json({ zona_horaria: 'America/Lima', ...resultado });
}));

apiRouter.patch('/empleados/:id', asyncHandler(async (req, res) => {
  const id = idRuta(req.params.id);
  const cuerpo = req.body as { nombre?: unknown; activo?: unknown };
  if (!cuerpo || typeof cuerpo !== 'object') throw new HttpError(400, 'Cuerpo JSON invalido');

  const cambios: { nombre?: string; activo?: boolean } = {};
  if ('nombre' in cuerpo) {
    if (typeof cuerpo.nombre !== 'string') throw new HttpError(400, 'nombre debe ser texto');
    const nombre = cuerpo.nombre.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 150);
    if (!nombre) throw new HttpError(400, 'nombre vacio');
    cambios.nombre = nombre;
  }
  if ('activo' in cuerpo) {
    if (typeof cuerpo.activo !== 'boolean') throw new HttpError(400, 'activo debe ser true o false');
    cambios.activo = cuerpo.activo;
  }
  if (cambios.nombre === undefined && cambios.activo === undefined) {
    throw new HttpError(400, 'Nada que actualizar');
  }

  const empleado = await actualizarEmpleado(id, cambios);
  if (!empleado) throw new HttpError(404, 'Empleado no encontrado');
  res.json({ datos: empleado });
}));

apiRouter.get('/comandos', asyncHandler(async (req, res) => {
  const datos = await listarComandos(req.query);
  res.json({ zona_horaria: 'America/Lima', datos });
}));

apiRouter.post('/comandos', asyncHandler(async (req, res) => {
  const cuerpo = req.body as { sn?: unknown; dispositivo_id?: unknown; comando?: unknown };
  if (!cuerpo || typeof cuerpo !== 'object') throw new HttpError(400, 'Cuerpo JSON invalido');
  if (typeof cuerpo.comando !== 'string') throw new HttpError(400, 'comando es obligatorio');

  const comando = cuerpo.comando.trim().replace(/^\s*C:\d+:/, '').trim();
  if (!comando || comando.length > 900) throw new HttpError(400, 'comando vacio o demasiado largo');
  if (/[\u0000-\u0008\u000A-\u001F\u007F]/.test(comando)) {
    throw new HttpError(400, 'El comando debe ser una sola linea');
  }

  let dispositivoId: number | null = null;
  if (typeof cuerpo.dispositivo_id === 'number' && Number.isInteger(cuerpo.dispositivo_id) && cuerpo.dispositivo_id > 0) {
    dispositivoId = cuerpo.dispositivo_id;
  } else if (typeof cuerpo.dispositivo_id === 'string' && /^\d+$/.test(cuerpo.dispositivo_id)) {
    dispositivoId = Number(cuerpo.dispositivo_id);
  } else if (typeof cuerpo.sn === 'string' && cuerpo.sn.trim()) {
    const sn = cuerpo.sn.trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(sn)) throw new HttpError(400, 'Numero de serie invalido');
    dispositivoId = await buscarDispositivoPorSn(sn);
  } else {
    throw new HttpError(400, 'Indica sn o dispositivo_id');
  }

  if (!dispositivoId || !(await existeDispositivo(dispositivoId))) {
    throw new HttpError(404, 'El reloj aun no se ha conectado');
  }
  const id = await encolarComando(dispositivoId, comando);
  res.status(201).json({
    datos: { id, dispositivo_id: dispositivoId, comando, estado: 'pendiente' },
  });
}));

apiRouter.use(adminRouter);

apiRouter.use((_req, _res, next) => {
  next(new HttpError(404, 'Ruta no encontrada'));
});
