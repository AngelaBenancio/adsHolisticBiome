import { useEffect, useState, type FormEvent } from 'react';
import { consultar } from '../sesion';
import type { Comando, Dispositivo, Webhook } from '../types';
import { Aviso, Boton, Campo, Panel, Seleccion } from '../components/ui';

export function Reloj() {
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]);
  const [comandos, setComandos] = useState<Comando[]>([]);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [sn, setSn] = useState('');
  const [comando, setComando] = useState('INFO');
  const [nombreHook, setNombreHook] = useState('Hecom Club');
  const [urlHook, setUrlHook] = useState('');
  const [secretoHook, setSecretoHook] = useState('');
  const [error, setError] = useState('');

  async function cargar() {
    const [relojes, ordenes, destinos] = await Promise.all([
      consultar<{ datos: Dispositivo[] }>('/api/dispositivos'),
      consultar<{ datos: Comando[] }>('/api/comandos?limite=20'),
      consultar<{ datos: Webhook[] }>('/api/webhooks'),
    ]);
    setDispositivos(relojes.datos);
    setComandos(ordenes.datos);
    setWebhooks(destinos.datos);
    setSn((actual) => actual || relojes.datos[0]?.sn || '');
  }

  useEffect(() => {
    cargar().catch((fallo: unknown) => setError(fallo instanceof Error ? fallo.message : 'No se pudo leer el reloj'));
  }, []);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (comando.trim().toUpperCase() === 'REBOOT' && !window.confirm('El reloj se reiniciará. ¿Continuar?')) return;
    setError('');
    try {
      await consultar('/api/comandos', { method: 'POST', body: JSON.stringify({ sn, comando }) });
      await cargar();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo encolar el comando');
    }
  }

  async function guardarHook(evento: FormEvent) {
    evento.preventDefault();
    setError('');
    try {
      await consultar('/api/webhooks', {
        method: 'POST',
        body: JSON.stringify({ nombre: nombreHook, url: urlHook, secreto: secretoHook }),
      });
      setSecretoHook('');
      await cargar();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo guardar el destino');
    }
  }

  async function quitarHook(id: number) {
    setError('');
    try {
      await consultar(`/api/webhooks/${id}`, { method: 'DELETE' });
      await cargar();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo quitar el destino');
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-mist">ADMS</p>
        <h1 className="font-display text-4xl">Reloj</h1>
      </header>
      {error ? <Aviso texto={error} /> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-4">
          <h2 className="mb-3 font-display text-2xl">Conexión</h2>
          <ul className="space-y-3">
            {dispositivos.map((dispositivo) => (
              <li key={dispositivo.id} className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{dispositivo.alias ?? dispositivo.sn}</p>
                  <p className="text-sm text-mist">{dispositivo.sn} · {dispositivo.ip_origen ?? 'sin IP'}</p>
                  <p className="text-sm text-mist">Último contacto {dispositivo.ultima_conexion ?? 'nunca'}</p>
                </div>
                <span className={`mt-1 h-3 w-3 rounded-full ${dispositivo.en_linea ? 'bg-pine' : 'bg-stone-300'}`} />
              </li>
            ))}
            {!error && dispositivos.length === 0 ? <li className="text-mist">Ningún reloj se ha presentado todavía.</li> : null}
          </ul>
        </Panel>
        <Panel className="p-4">
          <h2 className="mb-3 font-display text-2xl">Comando remoto</h2>
          <form className="space-y-3" onSubmit={enviar}>
            <Seleccion etiqueta="Reloj" value={sn} onChange={(evento) => setSn(evento.target.value)}>
              {dispositivos.map((dispositivo) => (
                <option key={dispositivo.id} value={dispositivo.sn}>{dispositivo.alias ?? dispositivo.sn}</option>
              ))}
            </Seleccion>
            <Campo etiqueta="Comando" value={comando} onChange={(evento) => setComando(evento.target.value)} required />
            <div className="flex gap-2">
              {['INFO', 'CHECK', 'REBOOT'].map((atajo) => (
                <Boton key={atajo} type="button" variante="secundario" onClick={() => setComando(atajo)}>{atajo}</Boton>
              ))}
            </div>
            <Boton type="submit">Encolar</Boton>
          </form>
          <ul className="mt-4 space-y-2 text-sm">
            {comandos.map((orden) => (
              <li key={orden.id} className="flex justify-between gap-3 border-t border-line pt-2">
                <span>{orden.comando}</span>
                <span className="text-mist">{orden.estado}{orden.retorno ? ` · ${orden.retorno}` : ''}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel className="p-4">
        <h2 className="font-display text-2xl">Destino en tiempo real</h2>
        <p className="mb-4 max-w-2xl text-sm text-mist">
          Cada marcación nueva se envía por POST a esta URL, con la cabecera X-Webhook-Secret. Sirve para Hecom Club u otro servicio en Vercel.
        </p>
        <form className="grid gap-3 md:grid-cols-4" onSubmit={guardarHook}>
          <Campo etiqueta="Nombre" value={nombreHook} onChange={(evento) => setNombreHook(evento.target.value)} required />
          <Campo etiqueta="URL" value={urlHook} onChange={(evento) => setUrlHook(evento.target.value)} placeholder="https://….vercel.app/api/marcaciones" required />
          <Campo etiqueta="Secreto" type="password" value={secretoHook} onChange={(evento) => setSecretoHook(evento.target.value)} required />
          <div className="flex items-end"><Boton type="submit">Agregar</Boton></div>
        </form>
        <ul className="mt-4 space-y-2 text-sm">
          {webhooks.map((hook) => (
            <li key={hook.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
              <div>
                <p className="font-semibold">{hook.nombre}</p>
                <p className="text-mist">{hook.url}</p>
                <p className="text-mist">
                  {hook.ultimo_envio ? `Último envío ${hook.ultimo_envio}` : 'Sin envíos'}
                  {hook.ultimo_http ? ` · HTTP ${hook.ultimo_http}` : ''}
                  {hook.ultimo_error ? ` · ${hook.ultimo_error}` : ''}
                </p>
              </div>
              <Boton variante="secundario" onClick={() => quitarHook(hook.id)}>Quitar</Boton>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
