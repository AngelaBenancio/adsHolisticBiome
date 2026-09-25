import { Router } from 'express';
import { asegurarRango, listarAsistencias, resumenDelDia } from '../services/calculo.service';
import { asignarTurno, actualizarTurno, crearEmpleado, crearTurno, listarTurnos, normalizarDias, normalizarHora } from '../services/horario.service';
import { crearFeriado, eliminarFeriado, fechaFeriadoValida, listarFeriados } from '../services/feriado.service';
import { actualizarWebhook, crearWebhook, eliminarWebhook, listarWebhooks } from '../services/webhook.service';
import { asyncHandler, HttpError, textoConsulta } from '../utils/http';

export const adminRouter = Router();

function idRuta(valor: string | undefined): number {
  if (!valor || !/^\d+$/.test(valor)) throw new HttpError(400, 'Identificador invalido');
  const id = Number(valor);
  if (id < 1) throw new HttpError(400, 'Identificador invalido');
  return id;
}

function fechaValida(valor: string, nombre: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw new HttpError(400, `${nombre} debe tener formato YYYY-MM-DD`);
  return valor;
}

function nombreLimpio(valor: unknown, maximo: number, etiqueta: string): string {
  if (typeof valor !== 'string') throw new HttpError(400, `${etiqueta} debe ser texto`);
  const nombre = valor.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maximo);
  if (!nombre) throw new HttpError(400, `${etiqueta} vacio`);
  return nombre;
}

adminRouter.get('/resumen', asyncHandler(async (req, res) => {
  const fecha = textoConsulta(req.query.fecha);
  const datos = await resumenDelDia(fecha || undefined);
  res.json({ zona_horaria: 'America/Lima', datos });
}));

adminRouter.get('/asistencias', asyncHandler(async (req, res) => {
  const resultado = await listarAsistencias(req.query);
  res.json({ zona_horaria: 'America/Lima', ...resultado });
}));

adminRouter.post('/asistencias/recalcular', asyncHandler(async (req, res) => {
  const cuerpo = req.body as { desde?: unknown; hasta?: unknown };
  if (!cuerpo || typeof cuerpo !== 'object') throw new HttpError(400, 'Cuerpo JSON invalido');
  if (typeof cuerpo.desde !== 'string' || typeof cuerpo.hasta !== 'string') {
    throw new HttpError(400, 'Indica desde y hasta');
  }
  await asegurarRango(fechaValida(cuerpo.desde, 'desde'), fechaValida(cuerpo.hasta, 'hasta'));
  res.json({ datos: { desde: cuerpo.desde, hasta: cuerpo.hasta, calculado: true } });
}));

adminRouter.get('/exportaciones/marcaciones', asyncHandler(async (req, res) => {
  const resultado = await listarAsistencias({ ...req.query, limite: textoConsulta(req.query.limite) || '200' });
  res.json({
    zona_horaria: 'America/Lima',
    evento: 'marcaciones.exportadas',
    ...resultado,
  });
}));

adminRouter.get('/turnos', asyncHandler(async (_req, res) => {
  res.json({ datos: await listarTurnos() });
}));

adminRouter.post('/turnos', asyncHandler(async (req, res) => {
  const cuerpo = req.body as {
    nombre?: unknown;
    hora_entrada?: unknown;
    tolerancia_minutos?: unknown;
    hora_salida?: unknown;
    dias_semana?: unknown;
  };
  const tolerancia = cuerpo.tolerancia_minutos;
  if (typeof tolerancia !== 'number' || !Number.isInteger(tolerancia) || tolerancia < 0 || tolerancia > 180) {
    throw new HttpError(400, 'tolerancia_minutos debe ser un entero entre 0 y 180');
  }
  if (typeof cuerpo.hora_entrada !== 'string' || typeof cuerpo.hora_salida !== 'string') {
    throw new HttpError(400, 'Indica hora_entrada y hora_salida');
  }
  const turno = await crearTurno({
    nombre: nombreLimpio(cuerpo.nombre, 80, 'nombre'),
    horaEntrada: normalizarHora(cuerpo.hora_entrada, 'hora_entrada'),
    toleranciaMinutos: tolerancia,
    horaSalida: normalizarHora(cuerpo.hora_salida, 'hora_salida'),
    diasSemana: normalizarDias(typeof cuerpo.dias_semana === 'string' ? cuerpo.dias_semana : '1111100'),
  });
  res.status(201).json({ datos: turno });
}));

