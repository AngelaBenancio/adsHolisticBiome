# Asistencias ZKTeco

Monorepo con dos aplicaciones independientes. El reloj biométrico habla solo con el backend. El panel es un sitio estático que consume la API.

```
backend/    Receptor ADMS, MySQL, cálculo de asistencia, webhooks, PM2
frontend/   Panel Vite + React + Tailwind
```

Hora de trabajo: `America/Lima` (`-05:00`).

## Backend

```bash
cd backend
cp .env.example .env
npm install
npm run build
npm run db:init
pm2 start ecosystem.config.cjs
pm2 save
```

`npm run check` prueba el handshake ADMS y el cálculo de tardanza sin base de datos.

El reloj apunta al puerto `8088`, rutas `/iclock/cdata`, `/iclock/getrequest` y `/iclock/devicecmd` (también con `.php`). `BIOPHOTO` y `OPLOG` responden `OK` y no se guardan. Las marcaciones duplicadas se ignoran.

Tablas `asist_`: dispositivos, empleados, marcaciones, comandos, turnos, asignaciones, resultados, usuarios, sesiones y webhooks. Si `asist_usuarios` está vacía y `.env` trae `ADMIN_USUARIO` y `ADMIN_PASSWORD` (mínimo 8 caracteres), el arranque crea ese primer acceso.

Un turno tiene hora de entrada, tolerancia, hora de salida y días laborales (`1111100` es lunes a viernes). Al cruzarlo con la marcación del día el resultado queda en:

- `a_tiempo` si llegó dentro de la tolerancia
- `tardanza` si llegó después; los minutos se cuentan desde la hora oficial
- `falta` si no marcó y ya venció la tolerancia, en un día laboral
- `sin_turno` si marcó y no tiene horario
- `feriado` si la fecha está en `asist_feriados`; ese día no genera falta ni tardanza

Antes de que venza la tolerancia no se escribe falta. El proceso cierra ayer y hoy al arrancar y otra vez a las 23:59 de Lima, sin abrir el panel.

### API

`POST /api/auth/login` es público y devuelve un token de sesión. El resto de `/api` acepta ese token (`Authorization: Bearer`) o, para scripts, `X-API-Key`.

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/yo`
- `GET /api/resumen?fecha=YYYY-MM-DD`
- `GET /api/asistencias` y `GET /api/marcaciones`
- `POST /api/asistencias/recalcular`
- `GET /api/empleados`, `POST /api/empleados`, `POST /api/empleados/:id/turno`
- `GET/POST/PATCH /api/turnos`
- `GET /api/dispositivos`, `POST /api/comandos`
- `GET/POST/PATCH/DELETE /api/webhooks`
- `GET/POST /api/feriados`, `DELETE /api/feriados/:id`
- `GET /api/exportaciones/marcaciones`

### Webhook hacia Hecom Club

En el panel, Reloj, se registra la URL del servicio (por ejemplo una ruta en Vercel) y un secreto. Cada marcación nueva dispara un POST con `X-Webhook-Secret`:

```json
{
  "evento": "marcacion.creada",
  "zona_horaria": "America/Lima",
  "marcacion": {
    "id": 1,
    "pin": "1001",
    "empleado": "Ana Ruiz",
    "fecha_hora": "2026-09-24 08:12:00",
    "tipo_evento": 0,
    "tipo_evento_nombre": "Entrada",
    "dispositivo_sn": "RELOJ01"
  },
  "resultado": {
    "fecha": "2026-09-24",
    "estado": "tardanza",
    "minutos_tarde": 12,
    "turno": "Oficina"
  }
}
```

Si el destino no responde, la marcación igual queda en MySQL. El panel muestra el último HTTP. `GET /api/exportaciones/marcaciones` sirve para recuperar un rango si el webhook estuvo caído.

### Cierre automático de faltas

Con `CIERRE_AUTOMATICO=true` (el valor por defecto) el mismo proceso de PM2 evalúa ayer y hoy en `America/Lima`: al arrancar y según `CIERRE_CRON` (`59 23 * * *` es las 23:59). Ayer se vuelve a cerrar para cubrir un turno cuya tolerancia cruzó la medianoche. Hoy solo escribe `falta` si la tolerancia de entrada ya venció. Un feriado no produce falta.

También se puede lanzar a mano, con el `.env` del backend:

```bash
cd backend
npm run cierre
```

En el VPS, si prefieres el cron del sistema en lugar del interno, pon `CIERRE_AUTOMATICO=false` y en crontab:

```cron
59 23 * * * cd /var/www/asistencias-zkteco/backend && /usr/bin/node dist/scripts/cerrar-dia.js >> logs/cierre.log 2>&1
```

Ese script usa el reloj del sistema. En Contabo deja la zona del servidor en `America/Lima` (`timedatectl set-timezone America/Lima`) o el cierre de las 23:59 no coincide con Perú.

### Feriados

`npm run db:init` crea `asist_feriados` (`id`, `fecha`, `descripcion`) y amplía el estado de `asist_resultados` con `feriado`. Registrar un día libre, con la clave API o el token del panel:

```bash
curl -X POST http://127.0.0.1:8088/api/feriados \
  -H "Content-Type: application/json" \
  -H "X-API-Key: la-clave-del-env" \
  -d '{"fecha":"2026-07-28","descripcion":"Fiestas Patrias"}'
