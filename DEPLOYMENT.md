# MinuteMaster - cPanel Deployment Guide

## Prerequisites

Before deploying to cPanel, ensure you have:
- [ ] Node.js version 14+ available in cPanel (preferably 18 or 20)
- [ ] FFmpeg installed on the server
- [ ] Firebase service account JSON file
- [ ] OpenAI API key (users will configure this)
- [ ] cPanel access with Node.js support

---

## Step 1: Check Node.js Version

1. Log into cPanel
2. Navigate to **Software → Setup Node.js App**
3. Check available Node.js versions in the dropdown
4. **You need at least version 14, preferably 18 or 20**

---

## Step 2: Prepare Files for Upload

### Files to Upload:
```
/home/yourusername/minutes/
├── server.js
├── package.json
├── crypto-utils.js
├── create-initial-user.js
├── .env (create from .env.example)
├── firebase-config/
│   └── serviceAccountKey.json
├── public/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── favicon.jpg
└── ssl/
    ├── cert.pem
    ├── key.pem
    └── openssl.cnf
```

### Files NOT to Upload:
- `node_modules/` (will be installed on server)
- `temp-uploads/` (will be created automatically)
- `temp-output/` (will be created automatically)
- `.git/` (not needed)
- `src/` (Electron files, not needed for web)

---

## Step 3: Create .env File

1. Copy `.env.example` to `.env`
2. Edit `.env` with your values:

```bash
NODE_ENV=production
PORT=3000
HTTPS_PORT=3443
FIREBASE_STORAGE_BUCKET=minutemaster-ef8d3.firebasestorage.app
SESSION_SECRET=your-random-secret-key-here-make-it-long-and-secure
APP_URL=https://alectsafety.co.uk/minutes
```

**Generate a strong SESSION_SECRET:**
Run this in your local terminal:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Step 4: Upload Files to cPanel

### Option A: File Manager
1. Go to cPanel → **Files → File Manager**
2. Navigate to `/home/yourusername/`
3. Create folder `minutes`
4. Upload all files (except those listed in "NOT to Upload")
5. Upload `firebase-config/serviceAccountKey.json` (keep this secure!)

### Option B: FTP/SFTP
1. Connect via FTP client (FileZilla, etc.)
2. Upload to `/home/yourusername/minutes/`

---

## Step 5: Configure Node.js App in cPanel

1. Go to **Software → Setup Node.js App**
2. Click **Create Application**
3. Fill in the form:

```
Node.js version: 18.x or 20.x (highest available)
Application mode: Production
Application root: /home/yourusername/minutes
Application URL: https://alectsafety.co.uk/minutes
Application startup file: server.js
```

4. Click **Create**

---

## Step 6: Set Environment Variables

In the Node.js App interface:

1. Scroll to **Environment Variables** section
2. Add these variables:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `HTTPS_PORT` | `3443` |
| `FIREBASE_STORAGE_BUCKET` | `minutemaster-ef8d3.firebasestorage.app` |
| `SESSION_SECRET` | `your-generated-secret` |

---

## Step 7: Install Dependencies

1. In cPanel Node.js App, click **Run NPM Install**
2. Wait for installation to complete (may take 2-5 minutes)
3. Check for errors in the log

**OR via SSH (if available):**
```bash
cd /home/yourusername/minutes
npm install --production
```

---

## Step 8: Check FFmpeg

MinuteMaster requires FFmpeg for audio conversion.

**Check if installed:**
```bash
ffmpeg -version
```

**If not installed:**
- Contact your hosting provider
- Request FFmpeg installation
- Or check cPanel → **Software Center** for FFmpeg module

---

## Step 9: Create Initial User

Via SSH or Terminal in cPanel:

```bash
cd /home/yourusername/minutes
npm run create-user
```

This creates:
- Email: `john@alect.co.uk`
- Password: `Alect_123`

**⚠️ Change this password immediately after first login!**

---

## Step 10: Configure .htaccess (for /minutes URL)

cPanel Node.js apps typically run on a different port. You need to configure Apache to proxy requests.

Create `/home/yourusername/public_html/minutes/.htaccess`:

```apache
# Proxy to Node.js application
RewriteEngine On
RewriteCond %{HTTPS} on
RewriteCond %{REQUEST_URI} ^/minutes
RewriteRule ^(.*)$ http://localhost:PORT/$1 [P,L]

# Replace PORT with the actual port cPanel assigns
```

**Note:** cPanel usually handles this automatically when you set the Application URL.

---

## Step 11: Start the Application

1. In cPanel Node.js App interface
2. Click **Start App** or **Restart App**
3. Check status - should show "Running"

---

## Step 12: Test the Application

1. Open browser: `https://alectsafety.co.uk/minutes`
2. You should see the login screen
3. Log in with the default credentials
4. Test microphone access (must grant permission)
5. Try recording a short test

---

## Troubleshooting

### App won't start
- Check Node.js version (must be 14+)
- Check `package.json` is present
- Review error logs in cPanel

### Can't access on /minutes URL
- Check Application URL setting
- Verify .htaccess configuration
- Check Apache/Nginx proxy settings

### Microphone doesn't work
- Ensure HTTPS is enabled
- Check browser console for errors
- Verify SSL certificate is valid

### FFmpeg errors
- Contact hosting provider to install FFmpeg
- Check if `fluent-ffmpeg` can find FFmpeg binary

### Firebase errors
- Verify `serviceAccountKey.json` is uploaded
- Check file permissions (should be readable by app)
- Verify Firestore is enabled in Firebase Console

### Session/Login issues
- Check SESSION_SECRET is set
- Verify `.env` file exists and is loaded
- Check cookie settings in browser

---

## Security Checklist

- [ ] Change default user password
- [ ] Secure `serviceAccountKey.json` (permissions 600)
- [ ] Set strong SESSION_SECRET
- [ ] Enable HTTPS only (redirect HTTP)
- [ ] Keep Node.js and npm packages updated
- [ ] Monitor Firebase security rules
- [ ] Set up regular backups
- [ ] Configure firewall rules
- [ ] Review cPanel access logs regularly

---

## Maintenance

### Update Application
```bash
cd /home/yourusername/minutes
git pull  # if using git
npm install
# Restart app in cPanel
```

### View Logs
- cPanel Node.js App interface shows recent logs
- Check `/home/yourusername/minutes/logs/` if configured

### Backup Database
- Firebase Admin SDK for exports
- Or use Firebase Console export feature

---

## Getting Help

If you encounter issues:

1. Check cPanel error logs
2. Review Node.js app logs
3. Contact your hosting provider for:
   - Node.js version issues
   - FFmpeg installation
   - Port/proxy configuration
4. Check Firebase Console for database issues

---

## Additional Notes

- **cPanel Node.js Version**: If only 10.x is available, request an upgrade from your host
- **Memory Limits**: Audio processing can use significant memory - check your hosting plan
- **Concurrent Users**: Monitor usage and upgrade hosting if needed
- **SSL Certificate**: cPanel usually provides Let's Encrypt SSL automatically
