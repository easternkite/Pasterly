import { App, Editor, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { createStorageProvider } from './storageProviders';
import { StorageProvider, PasterlySettings, DEFAULT_SETTINGS } from './types';

/**
 * Creates a temporary placeholder in the editor while an image is being uploaded
 */
const createPlaceholder = (editor: Editor) => {
	const placeholder = '![Uploading...]()';
	const cursor = editor.getCursor();
	editor.replaceSelection(placeholder);
	return { placeholder, cursor };
};

/**
 * Replaces the temporary placeholder with the final content
 */
const replacePlaceholder = (editor: Editor, placeholder: string, cursor: { line: number, ch: number }, content: string) => {
	const start = { line: cursor.line, ch: cursor.ch };
	const end = { line: cursor.line, ch: cursor.ch + placeholder.length };
	editor.replaceRange(content, start, end);
};

/**
 * Attaches an image to the editor
 */
const attachImage = (imageUrl: string, hasFixedSize: boolean, size: number) => {
	if (!hasFixedSize) {
		return `![](${imageUrl})`
	}
	return `![${size}](${imageUrl})`;
};

/**
 * Higher-order function for handling asynchronous operations with error handling
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
 * Handles image uploads from clipboard to Firebase Storage or Google Cloud Storage
 */
export default class Pasterly extends Plugin {
	settings: PasterlySettings;
	private storageProvider: StorageProvider | null = null;
	private initializeTimeout: number | null = null;

	/**
	 * Initializes the storage provider based on settings
	 */
	async initializeStorage() {
		try {
			if (this.settings.storageType === 'firebase') {
				if (!this.settings.firebaseBucketUrl) {
					new Notice('Please set your Firebase Storage bucket URL in settings first.');
					return;
				}
			} else if (this.settings.storageType === 'gcs') {
				if (!this.settings.gcsBucketName) {
					new Notice('Please set your GCS bucket name in settings first.');
					return;
				}
				// If not using gcloud CLI, require access token
				if (!this.settings.gcsUseGcloudCli && !this.settings.gcsAccessToken) {
					new Notice('Please set your GCS access token or enable gcloud CLI in settings.');
					return;
				}
			}

			this.storageProvider = createStorageProvider(this.settings.storageType, {
				firebaseBucketUrl: this.settings.firebaseBucketUrl,
				gcsBucketName: this.settings.gcsBucketName,
				gcsAccessToken: this.settings.gcsAccessToken,
				gcsCdnBaseUrl: this.settings.gcsCdnBaseUrl,
				gcsUseGcloudCli: this.settings.gcsUseGcloudCli,
			});
		} catch (error) {
			console.error('Failed to initialize storage provider:', error);
			new Notice('Failed to initialize storage provider. Check settings.');
		}
	}

	/**
	 * Debounced version of initializeStorage to prevent rapid reinitializations
	 */
	public debouncedInitializeStorage = () => {
		if (this.initializeTimeout) {
			window.clearTimeout(this.initializeTimeout);
		}
		this.initializeTimeout = window.setTimeout(() => {
			this.initializeStorage();
			this.initializeTimeout = null;
		}, 500);
	};

	/**
	 * Handles the image upload process
	 */
	handleImageUpload = async (file: File, editor: Editor) => {
		const storage = this.storageProvider;
		if (!storage) {
			new Notice('Storage provider is not initialized. Please check your settings.');
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
				new Notice(error.message || 'Failed to upload image. Please check your storage settings');
				console.error('Image upload error:', error);
			}
		);

		return result;
	};

	async onload() {
		await this.loadSettings();
		await this.initializeStorage();

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

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

/**
 * Settings tab for the Pasterly plugin
 */
class PasterlySettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: Pasterly) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Storage Type Selection
		new Setting(containerEl)
			.setName('Storage Provider')
			.setDesc('Choose your storage backend')
			.addDropdown(dropdown => dropdown
				.addOption('firebase', 'Firebase Storage')
				.addOption('gcs', 'Google Cloud Storage')
				.setValue(this.plugin.settings.storageType)
				.onChange(async (value: 'firebase' | 'gcs') => {
					this.plugin.settings.storageType = value;
					await this.plugin.saveSettings();
					this.plugin.debouncedInitializeStorage();
					this.display(); // Refresh to show/hide relevant settings
				}));

		// Firebase Settings
		if (this.plugin.settings.storageType === 'firebase') {
			new Setting(containerEl)
				.setName('Firebase Storage Bucket URL')
				.setDesc('URL of your Firebase Storage bucket (e.g., gs://your-bucket.appspot.com)')
				.addText(text => text
					.setPlaceholder('gs://your-bucket.appspot.com')
					.setValue(this.plugin.settings.firebaseBucketUrl)
					.onChange(async (value) => {
						this.plugin.settings.firebaseBucketUrl = value;
						await this.plugin.saveSettings();
						this.plugin.debouncedInitializeStorage();
					}));
		}

		// GCS Settings
		if (this.plugin.settings.storageType === 'gcs') {
			new Setting(containerEl)
				.setName('GCS Bucket Name')
				.setDesc('Name of your Google Cloud Storage bucket (without gs:// prefix)')
				.addText(text => text
					.setPlaceholder('my-bucket-name')
					.setValue(this.plugin.settings.gcsBucketName)
					.onChange(async (value) => {
						this.plugin.settings.gcsBucketName = value;
						await this.plugin.saveSettings();
						this.plugin.debouncedInitializeStorage();
					}));

			new Setting(containerEl)
				.setName('Use gcloud CLI for authentication')
				.setDesc('Automatically get access token by running "gcloud auth print-access-token". Requires gcloud CLI installed and authenticated.')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.gcsUseGcloudCli)
					.onChange(async (value) => {
						this.plugin.settings.gcsUseGcloudCli = value;
						await this.plugin.saveSettings();
						this.plugin.debouncedInitializeStorage();
						this.display(); // Refresh to show/hide token field
					}));

			// Only show manual token input if gcloud CLI is disabled
			if (!this.plugin.settings.gcsUseGcloudCli) {
				new Setting(containerEl)
					.setName('GCS Access Token')
					.setDesc('OAuth2 access token (get via: gcloud auth print-access-token). Token expires after ~1 hour.')
					.addTextArea(text => {
						text
							.setPlaceholder('ya29.a0...')
							.setValue(this.plugin.settings.gcsAccessToken)
							.onChange(async (value) => {
								this.plugin.settings.gcsAccessToken = value;
								await this.plugin.saveSettings();
								this.plugin.debouncedInitializeStorage();
							});
						text.inputEl.rows = 3;
						text.inputEl.style.width = '100%';
					});

				// Info notice about token expiration
				const infoEl = containerEl.createEl('div', {
					cls: 'setting-item-description',
					text: '⚠️ Access tokens expire after ~1 hour. You will need to refresh the token periodically.'
				});
				infoEl.style.marginBottom = '1em';
				infoEl.style.color = 'var(--text-warning)';
			}

			new Setting(containerEl)
				.setName('CDN Base URL')
				.setDesc('Optional: CDN URL to use instead of storage.googleapis.com (e.g., https://cdn.example.com)')
				.addText(text => text
					.setPlaceholder('https://cdn.example.com')
					.setValue(this.plugin.settings.gcsCdnBaseUrl)
					.onChange(async (value) => {
						this.plugin.settings.gcsCdnBaseUrl = value;
						await this.plugin.saveSettings();
						this.plugin.debouncedInitializeStorage();
					}));
		}

		// Common Settings
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
					});
				text.inputEl.type = "number";
			});
	}
}
