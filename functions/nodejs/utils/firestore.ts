import { Firestore } from '@google-cloud/firestore';

let cachedFirestore: Firestore | null = null;

/**
 * Get Firestore instance with connection caching
 * Uses default credentials from GCP environment
 */
export function getFirestore(): Firestore {
  if (!cachedFirestore) {
    cachedFirestore = new Firestore({
      projectId: process.env.GCP_PROJECT_ID || 'caffe-control-prod'
    });
  }
  return cachedFirestore;
}
