/**
 * Storage Provider Interface
 * Defines the contract for different storage backends (Firebase, GCS, etc.)
 */
export interface StorageProvider {
    /**
     * Uploads an image file to the storage backend
     * @param file - The image file to upload
     * @returns Promise that resolves to the public URL of the uploaded image
     */
    uploadImage(file: File): Promise<string>;
}

/**
 * Storage type enumeration
 */
export type StorageType = 'firebase' | 'gcs';

/**
 * Settings interface for the Pasterly plugin
 * Defines configuration options for storage integration
 */
export interface PasterlySettings {
    // Common settings
    storageType: StorageType;
    imageSize: number;

    // Firebase settings
    firebaseBucketUrl: string;

    // GCS settings
    gcsAccessToken: string;
    gcsBucketName: string;
    gcsCdnBaseUrl: string;      // CDN base URL (e.g., https://cdn.example.com)
    gcsUseGcloudCli: boolean;   // Use gcloud CLI for auto-auth
}

export const DEFAULT_SETTINGS: PasterlySettings = {
    storageType: 'firebase',
    imageSize: 0,
    firebaseBucketUrl: '',
    gcsAccessToken: '',
    gcsBucketName: '',
    gcsCdnBaseUrl: '',
    gcsUseGcloudCli: true
};
