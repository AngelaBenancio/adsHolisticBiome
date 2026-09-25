import cron from 'node-cron';
import { env } from '../config/env';
import { asegurarDia } from './calculo.service';
import { fechaDeHoy, sumarDias } from '../utils/datetime';
import { logger } from '../utils/logger';

let enCurso = false;

/**
 * Cierra ayer y hoy en America/Lima.
 * Ayer cubre turnos cuya tolerancia cruzo la medianoche.
 * Hoy escribe falta solo si la tolerancia de entrada ya vencio.
 */
export async function cerrarJornada(): Promise<{ fechas: string[] }> {
  if (enCurso) {
    logger.info('Cierre de jornada ya en curso');
    return { fechas: [] };
  }
  enCurso = true;
  try {
    const hoy = fechaDeHoy();
    const ayer = sumarDias(hoy, -1);
    await asegurarDia(ayer);
    await asegurarDia(hoy);
    logger.info(`Cierre de jornada aplicado para ${ayer} y ${hoy}`);
    return { fechas: [ayer, hoy] };
  } finally {
    enCurso = false;
  }
}

export function programarCierreDiario(): cron.ScheduledTask {
  if (!cron.validate(env.cierreCron)) {
    throw new Error(`CIERRE_CRON no es una expresion valida: ${env.cierreCron}`);
  }
  const tarea = cron.schedule(env.cierreCron, () => {
    void cerrarJornada().catch((error: unknown) => {
      logger.error('Fallo el cierre automatico de faltas', error);
    });
  }, {
    timezone: 'America/Lima',
    recoverMissedExecutions: true,
  });
  logger.info(`Cierre de faltas programado (${env.cierreCron}, America/Lima)`);
  return tarea;
}
