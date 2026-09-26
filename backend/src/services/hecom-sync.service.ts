import { logger } from '../utils/logger';

function variable(nombre: string): string {
  return process.env[nombre]?.trim() ?? '';
}

/**
 * Avisa a Hecom Club de una marcacion ya confirmada en MySQL.
 * Sin URL o sin secreto no hace nada. Un fallo de red no se propaga.
 */
export async function sincronizarMarcacion(marca: any): Promise<void> {
  const url = variable('HECOM_SYNC_URL');
  const secreto = variable('HECOM_SYNC_SECRET');
  if (!url || !secreto) return;

  try {
    const cuerpo = {
      biotimeUserId: String(marca.pin),
      tipo: Number(marca.tipo_evento),
      timestamp: String(marca.fecha_hora),
      rawId: Number(marca.id),
    };
    const respuesta = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BioTime-Sync-Secret': secreto,
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(8000),
    });
    if (!respuesta.ok) {
      logger.error('Hecom Club rechazo la marcacion', {
        rawId: cuerpo.rawId,
        estado: respuesta.status,
      });
    }
  } catch (error) {
    logger.error('Hecom Club no recibio la marcacion', error);
  }
}
