"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectToDatabase = connectToDatabase;
exports.getSecret = getSecret;
const mongodb_1 = require("mongodb");
const secret_manager_1 = require("@google-cloud/secret-manager");
let cachedClient = null;
let cachedDb = null;
async function getSecret(secretName) {
    const client = new secret_manager_1.SecretManagerServiceClient();
    const projectId = process.env.GCP_PROJECT_ID || 'caffe-control-prod';
    const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;
    const [version] = await client.accessSecretVersion({ name });
    const payload = version.payload?.data;
    if (!payload) {
        throw new Error(`Secret ${secretName} is empty`);
    }
    return payload.toString();
}
async function connectToDatabase() {
    if (cachedClient && cachedDb) {
        return { client: cachedClient, db: cachedDb };
    }
    const uri = await getSecret('mongodb-uri');
    const client = new mongodb_1.MongoClient(uri);
    await client.connect();
    const db = client.db('easy-control');
    cachedClient = client;
    cachedDb = db;
    return { client, db };
}
