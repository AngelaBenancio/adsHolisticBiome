import '../config/zona';
import { pool } from '../config/database';
import { cerrarJornada } from '../services/cierre.service';

cerrarJornada()
  .then(async (resultado) => {
    console.log(resultado.fechas.length === 0
      ? 'Cierre omitido: ya habia uno en curso.'
      : `Cierre aplicado para ${resultado.fechas.join(' y ')} (America/Lima).`);
    await pool.end();
  })
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
