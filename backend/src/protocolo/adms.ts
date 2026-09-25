import { formatLima } from '../utils/datetime';

const EVENTOS: Readonly<Record<number, string>> = {
  0: 'Entrada',
  1: 'Salida',
  2: 'Salida a descanso',
  3: 'Regreso de descanso',
  4: 'Entrada extra',
  5: 'Salida extra',
};

/**
 * Mapa habitual del campo Verify del ATTLOG ZKTeco.
 * El numero crudo siempre viaja en la API: el nombre es una ayuda de lectura.
 */
const METODOS: Readonly<Record<number, string>> = {
  0: 'Contraseña',
  1: 'Huella',
  2: 'PIN',
  3: 'Contraseña',
  4: 'Tarjeta',
  15: 'Rostro',
};

export function nombreEvento(codigo: number): string {
  return EVENTOS[codigo] ?? `Evento ${codigo}`;
}

export function nombreMetodo(codigo: number): string {
  return METODOS[codigo] ?? `Método ${codigo}`;
}

/**
 * Bloque de opciones que el reloj lee en GET /iclock/cdata.
 * Stamp=9999, Delay=10 y TimeZone=-5 son el handshake que usan los
 * equipos Push/ADMS cuando reemplazan a BioTime. ServerVersion y DateTime
 * sincronizan firmware 3.x con la hora de Peru.
 * Los comandos no van aqui: el equipo los pide en /iclock/getrequest.
 */
export function construirHandshake(sn: string, ahora: Date = new Date()): string {
  return [
    `GET OPTION FROM: ${sn}`,
    'Stamp=9999',
    'OpStamp=9999',
    'PhotoStamp=9999',
    'ErrorDelay=60',
    'Delay=10',
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    'TransFlag=1111000000',
    'TimeZone=-5',
    'Realtime=1',
    'Encrypt=None',
    'ServerVersion=3.0.1',
    `DateTime=${formatLima(ahora)}`,
  ].join('\n');
}

export function formatearComandos(comandos: Array<{ id: number; comando: string }>): string {
  if (comandos.length === 0) return 'OK';
  return comandos.map((comando) => `C:${comando.id}:${comando.comando}`).join('\n');
}
