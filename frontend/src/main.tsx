import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { SesionProvider } from './sesion';
import './index.css';

const raiz = document.getElementById('root');
if (!raiz) throw new Error('No existe #root');

createRoot(raiz).render(
  <StrictMode>
    <SesionProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </SesionProvider>
  </StrictMode>,
);
