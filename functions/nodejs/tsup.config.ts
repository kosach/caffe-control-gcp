import { defineConfig } from 'tsup';
import fs from 'fs';
import path from 'path';

const functions = ['getAllTransactions', 'webhook', 'syncTransactions'];

export default defineConfig({
  entry: {
    'getAllTransactions': 'api/getAllTransactions/index.ts',
    'webhook': 'api/webhook/index.ts',
    'syncTransactions': 'api/syncTransactions/index.ts'
  },
  format: ['cjs'],
  target: 'node20',
  outDir: 'dist-bundle',
  bundle: true,
  clean: true,
  sourcemap: false,
  minify: false,
  external: ['@google-cloud/functions-framework', '@google-cloud/firestore'],
  noExternal: ['mongodb', '@google-cloud/secret-manager', 'axios'],
  onSuccess: async () => {
    // Create separate directories for each function
    functions.forEach(functionName => {
      const functionDir = path.join(__dirname, 'dist-bundle', functionName);

      // Create function directory if it doesn't exist
      if (!fs.existsSync(functionDir)) {
        fs.mkdirSync(functionDir, { recursive: true });
      }

      // Copy bundled file to function directory as index.js
      const sourceFile = path.join(__dirname, 'dist-bundle', `${functionName}.js`);
      const targetFile = path.join(functionDir, 'index.js');
      fs.copyFileSync(sourceFile, targetFile);

      // Create package.json for this function
      const packageJson = {
        name: `caffe-control-${functionName.toLowerCase()}`,
        version: '1.0.0',
        main: 'index.js',
        type: 'commonjs',
        engines: {
          node: '20'
        },
        dependencies: {
          '@google-cloud/firestore': '^7.11.0'
        }
      };

      fs.writeFileSync(
        path.join(functionDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      console.log(`✅ ${functionName} package created`);
    });
  }
});
