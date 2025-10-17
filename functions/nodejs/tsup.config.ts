import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'getAllTransactions': 'api/getAllTransactions/index.ts',
  },
  format: ['cjs'],
  target: 'node20',
  outDir: 'dist-bundle',
  bundle: true,
  clean: true,
  sourcemap: false,
  minify: false,
  external: ['@google-cloud/functions-framework'],
  noExternal: ['mongodb', '@google-cloud/secret-manager'],
});
