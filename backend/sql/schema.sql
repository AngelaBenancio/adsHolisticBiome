-- Esquema de asistencias ZKTeco.
-- La aplicacion fija America/Lima (-05:00) en cada sesion MySQL;
-- este script no depende de la zona global del servidor.

CREATE TABLE IF NOT EXISTS asist_dispositivos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sn VARCHAR(64) NOT NULL,
  alias VARCHAR(120) NULL,
  ip_origen VARCHAR(45) NULL,
  firmware VARCHAR(80) NULL,
  push_version VARCHAR(40) NULL,
  ultima_conexion DATETIME NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_asist_dispositivos_sn (sn),
  KEY idx_asist_dispositivos_ultima (ultima_conexion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS asist_empleados (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  pin VARCHAR(32) NOT NULL,
  nombre VARCHAR(150) NOT NULL,
  privilegio SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  tarjeta VARCHAR(64) NULL,
  grupo VARCHAR(32) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  fecha_ingreso DATE NULL,
  origen ENUM('marcacion', 'userinfo', 'biodata', 'manual') NOT NULL DEFAULT 'marcacion',
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_asist_empleados_pin (pin),
  KEY idx_asist_empleados_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS asist_marcaciones (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dispositivo_id INT UNSIGNED NOT NULL,
  empleado_id INT UNSIGNED NOT NULL,
  pin VARCHAR(32) NOT NULL,
  fecha_hora DATETIME NOT NULL,
  tipo_evento TINYINT UNSIGNED NOT NULL DEFAULT 0,
  metodo_verificacion SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  codigo_trabajo VARCHAR(32) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_asist_marcaciones_dedup (dispositivo_id, pin, fecha_hora, tipo_evento),
  KEY idx_asist_marcaciones_fecha (fecha_hora),
  KEY idx_asist_marcaciones_empleado (empleado_id, fecha_hora),
  CONSTRAINT fk_asist_marcaciones_dispositivo
    FOREIGN KEY (dispositivo_id) REFERENCES asist_dispositivos (id),
  CONSTRAINT fk_asist_marcaciones_empleado
    FOREIGN KEY (empleado_id) REFERENCES asist_empleados (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS asist_comandos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  dispositivo_id INT UNSIGNED NOT NULL,
  comando VARCHAR(1000) NOT NULL,
  estado ENUM('pendiente', 'enviado', 'ejecutado', 'error') NOT NULL DEFAULT 'pendiente',
  retorno VARCHAR(64) NULL,
  intentos TINYINT UNSIGNED NOT NULL DEFAULT 0,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  enviado_en DATETIME NULL,
  ejecutado_en DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_asist_comandos_cola (dispositivo_id, estado, id),
  CONSTRAINT fk_asist_comandos_dispositivo
    FOREIGN KEY (dispositivo_id) REFERENCES asist_dispositivos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- dias_semana: lunes a domingo, 1 = se espera asistencia. 1111100 = lun-vie.
CREATE TABLE IF NOT EXISTS asist_turnos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(80) NOT NULL,
  hora_entrada TIME NOT NULL,
  tolerancia_minutos SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  hora_salida TIME NOT NULL,
  dias_semana CHAR(7) NOT NULL DEFAULT '1111100',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_asist_turnos_activo (activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS asist_asignaciones (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  empleado_id INT UNSIGNED NOT NULL,
  turno_id INT UNSIGNED NOT NULL,
  vigente_desde DATE NOT NULL,
  vigente_hasta DATE NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_asist_asignaciones_inicio (empleado_id, vigente_desde),
  KEY idx_asist_asignaciones_vigencia (empleado_id, vigente_desde, vigente_hasta),
  CONSTRAINT fk_asist_asignaciones_empleado
    FOREIGN KEY (empleado_id) REFERENCES asist_empleados (id),
  CONSTRAINT fk_asist_asignaciones_turno
    FOREIGN KEY (turno_id) REFERENCES asist_turnos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS asist_resultados (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empleado_id INT UNSIGNED NOT NULL,
  fecha DATE NOT NULL,
  turno_id INT UNSIGNED NULL,
  marcacion_entrada_id BIGINT UNSIGNED NULL,
  marcacion_salida_id BIGINT UNSIGNED NULL,
  hora_entrada_real DATETIME NULL,
  hora_salida_real DATETIME NULL,
  estado ENUM('a_tiempo', 'tardanza', 'falta', 'sin_turno', 'feriado') NOT NULL,
  minutos_tarde INT UNSIGNED NOT NULL DEFAULT 0,
  calculado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_asist_resultados_dia (empleado_id, fecha),
  KEY idx_asist_resultados_fecha (fecha, estado),
  CONSTRAINT fk_asist_resultados_empleado
    FOREIGN KEY (empleado_id) REFERENCES asist_empleados (id),
  CONSTRAINT fk_asist_resultados_turno
    FOREIGN KEY (turno_id) REFERENCES asist_turnos (id) ON DELETE SET NULL,
  CONSTRAINT fk_asist_resultados_entrada
    FOREIGN KEY (marcacion_entrada_id) REFERENCES asist_marcaciones (id) ON DELETE SET NULL,
  CONSTRAINT fk_asist_resultados_salida
    FOREIGN KEY (marcacion_salida_id) REFERENCES asist_marcaciones (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS asist_usuarios (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario VARCHAR(60) NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  clave_hash VARCHAR(200) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_asist_usuarios_usuario (usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS asist_sesiones (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expira_en DATETIME NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_asist_sesiones_token (token_hash),
  KEY idx_asist_sesiones_expira (expira_en),
  CONSTRAINT fk_asist_sesiones_usuario
    FOREIGN KEY (usuario_id) REFERENCES asist_usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS asist_webhooks (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(80) NOT NULL,
  url VARCHAR(500) NOT NULL,
  secreto VARCHAR(120) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  ultimo_http SMALLINT NULL,
  ultimo_envio DATETIME NULL,
  ultimo_error VARCHAR(255) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS asist_feriados (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  fecha DATE NOT NULL,
  descripcion VARCHAR(150) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_asist_feriados_fecha (fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bases ya creadas: agrega el estado feriado sin tocar filas existentes.
ALTER TABLE asist_resultados
  MODIFY estado ENUM('a_tiempo', 'tardanza', 'falta', 'sin_turno', 'feriado') NOT NULL;
