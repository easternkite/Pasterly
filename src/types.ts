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
export type StorageType = 'firebase' | 'gcs' | 's3' | 'r2';

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

    // S3-compatible settings
    s3BucketName: string;
    s3Region: string;
    s3Endpoint: string;
    s3AccessKeyId: string;
    s3SecretAccessKey: string;
    s3SessionToken: string;
    s3PublicBaseUrl: string;
    s3ForcePathStyle: boolean;

    // Cloudflare R2 settings
    r2AccountId: string;
    r2BucketName: string;
    r2AccessKeyId: string;
    r2SecretAccessKey: string;
    r2PublicBaseUrl: string;
}

export const DEFAULT_SETTINGS: PasterlySettings = {
    storageType: 'firebase',
    imageSize: 0,
    firebaseBucketUrl: '',
    gcsAccessToken: '',
    gcsBucketName: '',
    gcsCdnBaseUrl: '',
    gcsUseGcloudCli: true,
    s3BucketName: '',
    s3Region: 'us-east-1',
    s3Endpoint: '',
    s3AccessKeyId: '',
    s3SecretAccessKey: '',
    s3SessionToken: '',
    s3PublicBaseUrl: '',
    s3ForcePathStyle: false,
    r2AccountId: '',
    r2BucketName: '',
    r2AccessKeyId: '',
    r2SecretAccessKey: '',
    r2PublicBaseUrl: '',
};
