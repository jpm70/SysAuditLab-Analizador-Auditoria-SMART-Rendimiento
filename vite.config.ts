import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Política de seguridad de contenidos solo en la build publicada (en desarrollo
// rompería el HMR de Vite). La app no hace peticiones de red: connect-src 'none'.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const cspPlugin = (): Plugin => ({
  name: 'sysauditlab-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

// base relativa: la misma build sirve en la raíz y en
// https://unfantasmaenelsistema.github.io/SysAuditLab-Analizador-Auditoria-SMART-Rendimiento/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), cspPlugin()],
});
