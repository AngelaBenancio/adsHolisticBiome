import type { MarcacionCruda, OpcionesDispositivo, PaqueteParseado, ResultadoComando, UsuarioCrudo } from '../types';
import { normalizarFechaHora } from '../utils/datetime';

const TABLAS_DESCARTE = new Set([
  'BIOPHOTO',
  'ATTPHOTO',
  'OPLOG',
  'OPERLOG',
  'ERRORLOG',
  'USERPIC',
  'FACE',
  'FINGERTMP',
  'TEMPLATE',
  'FINGERPRINT',
]);

const RE_PIN = /^[A-Za-z0-9_-]{1,32}$/;
const RE_ATTLOG = /^(\S+)\s+(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})\s+(\d+)\s+(\d+)(?:\s+(\S+))?$/;

function limpiarNombre(nombre: string, pin: string): string {
  const limpio = nombre.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 150);
  return limpio || `Empleado ${pin}`;
}

function enteroAcotado(valor: string | undefined, maximo: number): number | null {
  if (valor === undefined || valor.trim() === '') return 0;
  if (!/^\d+$/.test(valor.trim())) return null;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero > maximo) return null;
  return numero;
}

function camposDeLinea(linea: string): Record<string, string> {
  const campos: Record<string, string> = {};
  const partes = linea.trim().split(/\t|\s+(?=[A-Za-z][A-Za-z0-9]*=)/);
  for (const parte of partes) {
    const igual = parte.indexOf('=');
    if (igual <= 0) continue;
    const clave = parte.slice(0, igual).trim().toLowerCase();
    if (clave === 'tmp' || clave === 'passwd' || clave === 'password') continue;
    campos[clave] = parte.slice(igual + 1).trim();
  }
  return campos;
}

function lineaDescartable(linea: string): boolean {
  return /^(BIOPHOTO|ATTPHOTO|OPLOG|OPERLOG|USERPIC|FINGERTMP)\b/i.test(linea);
}

function construirMarcacion(pin: string, fecha: string, estado: string | undefined, verificacion: string | undefined, trabajo: string | undefined): MarcacionCruda | null {
  if (!RE_PIN.test(pin)) return null;
  const fechaHora = normalizarFechaHora(fecha);
  if (!fechaHora) return null;
  const tipoEvento = enteroAcotado(estado, 255);
  const metodoVerificacion = enteroAcotado(verificacion, 255);
  if (tipoEvento === null || metodoVerificacion === null) return null;
  const codigo = trabajo?.trim();
  return {
    pin,
    fechaHora,
    tipoEvento,
    metodoVerificacion,
    codigoTrabajo: codigo && codigo !== '0' ? codigo.slice(0, 32) : null,
  };
}

function parsearAttlog(cuerpo: string): MarcacionCruda[] {
  const registros: MarcacionCruda[] = [];
  for (const cruda of cuerpo.split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea || /^attlogs?$/i.test(linea) || lineaDescartable(linea)) continue;

    if (linea.includes('=')) {
      const campos = camposDeLinea(linea);
      const pin = campos.pin ?? '';
      const fecha = campos.datetime ?? campos.time ?? campos.timestamp ?? '';
      if (!pin || !fecha) continue;
      const registro = construirMarcacion(pin, fecha, campos.status ?? campos.state, campos.verify ?? campos.verified, campos.workcode);
      if (registro) registros.push(registro);
      continue;
    }

    const columnas = linea.split('\t').map((columna) => columna.trim());
    if (columnas.length >= 2 && /^\d{4}-\d{2}-\d{2}/.test(columnas[1] ?? '')) {
      const registro = construirMarcacion(columnas[0] ?? '', columnas[1] ?? '', columnas[2], columnas[3], columnas[4]);
      if (registro) registros.push(registro);
      continue;
    }

    const suelta = RE_ATTLOG.exec(linea);
    if (!suelta) continue;
    const registro = construirMarcacion(suelta[1] ?? '', (suelta[2] ?? '').replace('T', ' '), suelta[3], suelta[4], suelta[5]);
    if (registro) registros.push(registro);
  }
  return registros;
}

function pareceAttlog(cuerpo: string): boolean {
  return cuerpo.split(/\r?\n/).some((linea) => {
    const texto = linea.trim();
    if (!texto || lineaDescartable(texto)) return false;
    const columnas = texto.split('\t');
    if (columnas.length >= 2 && RE_PIN.test(columnas[0] ?? '') && normalizarFechaHora(columnas[1] ?? '')) return true;
    return RE_ATTLOG.test(texto);
  });
}

