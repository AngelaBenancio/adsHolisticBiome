import { evaluarAsistencia } from '../domain/asistencia';
import { construirHandshake, formatearComandos } from '../protocolo/adms';
import { clasificarPaquete, parsearResultadosComando } from '../services/parser';
import { esFechaFutura, normalizarFechaHora } from '../utils/datetime';

function afirmar(condicion: boolean, mensaje: string): void {
  if (!condicion) throw new Error(mensaje);
}

const handshake = construirHandshake('RELOJ01', new Date('2026-09-24T17:20:00.000Z'));
const mapa = new Map(
  handshake.split('\n').map((linea) => {
    const corte = linea.indexOf('=');
    return corte === -1 ? [linea, ''] : [linea.slice(0, corte), linea.slice(corte + 1)];
  }),
);

afirmar(handshake.startsWith('GET OPTION FROM: RELOJ01'), 'falta el encabezado del handshake');
afirmar(mapa.get('ServerVersion') === '3.0.1', 'ServerVersion');
afirmar(mapa.get('Delay') === '10', 'Delay');
afirmar(mapa.get('TimeZone') === '-5', 'TimeZone');
afirmar(mapa.get('Stamp') === '9999', 'Stamp');
afirmar(mapa.get('DateTime') === '2026-09-24 12:20:00', `DateTime inesperado: ${mapa.get('DateTime')}`);
afirmar(!handshake.includes('C:'), 'el handshake no debe incluir comandos');

afirmar(formatearComandos([]) === 'OK', 'sin comandos debe responder OK');
afirmar(
  formatearComandos([{ id: 4, comando: 'CHECK' }]) === 'C:4:CHECK',
  'formato de comando',
);

const attlog = clasificarPaquete(
  'ATTLOG',
  '1001\t2026-09-24 08:01:02\t0\t1\t0\t0\t0\n1001\t2026-09-24 08:01:02\t0\t1\t0\n1002  2026-09-24 18:10:00  1  15  0\n',
);
afirmar(attlog.tipo === 'attlog' && attlog.registros.length === 3, 'ATTLOG tabulado y con espacios');
if (attlog.tipo === 'attlog') {
  afirmar(attlog.registros[0]?.pin === '1001', 'PIN');
  afirmar(attlog.registros[0]?.tipoEvento === 0, 'tipo de evento');
  afirmar(attlog.registros[0]?.metodoVerificacion === 1, 'metodo');
  afirmar(attlog.registros[2]?.metodoVerificacion === 15, 'rostro');
  afirmar(esFechaFutura('2099-01-01 00:00:00'), 'fecha futura');
  afirmar(!esFechaFutura('2001-01-01 00:00:00'), 'fecha historica');
}

afirmar(normalizarFechaHora('2026-02-31 10:00:00') === null, '31 de febrero');
afirmar(normalizarFechaHora('2026-09-24 08:01:02') === '2026-09-24 08:01:02', 'fecha valida');

const usuarios = clasificarPaquete(
  'USERINFO',
  'USER PIN=55\tName=Ana Ruiz\tPri=0\tPasswd=SecretoNoGuardar\tCard=999\tGrp=1\n',
);
afirmar(usuarios.tipo === 'usuarios' && usuarios.usuarios.length === 1, 'USERINFO');
if (usuarios.tipo === 'usuarios') {
  afirmar(usuarios.usuarios[0]?.pin === '55', 'PIN de usuario');
  afirmar(usuarios.usuarios[0]?.nombre === 'Ana Ruiz', 'nombre');
  afirmar(usuarios.usuarios[0]?.tarjeta === '999', 'tarjeta');
  afirmar(!JSON.stringify(usuarios.usuarios).includes('SecretoNoGuardar'), 'la contrasena no se conserva');
}

const biodata = clasificarPaquete(
  'BIODATA',
  'Pin=77\tNo=0\tIndex=0\tValid=1\tType=1\tTmp=PLANTILLA_SECRETA\n',
);
afirmar(biodata.tipo === 'usuarios' && biodata.origen === 'biodata', 'BIODATA');
if (biodata.tipo === 'usuarios') {
  afirmar(biodata.usuarios[0]?.nombre === 'Empleado 77', 'nombre provisional');
  afirmar(!JSON.stringify(biodata.usuarios).includes('PLANTILLA_SECRETA'), 'la plantilla no se conserva');
}

afirmar(clasificarPaquete('BIOPHOTO', 'JPEGDATA').tipo === 'descartado', 'BIOPHOTO');
afirmar(clasificarPaquete('OPERLOG', 'OPLOG 4\t2026-09-24 08:00:00\t0\t0\t0\t0').tipo === 'descartado', 'OPLOG');
afirmar(clasificarPaquete(undefined, '').tipo === 'vacio', 'cuerpo vacio');

const acuses = parsearResultadosComando('ID=12&Return=0&CMD=CHECK\nID=13&Return=-1&CMD=DATA', '', '');
afirmar(acuses.length === 2 && acuses[0]?.retorno === '0' && acuses[1]?.retorno === '-1', 'acuse devicecmd');

const turno = { horaEntrada: '08:00:00', toleranciaMinutos: 10, horaSalida: '17:00:00', diasSemana: '1111100' };
const aTiempo = evaluarAsistencia({
  fecha: '2026-09-24',
  ahora: '2026-09-24 12:00:00',
  turno,
  marcaciones: [{ id: 1, fechaHora: '2026-09-24 08:05:00', tipoEvento: 0 }],
});
afirmar(aTiempo?.estado === 'a_tiempo' && aTiempo.minutosTarde === 0, 'a tiempo dentro de la tolerancia');

const tarde = evaluarAsistencia({
  fecha: '2026-09-24',
  ahora: '2026-09-24 12:00:00',
  turno,
  marcaciones: [{ id: 2, fechaHora: '2026-09-24 08:20:00', tipoEvento: 0 }],
});
afirmar(tarde?.estado === 'tardanza' && tarde.minutosTarde === 20, 'tardanza desde la hora oficial');

const falta = evaluarAsistencia({
  fecha: '2026-09-24',
  ahora: '2026-09-24 12:00:00',
  turno,
  marcaciones: [],
});
afirmar(falta?.estado === 'falta', 'falta despues de la tolerancia');

const enVentana = evaluarAsistencia({
  fecha: '2026-09-24',
  ahora: '2026-09-24 08:05:00',
  turno,
  marcaciones: [],
});
afirmar(enVentana === null, 'todavia no es falta dentro de la tolerancia');

const sabado = evaluarAsistencia({
  fecha: '2026-09-26',
  ahora: '2026-09-26 12:00:00',
  turno,
  marcaciones: [],
});
afirmar(sabado === null, 'el sabado no genera falta');

const sinTurno = evaluarAsistencia({
  fecha: '2026-09-24',
  ahora: '2026-09-24 12:00:00',
  turno: null,
  marcaciones: [{ id: 3, fechaHora: '2026-09-24 08:01:00', tipoEvento: 0 }],
});
afirmar(sinTurno?.estado === 'sin_turno', 'marcacion sin turno');

const feriado = evaluarAsistencia({
  fecha: '2026-09-24',
  ahora: '2026-09-24 23:59:00',
  turno,
  marcaciones: [],
  feriado: true,
});
afirmar(feriado?.estado === 'feriado' && feriado.minutosTarde === 0, 'feriado no genera falta');

console.log('Autoverificacion del protocolo ADMS correcta.');
