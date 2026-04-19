import { App, Editor, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { createStorageProvider } from './storageProviders';
import { StorageProvider, PasterlySettings, DEFAULT_SETTINGS } from './types';

const normalizeOptionalBaseUrl = (value: string): string => {
	if (!value.trim()) {
		return '';
	}

	const trimmedValue = value.trim();
	const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmedValue)
		? trimmedValue
		: `https://${trimmedValue.replace(/^\/+/, '')}`;

	return withProtocol.replace(/\/+$/, '');
};

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
			} else if (this.settings.storageType === 's3') {
				if (!this.settings.s3BucketName) {
					new Notice('Please set your S3 bucket name in settings first.');
					return;
				}
				if (!this.settings.s3Region) {
					new Notice('Please set your S3 region in settings first.');
					return;
				}
				if (!this.settings.s3AccessKeyId || !this.settings.s3SecretAccessKey) {
					new Notice('Please set your S3 credentials in settings first.');
					return;
				}
			} else if (this.settings.storageType === 'r2') {
				if (!this.settings.r2AccountId) {
					new Notice('Please set your R2 Account ID in settings first.');
					return;
				}
				if (!this.settings.r2BucketName) {
					new Notice('Please set your R2 Bucket Name in settings first.');
					return;
				}
				if (!this.settings.r2AccessKeyId || !this.settings.r2SecretAccessKey) {
					new Notice('Please set your R2 credentials in settings first.');
					return;
				}
			}

			this.storageProvider = createStorageProvider(this.settings.storageType, {
				firebaseBucketUrl: this.settings.firebaseBucketUrl,
				gcsBucketName: this.settings.gcsBucketName,
				gcsAccessToken: this.settings.gcsAccessToken,
				gcsCdnBaseUrl: this.settings.gcsCdnBaseUrl,
				gcsUseGcloudCli: this.settings.gcsUseGcloudCli,
				s3BucketName: this.settings.s3BucketName,
				s3Region: this.settings.s3Region,
				s3Endpoint: this.settings.s3Endpoint,
				s3AccessKeyId: this.settings.s3AccessKeyId,
				s3SecretAccessKey: this.settings.s3SecretAccessKey,
				s3SessionToken: this.settings.s3SessionToken,
				s3PublicBaseUrl: this.settings.s3PublicBaseUrl,
				s3ForcePathStyle: this.settings.s3ForcePathStyle,
				r2AccountId: this.settings.r2AccountId,
				r2BucketName: this.settings.r2BucketName,
				r2AccessKeyId: this.settings.r2AccessKeyId,
				r2SecretAccessKey: this.settings.r2SecretAccessKey,
				r2PublicBaseUrl: this.settings.r2PublicBaseUrl,
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
		const normalizedCdnBaseUrl = normalizeOptionalBaseUrl(this.settings.gcsCdnBaseUrl);
		const normalizedS3Endpoint = normalizeOptionalBaseUrl(this.settings.s3Endpoint);
		const normalizedS3PublicBaseUrl = normalizeOptionalBaseUrl(this.settings.s3PublicBaseUrl);
		const normalizedR2PublicBaseUrl = normalizeOptionalBaseUrl(this.settings.r2PublicBaseUrl);

		if (
			normalizedCdnBaseUrl !== this.settings.gcsCdnBaseUrl ||
			normalizedS3Endpoint !== this.settings.s3Endpoint ||
			normalizedS3PublicBaseUrl !== this.settings.s3PublicBaseUrl ||
			normalizedR2PublicBaseUrl !== this.settings.r2PublicBaseUrl
		) {
			this.settings.gcsCdnBaseUrl = normalizedCdnBaseUrl;
			this.settings.s3Endpoint = normalizedS3Endpoint;
			this.settings.s3PublicBaseUrl = normalizedS3PublicBaseUrl;
			this.settings.r2PublicBaseUrl = normalizedR2PublicBaseUrl;
			await this.saveSettings();
		}
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
				.addOption('s3', 'S3-compatible Storage (AWS S3 / MinIO)')
				.addOption('r2', 'Cloudflare R2')
				.setValue(this.plugin.settings.storageType)
				.onChange(async (value: 'firebase' | 'gcs' | 's3' | 'r2') => {
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
						this.plugin.settings.gcsCdnBaseUrl = normalizeOptionalBaseUrl(value);
						await this.plugin.saveSettings();
						this.plugin.debouncedInitializeStorage();
					}));
		}

		if (this.plugin.settings.storageType === 's3') {
			new Setting(containerEl)
				.setName('S3 Bucket Name')
				.setDesc('Bucket name used to store uploaded images')
				.addText(text => text
					.setPlaceholder('my-bucket-name')
					.setValue(this.plugin.settings.s3BucketName)
					.onChange(async (value) => {
						this.plugin.settings.s3BucketName = value.trim();
						await this.plugin.saveSettings();
						this.plugin.debouncedInitializeStorage();
					}));

			new Setting(containerEl)
				.setName('S3 Region')
				.setDesc('AWS region or provider-specific region (for R2 use "auto")')
				.addText(text => text
					.setPlaceholder('us-east-1')
					.setValue(this.plugin.settings.s3Region)
					.onChange(async (value) => {
						this.plugin.settings.s3Region = value.trim();
						await this.plugin.saveSettings();
						this.plugin.debouncedInitializeStorage();
					}));

			new Setting(containerEl)
				.setName('S3 Endpoint')
				.setDesc('Optional for AWS S3. Required for S3-compatible providers such as Cloudflare R2 or MinIO.')
				.addText(text => text
					.setPlaceholder('https://<accountid>.r2.cloudflarestorage.com')
					.setValue(this.plugin.settings.s3Endpoint)
					.onChange(async (value) => {
						this.plugin.settings.s3Endpoint = normalizeOptionalBaseUrl(value);
						await this.plugin.saveSettings();
						this.plugin.debouncedInitializeStorage();
					}));

			new Setting(containerEl)
				.setName('Access Key ID')
				.setDesc('Access key with write permission to the target bucket')
				.addText(text => text
					.setPlaceholder('AKIA...')
					.setValue(this.plugin.settings.s3AccessKeyId)
					.onChange(async (value) => {
						this.plugin.settings.s3AccessKeyId = value.trim();
						await this.plugin.saveSettings();
						this.plugin.debouncedInitializeStorage();
					}));

			new Setting(containerEl)
				.setName('Secret Access Key')
				.setDesc('Secret key stored locally in the Obsidian plugin settings')
				.addText(text => {
					text
						.setPlaceholder('••••••••')
						.setValue(this.plugin.settings.s3SecretAccessKey)
						.onChange(async (value) => {
							this.plugin.settings.s3SecretAccessKey = value.trim();
							await this.plugin.saveSettings();
							this.plugin.debouncedInitializeStorage();
						});
					text.inputEl.type = 'password';
				});

			new Setting(containerEl)
				.setName('Session Token')
				.setDesc('Optional temporary session token for STS-style credentials')
				.addTextArea(text => {
					text
						.setPlaceholder('IQoJb3JpZ2luX2Vj...')
						.setValue(this.plugin.settings.s3SessionToken)
						.onChange(async (value) => {
							this.plugin.settings.s3SessionToken = value.trim();
							await this.plugin.saveSettings();
							this.plugin.debouncedInitializeStorage();
						});
					text.inputEl.rows = 2;
					text.inputEl.style.width = '100%';
				});

			new Setting(containerEl)
				.setName('Public Base URL')
				.setDesc('Optional public URL used in markdown output. Recommended for R2 or CDN-backed buckets.')
				.addText(text => text
					.setPlaceholder('https://cdn.example.com')
					.setValue(this.plugin.settings.s3PublicBaseUrl)
					.onChange(async (value) => {
						this.plugin.settings.s3PublicBaseUrl = normalizeOptionalBaseUrl(value);
						await this.plugin.saveSettings();
						this.plugin.debouncedInitializeStorage();
					}));

			new Setting(containerEl)
				.setName('Use path-style URLs')
				.setDesc('Enable for providers requiring endpoint/bucket paths instead of bucket-prefixed hostnames')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.s3ForcePathStyle)
					.onChange(async (value) => {
						this.plugin.settings.s3ForcePathStyle = value;
						await this.plugin.saveSettings();
						this.plugin.debouncedInitializeStorage();
					}));
		}

		if (this.plugin.settings.storageType === 'r2') {
			new Setting(containerEl)
				.setName('R2 Account ID')
				.setDesc('Cloudflare Account ID (found in R2 dashboard)')
				.addText(text => text
					.setPlaceholder('your-account-id')
					.setValue(this.plugin.settings.r2AccountId)
					.onChange(async (value) => {
						this.plugin.settings.r2AccountId = value.trim();
						await this.plugin.saveSettings();
						this.plugin.debouncedInitializeStorage();
					}));

			new Setting(containerEl)
				.setName('R2 Bucket Name')
				.setDesc('Name of your R2 bucket')
				.addText(text => text
					.setPlaceholder('my-bucket-name')
					.setValue(this.plugin.settings.r2BucketName)
					.onChange(async (value) => {
						this.plugin.settings.r2BucketName = value.trim();
						await this.plugin.saveSettings();
						this.plugin.debouncedInitializeStorage();
					}));

			new Setting(containerEl)
				.setName('R2 Access Key ID')
				.setDesc('R2 API Token Access Key ID')
				.addText(text => text
					.setPlaceholder('access-key-id')
					.setValue(this.plugin.settings.r2AccessKeyId)
					.onChange(async (value) => {
						this.plugin.settings.r2AccessKeyId = value.trim();
						await this.plugin.saveSettings();
						this.plugin.debouncedInitializeStorage();
					}));

			new Setting(containerEl)
				.setName('R2 Secret Access Key')
				.setDesc('R2 API Token Secret Access Key')
				.addText(text => {
					text
						.setPlaceholder('••••••••')
						.setValue(this.plugin.settings.r2SecretAccessKey)
						.onChange(async (value) => {
							this.plugin.settings.r2SecretAccessKey = value.trim();
							await this.plugin.saveSettings();
							this.plugin.debouncedInitializeStorage();
						});
					text.inputEl.type = 'password';
				});

			new Setting(containerEl)
				.setName('R2 Public Base URL')
				.setDesc('Optional: Custom Domain or R2.dev URL (e.g., https://images.example.com)')
				.addText(text => text
					.setPlaceholder('https://images.example.com')
					.setValue(this.plugin.settings.r2PublicBaseUrl)
					.onChange(async (value) => {
						this.plugin.settings.r2PublicBaseUrl = normalizeOptionalBaseUrl(value);
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