function parsearUsuarios(cuerpo: string, esBiodata: boolean): UsuarioCrudo[] {
  const usuarios: UsuarioCrudo[] = [];
  for (const cruda of cuerpo.split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea || lineaDescartable(linea)) continue;
    const campos = camposDeLinea(linea);
    const pin = campos.pin ?? '';
    if (!RE_PIN.test(pin)) continue;
    const privilegio = enteroAcotado(campos.pri ?? campos.privilege, 999) ?? 0;
    const tarjeta = (campos.card ?? campos.vicecard ?? '').slice(0, 64);
    const grupo = (campos.grp ?? campos.group ?? '').slice(0, 32);
    const nombre = esBiodata ? `Empleado ${pin}` : limpiarNombre(campos.name ?? campos.username ?? '', pin);
    usuarios.push({
      pin,
      nombre,
      privilegio,
      tarjeta: tarjeta || null,
      grupo: grupo || null,
    });
  }
  return usuarios;
}

function extraerOpciones(cuerpo: string): OpcionesDispositivo {
  const campos = camposDeLinea(cuerpo.replace(/,/g, '\t'));
  const alias = (campos.devicename ?? campos['~devicename'] ?? '').slice(0, 120);
  const firmware = (campos.firmver ?? campos.firmware ?? '').slice(0, 80);
  const pushVersion = (campos.pushversion ?? campos.pushver ?? '').slice(0, 40);
  return {
    ...(alias ? { alias } : {}),
    ...(firmware ? { firmware } : {}),
    ...(pushVersion ? { pushVersion } : {}),
  };
}

/**
 * Separa marcaciones y altas de usuario del ruido del protocolo
 * (fotos BIOPHOTO, auditoria OPLOG y plantillas). Las plantillas no
 * se conservan: solo se usa el PIN para abrir la ficha del colaborador.
 */
export function clasificarPaquete(tablaCruda: string | undefined, cuerpo: string): PaqueteParseado {
  const tabla = (tablaCruda ?? '').trim().toUpperCase();
  const vista = cuerpo.slice(0, 400).trim();

  if (TABLAS_DESCARTE.has(tabla) || /^(BIOPHOTO|ATTPHOTO|OPLOG|OPERLOG)\b/i.test(vista)) {
    return { tipo: 'descartado', motivo: tabla || 'contenido' };
  }

  if (tabla === 'OPTIONS' || tabla === 'OPTION') {
    return { tipo: 'opciones', opciones: extraerOpciones(cuerpo) };
  }

  if (tabla === 'ATTLOG' || tabla === 'ATTLOGS') {
    return { tipo: 'attlog', registros: parsearAttlog(cuerpo) };
  }

  if (tabla === 'USER' || tabla === 'USERINFO') {
    return { tipo: 'usuarios', origen: 'userinfo', usuarios: parsearUsuarios(cuerpo, false) };
  }

  if (tabla === 'BIODATA') {
    return { tipo: 'usuarios', origen: 'biodata', usuarios: parsearUsuarios(cuerpo, true) };
  }

  if (/pin\s*=/i.test(vista) && /name\s*=/i.test(vista)) {
    return { tipo: 'usuarios', origen: 'userinfo', usuarios: parsearUsuarios(cuerpo, false) };
  }

  if (/^pin\s*=/im.test(vista) && /\btmp\s*=/i.test(vista)) {
    return { tipo: 'usuarios', origen: 'biodata', usuarios: parsearUsuarios(cuerpo, true) };
  }

  if (pareceAttlog(cuerpo)) {
    return { tipo: 'attlog', registros: parsearAttlog(cuerpo) };
  }

  if (!vista) return { tipo: 'vacio' };
  return { tipo: 'descartado', motivo: tabla ? `tabla:${tabla}` : 'desconocido' };
}

export function parsearResultadosComando(cuerpo: string, idConsulta: string, retornoConsulta: string): ResultadoComando[] {
  const resultados: ResultadoComando[] = [];
  for (const cruda of cuerpo.split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea) continue;
    const id = /(?:^|[&\s])ID=(\d+)/i.exec(linea);
    if (!id?.[1]) continue;
    const retorno = /(?:^|[&\s])Return=(-?\d+)/i.exec(linea);
    resultados.push({ id: Number(id[1]), retorno: retorno?.[1] ?? '' });
  }
  if (resultados.length > 0) return resultados;
  if (/^\d+$/.test(idConsulta)) {
    return [{ id: Number(idConsulta), retorno: retornoConsulta }];
  }
  return [];
}
