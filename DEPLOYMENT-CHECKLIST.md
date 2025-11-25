# cPanel Deployment Checklist

Use this checklist when deploying MinuteMaster to your cPanel hosting.

## Pre-Deployment

- [ ] **Node.js Version Check**
  - Log into cPanel
  - Navigate to Setup Node.js App
  - Confirm Node.js 14+ available (18+ preferred)
  - ⚠️ If only 10.x available, contact hosting provider for upgrade

- [ ] **FFmpeg Availability**
  - Check if FFmpeg is installed via SSH: `ffmpeg -version`
  - If not available, request installation from host
  - Required for audio conversion

- [ ] **Firebase Configuration**
  - Have `serviceAccountKey.json` file ready
  - Firestore database created and enabled
  - Storage bucket configured

- [ ] **Generate Session Secret**
  - Run: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  - Save the output for .env file

## File Preparation

- [ ] **Create .env file from .env.example**
  - Set `NODE_ENV=production`
  - Set `SESSION_SECRET` (use generated value)
  - Set `FIREBASE_STORAGE_BUCKET`
  - Set `APP_URL=https://alectsafety.co.uk/minutes`

- [ ] **Verify Firebase files**
  - `firebase-config/serviceAccountKey.json` exists
  - File contains valid JSON credentials

- [ ] **Check SSL certificates** (if using HTTPS locally)
  - `ssl/cert.pem` exists
  - `ssl/key.pem` exists

## Upload Files

- [ ] **Upload via FTP/File Manager to `/home/username/minutes/`**
  - ✅ server.js
  - ✅ package.json
  - ✅ crypto-utils.js
  - ✅ create-initial-user.js
  - ✅ .env (configured with your values)
  - ✅ firebase-config/serviceAccountKey.json
  - ✅ public/ (entire folder)
  - ✅ ssl/ (if using HTTPS)
  - ❌ node_modules/ (DO NOT upload)
  - ❌ temp-uploads/, temp-output/ (created automatically)
  - ❌ .git/ (not needed)

## cPanel Configuration

- [ ] **Create Node.js Application**
  - Node.js version: _______ (14+)
  - Application mode: Production
  - Application root: `/home/username/minutes`
  - Application URL: `https://alectsafety.co.uk/minutes`
  - Application startup file: `server.js`

- [ ] **Set Environment Variables**
  - NODE_ENV = production
  - PORT = 3000
  - HTTPS_PORT = 3443 (if applicable)
  - FIREBASE_STORAGE_BUCKET = (your bucket)
  - SESSION_SECRET = (generated secret)

- [ ] **Install Dependencies**
  - Click "Run NPM Install" in cPanel
  - Wait for completion (2-5 minutes)
  - Check for errors

## Initial Setup

- [ ] **Create Initial User**
  - Via SSH: `cd /home/username/minutes && npm run create-user`
  - Note credentials: john@alect.co.uk / Alect_123
  - Plan to change password after first login

- [ ] **Start Application**
  - Click "Start App" in cPanel
  - Verify status shows "Running"

## Testing

- [ ] **Access Application**
  - Visit: `https://alectsafety.co.uk/minutes`
  - Login screen loads correctly

- [ ] **Test Login**
  - Use default credentials
  - Successfully reach API key screen

- [ ] **Test Basic Functionality**
  - Enter OpenAI API key
  - Access microphone selection
  - Grant microphone permission
  - Record short test audio
  - Verify transcription works

- [ ] **Mobile Testing**
  - Access from phone: `https://alectsafety.co.uk/minutes`
  - UI responsive and usable
  - Microphone works on mobile

## Post-Deployment

- [ ] **Change Default Password**
  - Login as john@alect.co.uk
  - Change password immediately

- [ ] **Security Review**
  - Verify HTTPS is enforced
  - Check file permissions on serviceAccountKey.json
  - Review Firebase security rules

- [ ] **Setup Monitoring**
  - Bookmark cPanel Node.js App page for logs
  - Set up uptime monitoring (optional)
  - Configure error alerts (optional)

- [ ] **Documentation**
  - Save access credentials securely
  - Document deployment date and version
  - Note any custom configurations

## Troubleshooting Reference

**App won't start:**
- Check Node.js version
- Review error logs in cPanel
- Verify all files uploaded correctly

**Can't access /minutes URL:**
- Check Application URL setting
- Verify .htaccess if manual configuration needed
- Check Apache proxy settings

**Microphone issues:**
- Ensure HTTPS enabled
- Check browser permissions
- Test on different browser

**Transcription errors:**
- Verify FFmpeg installed
- Check OpenAI API key valid
- Review server logs for details

---

## Support Contacts

- **Hosting Provider:** _________________________
- **Support Email:** _________________________
- **Support Phone:** _________________________

---

**Deployment Date:** ________________
**Deployed By:** ________________
**Node.js Version Used:** ________________
**Notes:** ________________________________________________
