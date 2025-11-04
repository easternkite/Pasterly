import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { FirebaseStorage } from './firebaseStorage';

/**
 * Settings interface for the Pasterly plugin
 * Defines configuration options for Firebase integration
 */
interface PasterlySettings {
	firebaseBucketUrl: string;
	imageSize: number;
}

const DEFAULT_SETTINGS: PasterlySettings = {
	firebaseBucketUrl: '',
	imageSize: 0
}

/**
 * Creates a temporary placeholder in the editor while an image is being uploaded
 * @param editor - The Obsidian editor instance
 * @returns Object containing the placeholder text and cursor position
 */
const createPlaceholder = (editor: Editor) => {
	const placeholder = '![Uploading...]()';
	const cursor = editor.getCursor();
	editor.replaceSelection(placeholder);
	return { placeholder, cursor };
};

/**
 * Replaces the temporary placeholder with the final content (uploaded image URL or empty string)
 * @param editor - The Obsidian editor instance
 * @param placeholder - The placeholder text to replace
 * @param cursor - The cursor position where the placeholder was inserted
 * @param content - The content to replace the placeholder with
 */
const replacePlaceholder = (editor: Editor, placeholder: string, cursor: { line: number, ch: number }, content: string) => {
	const start = { line: cursor.line, ch: cursor.ch };
	const end = { line: cursor.line, ch: cursor.ch + placeholder.length };
	editor.replaceRange(content, start, end);
};

/**
 * Attaches an image to the editor
 * @param imageUrl - The URL of the image to attach
 * @param hasFixedSize - Whether the image has a fixed size
 * @param size - The size of the image
 * @returns The image tag to attach to the editor
 */
const attachImage = (imageUrl: string, hasFixedSize: boolean, size: number) => {
	if (!hasFixedSize) {
		return `![](${imageUrl})`
	}

	return `\n<img src="${imageUrl}" width="${size}"/>\n`;
}

/**
 * Higher-order function for handling asynchronous operations with error handling
 * @param fn - The async function to execute
 * @param onError - Callback function to handle errors
 * @returns Promise that resolves to the result or null if an error occurred
 */
const withErrorHandling = async <T>(
	fn: () => Promise<T>,
	onError: (error: Error) => void
): Promise<T | null> => {
	try {
		return await fn();
	} catch (error) {
		onError(error as Error);
		return null;
	}
};

/**
 * Main plugin class for Pasterly
 * Handles image uploads from clipboard to Firebase Storage
 */
export default class Pasterly extends Plugin {
	settings: PasterlySettings;
	private firebaseStorage: FirebaseStorage | null = null;
	private initializeTimeout: number | null = null;

	/**
	 * Initializes Firebase Storage with the configured bucket URL
	 * Shows a notice if the bucket URL is not set
	 */
	async initializeFirebase() {
		if (!this.settings.firebaseBucketUrl) {
			new Notice('Please set your Firebase Storage bucket URL in settings first.');
			return;
		}
		this.firebaseStorage = new FirebaseStorage(this.settings.firebaseBucketUrl);
	}

	/**
	 * Debounced version of initializeFirebase to prevent rapid reinitializations
	 * Waits 500ms before reinitializing Firebase Storage
	 */
	public debouncedInitializeFirebase = () => {
		if (this.initializeTimeout) {
			window.clearTimeout(this.initializeTimeout);
		}
		this.initializeTimeout = window.setTimeout(() => {
			this.initializeFirebase();
			this.initializeTimeout = null;
		}, 500);
	};

	/**
	 * Handles the image upload process
	 * Creates a placeholder, uploads the image, and replaces the placeholder with the result
	 * @param file - The image file to upload
	 * @param editor - The Obsidian editor instance
	 * @returns Promise that resolves to the uploaded image URL or null if upload failed
	 */
	handleImageUpload = async (file: File, editor: Editor) => {
		const storage = this.firebaseStorage;
		if (!storage) {
			new Notice('Firebase Storage is not initialized. Please check your settings.');
			return null;
		}

		const { placeholder, cursor } = createPlaceholder(editor);

		const result = await withErrorHandling(
			async () => {
				const imageUrl = await storage.uploadImage(file);
				const size = this.settings.imageSize;
				const hasFixedSize = size > 1;
				const imageTag = attachImage(imageUrl, hasFixedSize, size);
				replacePlaceholder(editor, placeholder, cursor, imageTag);
				new Notice('Image uploaded successfully');
				return imageUrl;
			},
			(error) => {
				replacePlaceholder(editor, placeholder, cursor, '');
				new Notice(error.message || 'Failed to upload image. Please check your Firebase settings');
				console.error('Image upload error:', error);
			}
		);

		return result;
	};

	/**
	 * Plugin initialization
	 * Loads settings and sets up clipboard event listener for image uploads
	 */
	async onload() {
		await this.loadSettings();
		await this.initializeFirebase();

		this.registerEvent(
			this.app.workspace.on('editor-paste', async (evt: ClipboardEvent, editor: Editor) => {
				const lastItem = evt.clipboardData?.items[evt.clipboardData.items.length - 1];
				if (!lastItem?.type.startsWith('image/')) return;

				if (!navigator.onLine) {
					// Allow default paste behavior when offline
					return;
				}

				evt.preventDefault();
				const file = lastItem.getAsFile();
				if (!file) return;

				await this.handleImageUpload(file, editor);
			})
		);

		this.addSettingTab(new PasterlySettingTab(this.app, this));
	}

	onunload() {
		if (this.initializeTimeout !== null) {
			window.clearTimeout(this.initializeTimeout);
			this.initializeTimeout = null;
		}
	}

	/**
	 * Loads plugin settings from storage
	 */
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	/**
	 * Saves plugin settings to storage
	 */
	async saveSettings() {
		await this.saveData(this.settings);
	}
}

/**
 * Settings tab for the Pasterly plugin
 * Allows users to configure the Firebase Storage bucket URL
 * 
 * Includes a toggle to enable/disable fixed size and a text input for the image size
 */
class PasterlySettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: Pasterly) {
		super(app, plugin);
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Firebase Storage Bucket URL')
			.setDesc('URL of your Firebase Storage bucket (e.g., gs://your-bucket.appspot.com)')
			.addText(text => text
				.setPlaceholder('gs://your-bucket.appspot.com')
				.setValue(this.plugin.settings.firebaseBucketUrl)
				.onChange(async (value) => {
					this.plugin.settings.firebaseBucketUrl = value;
					await this.plugin.saveSettings();
					this.plugin.debouncedInitializeFirebase();
				}));
	
		new Setting(containerEl)
			.setName('Fixed Size')
			.setDesc('Size of the image to attach to the editor (0 for no fixed size)')
			.addText(text => {
				text
					.setValue(this.plugin.settings.imageSize.toString())
					.onChange(async (value) => {
						const num = Number(value);
						if (isNaN(num)) return;

						this.plugin.settings.imageSize = num;
						await this.plugin.saveSettings();
					})
					
				text.inputEl.type = "number";
			})
	
	}
}