adminRouter.patch('/turnos/:id', asyncHandler(async (req, res) => {
  const id = idRuta(req.params.id);
  const cuerpo = req.body as {
    nombre?: unknown;
    hora_entrada?: unknown;
    tolerancia_minutos?: unknown;
    hora_salida?: unknown;
    dias_semana?: unknown;
    activo?: unknown;
  };
  const cambios: Parameters<typeof actualizarTurno>[1] = {};
  if ('nombre' in cuerpo) cambios.nombre = nombreLimpio(cuerpo.nombre, 80, 'nombre');
  if ('hora_entrada' in cuerpo) {
    if (typeof cuerpo.hora_entrada !== 'string') throw new HttpError(400, 'hora_entrada invalida');
    cambios.horaEntrada = normalizarHora(cuerpo.hora_entrada, 'hora_entrada');
  }
  if ('hora_salida' in cuerpo) {
    if (typeof cuerpo.hora_salida !== 'string') throw new HttpError(400, 'hora_salida invalida');
    cambios.horaSalida = normalizarHora(cuerpo.hora_salida, 'hora_salida');
  }
  if ('tolerancia_minutos' in cuerpo) {
    const tolerancia = cuerpo.tolerancia_minutos;
    if (typeof tolerancia !== 'number' || !Number.isInteger(tolerancia) || tolerancia < 0 || tolerancia > 180) {
      throw new HttpError(400, 'tolerancia_minutos debe ser un entero entre 0 y 180');
    }
    cambios.toleranciaMinutos = tolerancia;
  }
  if ('dias_semana' in cuerpo) {
    if (typeof cuerpo.dias_semana !== 'string') throw new HttpError(400, 'dias_semana invalido');
    cambios.diasSemana = normalizarDias(cuerpo.dias_semana);
  }
  if ('activo' in cuerpo) {
    if (typeof cuerpo.activo !== 'boolean') throw new HttpError(400, 'activo debe ser true o false');
    cambios.activo = cuerpo.activo;
  }
  const turno = await actualizarTurno(id, cambios);
  if (!turno) throw new HttpError(404, 'Turno no encontrado');
  res.json({ datos: turno });
}));

adminRouter.post('/empleados', asyncHandler(async (req, res) => {
  const cuerpo = req.body as { pin?: unknown; nombre?: unknown };
  if (typeof cuerpo?.pin !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(cuerpo.pin)) {
    throw new HttpError(400, 'PIN invalido');
  }
  const id = await crearEmpleado(cuerpo.pin, nombreLimpio(cuerpo.nombre, 150, 'nombre'));
  res.status(201).json({ datos: { id, pin: cuerpo.pin } });
}));

adminRouter.post('/empleados/:id/turno', asyncHandler(async (req, res) => {
  const empleadoId = idRuta(req.params.id);
  const cuerpo = req.body as { turno_id?: unknown; vigente_desde?: unknown; vigente_hasta?: unknown };
  if (typeof cuerpo.turno_id !== 'number' || !Number.isInteger(cuerpo.turno_id) || cuerpo.turno_id < 1) {
    throw new HttpError(400, 'turno_id invalido');
  }
  if (typeof cuerpo.vigente_desde !== 'string') throw new HttpError(400, 'vigente_desde es obligatorio');
  const hasta = cuerpo.vigente_hasta === null || cuerpo.vigente_hasta === undefined
    ? null
    : fechaValida(String(cuerpo.vigente_hasta), 'vigente_hasta');
  await asignarTurno({
    empleadoId,
    turnoId: cuerpo.turno_id,
    vigenteDesde: fechaValida(cuerpo.vigente_desde, 'vigente_desde'),
    vigenteHasta: hasta,
  });
  res.status(201).json({ datos: { empleado_id: empleadoId, turno_id: cuerpo.turno_id } });
}));

