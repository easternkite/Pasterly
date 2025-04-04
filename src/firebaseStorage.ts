import { initializeApp, getApp } from 'firebase/app';
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

/**
 * Firebase Storage integration class
 * Handles file uploads to Firebase Storage with a specified bucket
 */
export class FirebaseStorage {
    /**
     * Firebase configuration object
     * Should be populated with your Firebase project settings
     */
    private readonly firebaseConfig = {
        
    };

    private readonly app;
    private readonly storage;

    /**
     * Initializes Firebase Storage with the specified bucket URL
     * If Firebase is already initialized, reuses the existing instance
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

    /**
     * Generates a unique filename for the uploaded image
     * Combines timestamp and random string to prevent naming conflicts
     * @param originalName - Original filename of the image
     * @returns A unique filename with the original extension
     */
    private generateUniqueFileName(originalName: string): string {
        const timestamp = new Date().getTime();
        const randomString = Math.random().toString(36).substring(2, 8);
        const extension = originalName.split('.').pop();
        return `image_${timestamp}_${randomString}.${extension}`;
    }

    /**
     * Uploads an image file to Firebase Storage
     * @param file - The image file to upload
     * @returns Promise that resolves to the public URL of the uploaded image
     * @throws Error with a descriptive message if upload fails
     */
    public async uploadImage(file: File): Promise<string> {
        const fileName = this.generateUniqueFileName(file.name);
        const imageRef = ref(this.storage, `pasterly/${fileName}`);
        
        return uploadBytes(imageRef, file)
            .then((snapshot) => getDownloadURL(snapshot.ref))
            .catch(() => Promise.reject('Failed to upload image. Please check your Firebase Storage settings.'));
    }
}
