import { MongoClient, Db } from 'mongodb';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

async function getSecret(secretName: string): Promise<string> {
  const client = new SecretManagerServiceClient();
  const projectId = process.env.GCP_PROJECT_ID || 'caffe-control-prod';
  const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;
  
  const [version] = await client.accessSecretVersion({ name });
  const payload = version.payload?.data;
  
  if (!payload) {
    throw new Error(`Secret ${secretName} is empty`);
  }
  
  return payload.toString();
}

export async function connectToDatabase(): Promise<{ client: MongoClient; db: Db }> {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  const uri = await getSecret('mongodb-uri');
  const client = new MongoClient(uri);
  
  await client.connect();
  const db = client.db('easy-control');
  
  cachedClient = client;
  cachedDb = db;
  
  return { client, db };
}

export { getSecret };
