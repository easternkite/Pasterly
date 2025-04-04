# Pasterly
![ezgif-7de3789684cc39 (1)](https://github.com/user-attachments/assets/71703ea2-fe0e-4602-8fe0-13c32abda6a2)


Pasterly is an Obsidian plugin that automatically uploads clipboard images to Firebase Storage and generates markdown links.

## Features

- Automatically uploads clipboard images to Firebase Storage
- Shows `![Uploading...]()` placeholder during upload
- Converts to markdown image link upon successful upload
- Configurable Firebase Storage bucket URL in settings
- Falls back to default paste behavior when offline

## Setup

1. Firebase Project Setup:
   - Create a project in Firebase Console
   - Enable Storage service
   - Get your bucket URL (e.g., `gs://your-bucket.appspot.com`)

2. Plugin Configuration:
   - Open Pasterly settings in Obsidian settings
   - Enter your Firebase Storage bucket URL

## How to Use

1. Copy an image to clipboard (screenshot or image file)
2. Paste into Obsidian editor (Ctrl+V / Cmd+V)
3. Image will be automatically uploaded and converted to a markdown link
4. When offline, images will be pasted using Obsidian's default behavior

## Important Notes

- Firebase Storage bucket URL must be correctly configured
- Internet connection is required for cloud upload
- Only image files are supported
- Works offline with default Obsidian paste behavior
