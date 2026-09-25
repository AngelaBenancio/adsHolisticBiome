import { useState, type FormEvent } from 'react';
import { ingresar, leerAvisoSesion, useSesion } from '../sesion';
import { Aviso, Boton, Campo, Panel } from '../components/ui';

export function Acceso() {
  const { entrar } = useSesion();
  const [usuario, setUsuario] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [error, setError] = useState(() => leerAvisoSesion());
  const [ocupado, setOcupado] = useState(false);

  async function conectar(evento: FormEvent) {
    evento.preventDefault();
    setError('');
    setOcupado(true);
    try {
      entrar(await ingresar(usuario.trim(), contrasena));
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo iniciar sesión');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <p className="text-center text-sm font-bold uppercase tracking-[0.18em] text-pine">Asistencias</p>
        <h1 className="mt-3 text-center font-display text-4xl leading-tight">Ingresar al panel</h1>
        <p className="mt-2 text-center text-mist">Usa tu usuario y contraseña de oficina.</p>
        <Panel className="mt-6 p-6">
          <form className="space-y-4" onSubmit={conectar}>
            <Campo
              etiqueta="Usuario"
              autoComplete="username"
              value={usuario}
              onChange={(evento) => setUsuario(evento.target.value)}
              required
            />
            <Campo
              etiqueta="Contraseña"
              type="password"
              autoComplete="current-password"
              minLength={8}
              value={contrasena}
              onChange={(evento) => setContrasena(evento.target.value)}
              required
            />
            {error ? <Aviso texto={error} /> : null}
            <Boton type="submit" disabled={ocupado} className="w-full">
              {ocupado ? 'Ingresando…' : 'Entrar'}
            </Boton>
          </form>
        </Panel>
      </div>
    </div>
  );
}
