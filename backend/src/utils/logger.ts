import fs from 'fs';
import path from 'path';
import { formatLima } from './datetime';

const directorio = path.resolve(process.cwd(), 'logs');
fs.mkdirSync(directorio, { recursive: true });

function serializar(meta: unknown): string {
  if (meta === undefined) return '';
  if (meta instanceof Error) {
    return `${meta.name}: ${meta.message}${meta.stack ? `\n${meta.stack}` : ''}`;
  }
  try {
    return JSON.stringify(meta, (_clave, valor: unknown) => {
      if (valor instanceof Error) {
        return { nombre: valor.name, mensaje: valor.message, pila: valor.stack };
      }
      return valor;
    });
  } catch {
    return String(meta);
  }
}

function escribir(archivo: string, texto: string): void {
  fs.appendFile(path.join(directorio, archivo), texto, (error) => {
    if (error) {
      console.error('No se pudo escribir el log', error);
    }
  });
}

function emitir(nivel: 'INFO' | 'ERROR', mensaje: string, meta: unknown, archivo: string): void {
  const extra = serializar(meta);
  const linea = `${formatLima()} [${nivel}] ${mensaje}${extra ? ` ${extra}` : ''}\n`;
  escribir(archivo, linea);
  if (nivel === 'ERROR') {
    console.error(linea.trimEnd());
    return;
  }
  console.log(linea.trimEnd());
}

export const logger = {
  info(mensaje: string, meta?: unknown): void {
    emitir('INFO', mensaje, meta, 'zk_adms.log');
  },
  adms(mensaje: string, meta?: unknown): void {
    emitir('INFO', mensaje, meta, 'zk_adms.log');
  },
  error(mensaje: string, meta?: unknown): void {
    emitir('ERROR', mensaje, meta, 'error.log');
    escribir('zk_adms.log', `${formatLima()} [ERROR] ${mensaje}${meta === undefined ? '' : ` ${serializar(meta)}`}\n`);
  },
};
