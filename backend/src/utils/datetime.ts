const FORMATO = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

function parte(partes: Intl.DateTimeFormatPart[], tipo: Intl.DateTimeFormatPartTypes): string {
  return partes.find((item) => item.type === tipo)?.value ?? '00';
}

/** Hora de pared en America/Lima, formato que el reloj ZKTeco espera. */
export function formatLima(fecha: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(fecha);

  let hora = parte(partes, 'hour');
  if (hora === '24') hora = '00';
  return `${parte(partes, 'year')}-${parte(partes, 'month')}-${parte(partes, 'day')} ${hora}:${parte(partes, 'minute')}:${parte(partes, 'second')}`;
}

/**
 * Acepta una fecha de pared de Peru y la devuelve normalizada.
 * Rechaza calendarios imposibles (31 de febrero, hora 24, año fuera de rango).
 * La conversion usa UTC-5 fijo, identico a America/Lima.
 */
export function normalizarFechaHora(valor: string): string | null {
  const limpio = valor.trim().replace(/\.\d+$/, '');
  const coincidencia = FORMATO.exec(limpio);
  if (!coincidencia) return null;

  const anio = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]);
  const dia = Number(coincidencia[3]);
  const hora = Number(coincidencia[4]);
  const minuto = Number(coincidencia[5]);
  const segundo = Number(coincidencia[6]);
  if (anio < 2000 || anio > 2100) return null;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  if (hora > 23 || minuto > 59 || segundo > 59) return null;

  const texto = `${coincidencia[1]}-${coincidencia[2]}-${coincidencia[3]} ${coincidencia[4]}:${coincidencia[5]}:${coincidencia[6]}`;
  const instante = new Date(Date.UTC(anio, mes - 1, dia, hora + 5, minuto, segundo));
  if (Number.isNaN(instante.getTime())) return null;
  if (formatLima(instante) !== texto) return null;
  return texto;
}

/** true si la marcacion cae mas alla de la tolerancia respecto de ahora en Lima. */
export function esFechaFutura(fechaHora: string, toleranciaMinutos = 10, ahora: Date = new Date()): boolean {
  const limite = formatLima(new Date(ahora.getTime() + toleranciaMinutos * 60_000));
  return fechaHora > limite;
}

export function fechaDeHoy(ahora: Date = new Date()): string {
  return formatLima(ahora).slice(0, 10);
}

export function sumarDias(fecha: string, dias: number): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const instante = new Date(Date.UTC(anio, mes - 1, dia + dias));
  const y = instante.getUTCFullYear();
  const m = String(instante.getUTCMonth() + 1).padStart(2, '0');
  const d = String(instante.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function enumerarDias(desde: string, hasta: string, maximo = 62): string[] {
  const dias: string[] = [];
  let cursor = desde;
  while (cursor <= hasta && dias.length < maximo) {
    dias.push(cursor);
    cursor = sumarDias(cursor, 1);
  }
  return dias;
}

export function horaEnTexto(valor: unknown): string {
  if (typeof valor !== 'string') return '00:00:00';
  const coincidencia = /(\d{2}:\d{2}:\d{2})/.exec(valor);
  return coincidencia?.[1] ?? '00:00:00';
}