adminRouter.get('/webhooks', asyncHandler(async (_req, res) => {
  res.json({ datos: await listarWebhooks() });
}));

adminRouter.post('/webhooks', asyncHandler(async (req, res) => {
  const cuerpo = req.body as { nombre?: unknown; url?: unknown; secreto?: unknown };
  if (typeof cuerpo?.url !== 'string') throw new HttpError(400, 'url es obligatoria');
  if (typeof cuerpo.secreto !== 'string' || cuerpo.secreto.trim().length < 8) {
    throw new HttpError(400, 'secreto debe tener al menos 8 caracteres');
  }
  const webhook = await crearWebhook({
    nombre: nombreLimpio(cuerpo.nombre, 80, 'nombre'),
    url: cuerpo.url,
    secreto: cuerpo.secreto.trim(),
  });
  res.status(201).json({ datos: webhook });
}));

adminRouter.patch('/webhooks/:id', asyncHandler(async (req, res) => {
  const id = idRuta(req.params.id);
  const cuerpo = req.body as { nombre?: unknown; url?: unknown; secreto?: unknown; activo?: unknown };
  const cambios: { nombre?: string; url?: string; secreto?: string; activo?: boolean } = {};
  if ('nombre' in cuerpo) cambios.nombre = nombreLimpio(cuerpo.nombre, 80, 'nombre');
  if ('url' in cuerpo) {
    if (typeof cuerpo.url !== 'string') throw new HttpError(400, 'url invalida');
    cambios.url = cuerpo.url;
  }
  if ('secreto' in cuerpo && cuerpo.secreto !== '') {
    if (typeof cuerpo.secreto !== 'string' || cuerpo.secreto.trim().length < 8) {
      throw new HttpError(400, 'secreto debe tener al menos 8 caracteres');
    }
    cambios.secreto = cuerpo.secreto.trim();
  }
  if ('activo' in cuerpo) {
    if (typeof cuerpo.activo !== 'boolean') throw new HttpError(400, 'activo debe ser true o false');
    cambios.activo = cuerpo.activo;
  }
  const webhook = await actualizarWebhook(id, cambios);
  if (!webhook) throw new HttpError(404, 'Webhook no encontrado');
  res.json({ datos: webhook });
}));

adminRouter.delete('/webhooks/:id', asyncHandler(async (req, res) => {
  const id = idRuta(req.params.id);
  const eliminado = await eliminarWebhook(id);
  if (!eliminado) throw new HttpError(404, 'Webhook no encontrado');
  res.json({ datos: { id, eliminado: true } });
}));

adminRouter.get('/feriados', asyncHandler(async (req, res) => {
  const anio = textoConsulta(req.query.anio);
  res.json({ zona_horaria: 'America/Lima', datos: await listarFeriados(anio || undefined) });
}));

adminRouter.post('/feriados', asyncHandler(async (req, res) => {
  const cuerpo = req.body as { fecha?: unknown; descripcion?: unknown };
  if (!cuerpo || typeof cuerpo.fecha !== 'string') throw new HttpError(400, 'fecha es obligatoria');
  const feriado = await crearFeriado(
    fechaFeriadoValida(cuerpo.fecha),
    nombreLimpio(cuerpo.descripcion, 150, 'descripcion'),
  );
  res.status(201).json({ datos: feriado });
}));

adminRouter.delete('/feriados/:id', asyncHandler(async (req, res) => {
  const id = idRuta(req.params.id);
  const eliminado = await eliminarFeriado(id);
  if (!eliminado) throw new HttpError(404, 'Feriado no encontrado');
  res.json({ datos: { id, eliminado: true } });
}));