```

`GET /api/feriados?anio=2026` lista el año. `DELETE /api/feriados/1` quita uno. La fecha no se puede repetir. En un feriado, quien tiene turno queda en `feriado` aunque no marque; no se escribe `falta` ni `tardanza`.

### Puerto ADMS en el VPS de Contabo

El reloj solo debe llegar a tu IP pública, puerto `8088`. En `.env`:

```bash
ADMS_COMM_KEY=una-clave-larga-del-reloj
ADMS_IP_ALLOWLIST=201.218.1.20
TRUST_PROXY=true
```

`ADMS_COMM_KEY` vacía no pide clave. Con valor, cada trama de `/iclock` tiene que traerla en `?comkey=`, `?token=` o en `X-Comm-Key`. Si falta o no coincide, la respuesta es `ERROR` con HTTP 401 y no se guarda nada.

`ADMS_IP_ALLOWLIST` vacía no filtra. Con una o varias IPs separadas por coma, cualquier otra dirección se registra en `logs/zk_adms.log` y recibe HTTP 403, sin procesar la trama. Detrás de Nginx, `TRUST_PROXY=true` hace que la lista vea la IP del reloj y no la del proxy.

En el firewall de Contabo (y en `ufw` del VPS) abre el 8088 solo hacia la IP pública de la oficina, y no publiques el 3306:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow from 201.218.1.20 to any port 8088 proto tcp
ufw enable
```

En el reloj, el servidor ADMS es la IP del VPS, puerto 8088, y la misma comm key. `CORS_ORIGIN` lleva el dominio del panel, no `*`, cuando el sitio deja de ser local.

## Docker en Contabo

El `docker-compose.yml` de la raíz levanta MySQL 8.4, el backend y el panel. MySQL queda solo en la red `interna`, con el volumen `asistencias-mysql`, y no publica el 3306. El panel se une también a la red externa `n8n-setup_app-network` para que el Traefik que ya corre en el VPS lo publique en `https://huellero.adsholistic.com` (entrypoint `websecure`, puerto interno 80). El backend publica `8088:8088` en el host: el reloj no pasa por Traefik. Las claves se leen del `.env` de la raíz.

```bash
cp .env.example .env
docker compose up -d --build
```

Completa `MYSQL_ROOT_PASSWORD`, `DB_PASSWORD`, `API_KEY` (mínimo 16 caracteres, distinta del ejemplo) y `ADMIN_PASSWORD` (mínimo 8). `TRAEFIK_CERTRESOLVER` debe coincidir con el resolver ACME de ese Traefik; en el compose oficial de n8n se llama `mytlschallenge`. El DNS de `huellero.adsholistic.com` apunta a la IP del VPS. El primer arranque aplica `sql/schema.sql` y, si `asist_usuarios` está vacía, crea el administrador.

Nginx del panel reenvía `/api` y `/health` al backend, así que `VITE_API_URL` se deja vacía. `CORS_ORIGIN` es `https://huellero.adsholistic.com`.

El reloj apunta a la IP del VPS, puerto `8088`, rutas `/iclock/cdata`, `/iclock/getrequest` y `/iclock/devicecmd`. `TRUST_PROXY` queda en `false` para que `ADMS_IP_ALLOWLIST` vea la IP real del reloj. En el firewall el 80 y el 443 los usa Traefik; el 8088 ábrelo solo desde la oficina. No abras el 3306.

## Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run build
```

`npm run dev` sirve el panel en `http://127.0.0.1:5173`. La URL del backend sale de `VITE_API_URL` (se incrusta al compilar). El ingreso pide usuario y contraseña; el token queda solo en la sesión del navegador.

El build estático queda en `frontend/dist`. En Nginx:

```nginx
location / {
  root /var/www/asistencias;
  try_files $uri $uri/ /index.html;
}
```
