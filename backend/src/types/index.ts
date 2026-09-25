export type OrigenEmpleado = 'marcacion' | 'userinfo' | 'biodata' | 'manual';

export type EstadoComando = 'pendiente' | 'enviado' | 'ejecutado' | 'error';

export interface MarcacionCruda {
  pin: string;
  fechaHora: string;
  tipoEvento: number;
  metodoVerificacion: number;
  codigoTrabajo: string | null;
}

export interface UsuarioCrudo {
  pin: string;
  nombre: string;
  privilegio: number;
  tarjeta: string | null;
  grupo: string | null;
}

export interface OpcionesDispositivo {
  alias?: string;
  firmware?: string;
  pushVersion?: string;
}

export type PaqueteParseado =
  | { tipo: 'descartado'; motivo: string }
  | { tipo: 'vacio' }
  | { tipo: 'opciones'; opciones: OpcionesDispositivo }
  | { tipo: 'attlog'; registros: MarcacionCruda[] }
  | { tipo: 'usuarios'; origen: Exclude<OrigenEmpleado, 'manual' | 'marcacion'>; usuarios: UsuarioCrudo[] };

export interface ResultadoComando {
  id: number;
  retorno: string;
}

export interface EstadisticasIngreso {
  recibidas: number;
  insertadas: number;
  duplicadas: number;
  ignoradas: number;
}

export interface RegistroDispositivo {
  sn: string;
  ip: string;
  alias?: string;
  firmware?: string;
  pushVersion?: string;
}

export interface DispositivoApi {
  id: number;
  sn: string;
  alias: string | null;
  ip_origen: string | null;
  firmware: string | null;
  push_version: string | null;
  ultima_conexion: string | null;
  en_linea: boolean;
}

export type EstadoAsistencia = 'a_tiempo' | 'tardanza' | 'falta' | 'sin_turno' | 'feriado';

export interface TurnoApi {
  id: number;
  nombre: string;
  hora_entrada: string;
  tolerancia_minutos: number;
  hora_salida: string;
  dias_semana: string;
  activo: boolean;
}

export interface TurnoAsignadoApi {
  id: number;
  nombre: string;
  hora_entrada: string;
  tolerancia_minutos: number;
  hora_salida: string;
  dias_semana: string;
  vigente_desde: string;
  vigente_hasta: string | null;
}

export interface EmpleadoApi {
  id: number;
  pin: string;
  nombre: string;
  privilegio: number;
  tarjeta: string | null;
  grupo: string | null;
  activo: boolean;
  origen: OrigenEmpleado;
  creado_en: string;
  actualizado_en: string;
  turno: TurnoAsignadoApi | null;
}

export interface ResultadoAsistenciaApi {
  id: number;
  fecha: string;
  estado: EstadoAsistencia;
  minutos_tarde: number;
  hora_entrada_real: string | null;
  hora_salida_real: string | null;
  empleado: {
    id: number;
    pin: string;
    nombre: string;
  };
  turno: {
    id: number;
    nombre: string;
    hora_entrada: string;
    tolerancia_minutos: number;
    hora_salida: string;
  } | null;
}

export interface WebhookApi {
  id: number;
  nombre: string;
  url: string;
  activo: boolean;
  ultimo_http: number | null;
  ultimo_envio: string | null;
  ultimo_error: string | null;
  creado_en: string;
}

export interface MarcacionApi {
  id: number;
  pin: string;
  empleado_id: number;
  empleado: string;
  fecha_hora: string;
  tipo_evento: number;
  tipo_evento_nombre: string;
  metodo_verificacion: number;
  metodo_verificacion_nombre: string;
  codigo_trabajo: string | null;
  creado_en: string;
  dispositivo: {
    id: number;
    sn: string;
    alias: string | null;
    ip_origen: string | null;
  };
}

export interface ComandoApi {
  id: number;
  dispositivo_id: number;
  sn: string;
  comando: string;
  estado: EstadoComando;
  retorno: string | null;
  intentos: number;
  creado_en: string;
  enviado_en: string | null;
  ejecutado_en: string | null;
}

export interface Paginacion {
  pagina: number;
  limite: number;
  total: number;
  paginas: number;
}
