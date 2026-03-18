import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Explicitly include dependencies to pre-bundle, resolving the Vite warning
    include: ['react', 'react-dom', 'lucide-react', 'axios']
  }
});