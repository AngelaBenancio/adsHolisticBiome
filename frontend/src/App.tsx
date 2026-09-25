import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Acceso } from './pages/Acceso';
import { Asistencia } from './pages/Asistencia';
import { Empleados } from './pages/Empleados';
import { Feriados } from './pages/Feriados';
import { Hoy } from './pages/Hoy';
import { Reloj } from './pages/Reloj';
import { Turnos } from './pages/Turnos';
import { useSesion } from './sesion';

export function App() {
  const { sesion } = useSesion();
  if (!sesion) return <Acceso />;
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Hoy />} />
        <Route path="/asistencia" element={<Asistencia />} />
        <Route path="/empleados" element={<Empleados />} />
        <Route path="/turnos" element={<Turnos />} />
        <Route path="/feriados" element={<Feriados />} />
        <Route path="/reloj" element={<Reloj />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
