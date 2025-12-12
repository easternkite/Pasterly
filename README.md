# Pasterly

![ezgif-7de3789684cc39 (1)](https://github.com/user-attachments/assets/71703ea2-fe0e-4602-8fe0-13c32abda6a2)

Pasterly is an Obsidian plugin that automatically uploads clipboard images to cloud storage and generates markdown links. Supports **Firebase Storage** and **Google Cloud Storage**.

## Features

- 📷 Automatically uploads clipboard images to cloud storage
- ⏳ Shows `![Uploading...]()` placeholder during upload
- 🔗 Converts to markdown image link upon successful upload
- ☁️ Multiple storage providers: Firebase Storage and Google Cloud Storage
- 🔄 **Auto-authentication** via `gcloud CLI` (no manual token refresh!)
- 🌐 **CDN URL support** for faster image delivery
- 📴 Falls back to default paste behavior when offline

## Setup

### Option 1: Firebase Storage

1. Create a project in [Firebase Console](https://console.firebase.google.com/)
2. Enable Storage service
3. Get your bucket URL (e.g., `gs://your-bucket.appspot.com`)
4. In Pasterly settings:
   - **Storage Provider**: `Firebase Storage`
   - **Firebase Storage Bucket URL**: Your bucket URL

> **Important**: Ensure **WRITE** permission is enabled in your Firebase bucket rules.

---

### Option 2: Google Cloud Storage (Recommended)

#### Prerequisites

1. Install [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)
2. Authenticate with your Google account:
   ```bash
   gcloud auth login
   ```
3. Verify authentication works:
   ```bash
   gcloud auth print-access-token
   ```

#### Configure CORS (Required)

```bash
# Create cors.json
cat > cors.json << 'EOF'
[
  {
    "origin": ["*"],
    "method": ["PUT", "POST", "GET"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
EOF

# Apply CORS configuration
gcloud storage buckets update gs://YOUR-BUCKET-NAME --cors-file=cors.json
```

#### Plugin Settings

| Setting | Value | Description |
|---------|-------|-------------|
| Storage Provider | `Google Cloud Storage` | Select GCS as provider |
| GCS Bucket Name | `your-bucket-name` | Bucket name without `gs://` prefix |
| Use gcloud CLI | ✅ Enabled | Auto-refresh token using gcloud CLI |
| CDN Base URL | `https://cdn.example.com` | (Optional) CDN URL for image links |

#### Authentication Methods

**Method 1: Auto-authentication via gcloud CLI (Recommended)**
- Enable **"Use gcloud CLI for authentication"** toggle
- Plugin will automatically run `gcloud auth print-access-token` on each upload
- No manual token refresh needed!

**Method 2: Manual Access Token**
- Disable the gcloud CLI toggle
- Paste access token from: `gcloud auth print-access-token`
- ⚠️ Token expires after ~1 hour, requires manual refresh

---

## How to Use

1. Copy an image to clipboard (screenshot or image file)
2. Paste into Obsidian editor (`Cmd+V` / `Ctrl+V`)
3. Image will be automatically uploaded and converted to a markdown link
4. When offline, images will be pasted using Obsidian's default behavior

## Troubleshooting

### "gcloud: command not found"
The plugin automatically searches for gcloud in common paths:
- `/opt/homebrew/bin/gcloud` (macOS Apple Silicon)
- `/usr/local/bin/gcloud` (macOS Intel)
- `/usr/bin/gcloud` (Linux)

If gcloud is installed elsewhere, check your installation path with:
```bash
which gcloud
```

### "Failed to upload to GCS"
- Verify bucket permissions allow writes
- Ensure CORS is configured correctly
- Check that `gcloud auth login` was successful

## Credits

- Built using the [Obsidian Plugin Template](https://github.com/obsidianmd/obsidian-sample-plugin)
- Uses [Firebase SDK](https://firebase.google.com/) under Apache License 2.0

## License

```
Copyright 2025 easternkite

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
