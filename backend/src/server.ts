import './config/zona';
import cors from 'cors';
import express from 'express';
import { afirmarApiKey, env } from './config/env';
import { pool, prepararBaseDatos } from './config/database';
import { manejadorErrores } from './middleware/errorHandler';
import { exigirAcceso } from './middleware/apiKey';
import { apiRouter } from './routes/api.routes';
import { authRouter } from './routes/auth.routes';
import { iclockRouter } from './routes/iclock.routes';
import { asegurarUsuarioInicial } from './services/auth.service';
import { cerrarJornada, programarCierreDiario } from './services/cierre.service';
import { logger } from './utils/logger';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', env.trustProxy ? 1 : false);

const origenCors = env.corsOrigin === '*'
  ? '*'
  : env.corsOrigin.split(',').map((origen) => origen.trim()).filter(Boolean);

app.use(cors({ origin: origenCors }));

app.use('/iclock', (req, _res, next) => {
  if (!req.headers['content-type']) {
    req.headers['content-type'] = 'text/plain';
  }
  next();
});

app.use('/iclock', express.text({
  type: ['text/plain', '*/*'],
  limit: env.admsBodyLimit,
}));

app.use(express.json({ limit: '1mb' }));

app.use('/iclock', iclockRouter);
app.use('/api/auth', authRouter);
app.use('/api', exigirAcceso, apiRouter);

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      estado: 'ok',
      servicio: 'asistencias-zkteco',
      zona_horaria: 'America/Lima',
    });
  } catch (error) {
    logger.error('La base de datos no respondio al healthcheck', error);
    res.status(503).json({ estado: 'error', detalle: 'Base de datos no disponible' });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use(manejadorErrores);

async function main(): Promise<void> {
  afirmarApiKey();
  await prepararBaseDatos();
  await asegurarUsuarioInicial();

  const tareaCierre = env.cierreAutomatico ? programarCierreDiario() : null;
  if (tareaCierre) {
    void cerrarJornada().catch((error: unknown) => {
      logger.error('Fallo el cierre de jornada al arrancar', error);
    });
  }

  const servidor = app.listen(env.port, '0.0.0.0', () => {
    logger.info(`ADMS escuchando en 0.0.0.0:${env.port} (America/Lima)`);
  });

  let cerrando = false;
  const apagar = (senal: NodeJS.Signals): void => {
    if (cerrando) return;
    cerrando = true;
    logger.info(`Senal ${senal} recibida; cerrando servidor`);
    tareaCierre?.stop();
    servidor.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  };

  process.on('SIGINT', apagar);
  process.on('SIGTERM', apagar);
  process.on('unhandledRejection', (motivo) => {
    logger.error('Promesa rechazada sin capturar', motivo);
  });
  process.on('uncaughtException', (error) => {
    logger.error('Excepcion no capturada', error);
    process.exit(1);
  });
}

main().catch((error: unknown) => {
  logger.error('Fallo al iniciar', error);
  process.exit(1);
});
