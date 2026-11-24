import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base './' faz o site funcionar em qualquer caminho do GitHub Pages
// (usuario.github.io/Sabor-de-Cuidado/) e também em domínio próprio.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { include: ['src/**/*.test.ts'] },
});
