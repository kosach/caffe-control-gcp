import { defineConfig } from 'tsup';
import fs from 'fs';
import path from 'path';

export default defineConfig({
  entry: {
    'getAllTransactions': 'api/getAllTransactions/index.ts',
    'webhook': 'api/webhook/index.ts'
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
  onSuccess: async () => {
    // Create package.json after build
    const packageJson = {
      name: 'caffe-control-functions-bundle',
      version: '1.0.0',
      main: 'getAllTransactions.js',
      exports: {
        './getAllTransactions': './getAllTransactions.js',
        './webhook': './webhook.js'
      },
      type: 'commonjs',
      engines: {
        node: '20'
      }
    };
    
    fs.writeFileSync(
      path.join(__dirname, 'dist-bundle/package.json'),
      JSON.stringify(packageJson, null, 2)
    );
    
    console.log('✅ package.json created');
  }
});
