/**
 * PM2 en el VPS. Las claves viven en .env (dotenv), no en este archivo.
 * Arranque: pm2 start ecosystem.config.cjs && pm2 save
 */
module.exports = {
  apps: [
    {
      name: 'asistencias-zkteco',
      script: 'dist/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      max_memory_restart: '400M',
      time: true,
      env: {
        NODE_ENV: 'production',
        TZ: 'America/Lima',
      },
    },
  ],
};
