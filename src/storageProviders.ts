import { initializeApp, getApp, FirebaseApp } from 'firebase/app';
import { getStorage, ref, uploadBytes, getDownloadURL, FirebaseStorage as FBStorage } from "firebase/storage";
import { requestUrl } from 'obsidian';
import { StorageProvider } from './types';

/**
 * Firebase Storage Provider
 * Handles file uploads to Firebase Storage with a specified bucket
 */
export class FirebaseStorageProvider implements StorageProvider {
    private readonly firebaseConfig = {};
    private readonly app: FirebaseApp;
    private readonly storage: FBStorage;

    /**
     * Initializes Firebase Storage with the specified bucket URL
     * @param bucketUrl - The Firebase Storage bucket URL (e.g., gs://your-bucket.appspot.com)
     */
    constructor(bucketUrl: string) {
        try {
            this.app = getApp();
        } catch (e) {
            this.app = initializeApp(this.firebaseConfig);
        }
        this.storage = getStorage(this.app, bucketUrl);
    }

    private generateUniqueFileName(originalName: string): string {
        const timestamp = new Date().getTime();
        const randomString = Math.random().toString(36).substring(2, 8);
        const extension = originalName.split('.').pop();
        return `image_${timestamp}_${randomString}.${extension}`;
    }

    public async uploadImage(file: File): Promise<string> {
        const fileName = this.generateUniqueFileName(file.name);
        const imageRef = ref(this.storage, `pasterly/${fileName}`);

        return uploadBytes(imageRef, file)
            .then((snapshot) => getDownloadURL(snapshot.ref))
            .catch(() => Promise.reject('Failed to upload image. Please check your Firebase Storage settings.'));
    }
}

/**
 * Gets access token from gcloud CLI
 * Executes: gcloud auth print-access-token
 * Tries multiple common paths since GUI apps may not have the same PATH as terminal
 */
export async function getAccessTokenFromGcloud(): Promise<string> {
    const { exec } = require('child_process');

    // Common paths for gcloud on different systems
    const gcloudPaths = [
        '/opt/homebrew/bin/gcloud',           // macOS Apple Silicon (Homebrew)
        '/usr/local/bin/gcloud',               // macOS Intel (Homebrew)
        '/usr/bin/gcloud',                     // Linux system
        '/snap/bin/gcloud',                    // Linux snap
        'gcloud'                               // Fallback to PATH
    ];

    return new Promise((resolve, reject) => {
        const tryGcloudPath = (index: number) => {
            if (index >= gcloudPaths.length) {
                reject(new Error('gcloud CLI not found. Please install Google Cloud SDK.'));
                return;
            }

            const gcloudPath = gcloudPaths[index];
            exec(`${gcloudPath} auth print-access-token`, (error: Error | null, stdout: string, stderr: string) => {
                if (error) {
                    // Try next path
                    tryGcloudPath(index + 1);
                    return;
                }
                const token = stdout.trim();
                if (!token) {
                    reject(new Error('Empty access token returned from gcloud CLI'));
                    return;
                }
                resolve(token);
            });
        };

        tryGcloudPath(0);
    });
}

/**
 * Google Cloud Storage Provider
 * Handles file uploads to GCS using OAuth2 Access Token authentication
 */
export class GCSStorageProvider implements StorageProvider {
    private readonly bucketName: string;
    private readonly accessToken: string | null;
    private readonly cdnBaseUrl: string | null;
    private readonly useGcloudCli: boolean;

    /**
     * Initializes GCS Storage with bucket name and auth config
     * @param bucketName - The GCS bucket name (without gs:// prefix)
     * @param accessToken - OAuth2 access token (optional if using gcloud CLI)
     * @param cdnBaseUrl - CDN base URL for returned image URLs (optional)
     * @param useGcloudCli - Whether to use gcloud CLI for auto-auth
     */
    constructor(bucketName: string, accessToken: string | null, cdnBaseUrl: string | null = null, useGcloudCli: boolean = false) {
        this.bucketName = bucketName;
        this.accessToken = accessToken;
        this.cdnBaseUrl = cdnBaseUrl;
        this.useGcloudCli = useGcloudCli;
    }

    private generateUniqueFileName(originalName: string): string {
        const timestamp = new Date().getTime();
        const randomString = Math.random().toString(36).substring(2, 8);
        const extension = originalName.split('.').pop() || 'png';
        return `image_${timestamp}_${randomString}.${extension}`;
    }

    /**
     * Converts a File to ArrayBuffer for upload
     */
    private async fileToArrayBuffer(file: File): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsArrayBuffer(file);
        });
    }

    /**
     * Gets the access token - either from stored value or gcloud CLI
     */
    private async getToken(): Promise<string> {
        if (this.useGcloudCli) {
            return getAccessTokenFromGcloud();
        }
        if (!this.accessToken) {
            throw new Error('No access token provided and gcloud CLI is disabled');
        }
        return this.accessToken;
    }

    public async uploadImage(file: File): Promise<string> {
        const fileName = this.generateUniqueFileName(file.name);
        const objectPath = `pasterly/${fileName}`;

        // GCS JSON API upload endpoint
        const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucketName)}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`;

        try {
            const token = await this.getToken();
            const arrayBuffer = await this.fileToArrayBuffer(file);

            const response = await requestUrl({
                url: uploadUrl,
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': file.type || 'image/png',
                },
                body: arrayBuffer,
            });

            if (response.status >= 200 && response.status < 300) {
                // Return CDN URL if configured, otherwise GCS public URL
                if (this.cdnBaseUrl) {
                    const cdnUrl = this.cdnBaseUrl.replace(/\/$/, ''); // Remove trailing slash
                    return `${cdnUrl}/${objectPath}`;
                }
                return `https://storage.googleapis.com/${this.bucketName}/${objectPath}`;
            } else {
                throw new Error(`Upload failed with status ${response.status}`);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to upload to GCS: ${message}. Check your access token and bucket permissions.`);
        }
    }
}

/**
 * Factory function to create the appropriate storage provider
 */
export function createStorageProvider(
    type: 'firebase' | 'gcs',
    config: {
        firebaseBucketUrl?: string;
        gcsBucketName?: string;
        gcsAccessToken?: string;
        gcsCdnBaseUrl?: string;
        gcsUseGcloudCli?: boolean;
    }
): StorageProvider {
    switch (type) {
        case 'firebase':
            if (!config.firebaseBucketUrl) {
                throw new Error('Firebase bucket URL is required');
            }
            return new FirebaseStorageProvider(config.firebaseBucketUrl);

        case 'gcs':
            if (!config.gcsBucketName) {
                throw new Error('GCS bucket name is required');
            }
            // When using gcloud CLI, access token is not required
            if (!config.gcsUseGcloudCli && !config.gcsAccessToken) {
                throw new Error('GCS access token is required when gcloud CLI is disabled');
            }
            return new GCSStorageProvider(
                config.gcsBucketName,
                config.gcsAccessToken || null,
                config.gcsCdnBaseUrl || null,
                config.gcsUseGcloudCli || false
            );

        default:
            throw new Error(`Unknown storage type: ${type}`);
    }
}
