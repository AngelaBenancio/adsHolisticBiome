export type EstadoAsistencia = 'a_tiempo' | 'tardanza' | 'falta' | 'sin_turno' | 'feriado';

export interface Paginacion {
  pagina: number;
  limite: number;
  total: number;
  paginas: number;
}

export interface Turno {
  id: number;
  nombre: string;
  hora_entrada: string;
  tolerancia_minutos: number;
  hora_salida: string;
  dias_semana: string;
  activo: boolean;
}

export interface TurnoAsignado {
  id: number;
  nombre: string;
  hora_entrada: string;
  tolerancia_minutos: number;
  hora_salida: string;
  dias_semana: string;
  vigente_desde: string;
  vigente_hasta: string | null;
}

export interface Empleado {
  id: number;
  pin: string;
  nombre: string;
  activo: boolean;
  origen: string;
  turno: TurnoAsignado | null;
}

export interface ResultadoAsistencia {
  id: number;
  fecha: string;
  estado: EstadoAsistencia;
  minutos_tarde: number;
  hora_entrada_real: string | null;
  hora_salida_real: string | null;
  empleado: { id: number; pin: string; nombre: string };
  turno: { id: number; nombre: string; hora_entrada: string; tolerancia_minutos: number; hora_salida: string } | null;
}

export interface Resumen {
  fecha: string;
  a_tiempo: number;
  tardanza: number;
  falta: number;
  sin_turno: number;
  feriado: number;
  marcaciones: number;
  dispositivos: number;
  dispositivos_en_linea: number;
  alertas: ResultadoAsistencia[];
}

export interface Dispositivo {
  id: number;
  sn: string;
  alias: string | null;
  ip_origen: string | null;
  ultima_conexion: string | null;
  en_linea: boolean;
}

export interface Marcacion {
  id: number;
  pin: string;
  empleado: string;
  fecha_hora: string;
  tipo_evento_nombre: string;
  metodo_verificacion_nombre: string;
  dispositivo: { sn: string; alias: string | null };
}

export interface Comando {
  id: number;
  sn: string;
  comando: string;
  estado: string;
  retorno: string | null;
  creado_en: string;
}

export interface Feriado {
  id: number;
  fecha: string;
  descripcion: string;
}

export interface Webhook {
  id: number;
  nombre: string;
  url: string;
  activo: boolean;
  ultimo_http: number | null;
  ultimo_envio: string | null;
  ultimo_error: string | null;
}

export const ETIQUETA_ESTADO: Record<EstadoAsistencia, string> = {
  a_tiempo: 'A tiempo',
  tardanza: 'Tardanza',
  falta: 'Falta',
  sin_turno: 'Sin turno',
  feriado: 'Feriado',
};

export const DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;
