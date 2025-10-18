require('dotenv').config({ path: '../../.env' });
const functions = require('@google-cloud/functions-framework');
const { getAllTransactions } = require('./dist-bundle/getAllTransactions');

functions.http('getAllTransactions', getAllTransactions);

console.log('🚀 Server starting on http://localhost:8080');
console.log('📝 Using MongoDB URI from .env');
