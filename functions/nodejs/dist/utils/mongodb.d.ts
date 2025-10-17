import { MongoClient, Db } from 'mongodb';
declare function getSecret(secretName: string): Promise<string>;
export declare function connectToDatabase(): Promise<{
    client: MongoClient;
    db: Db;
}>;
export { getSecret };
