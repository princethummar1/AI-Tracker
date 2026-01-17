# 🚀 Vercel Deployment Guide

This guide covers deploying the Ai-Tracker application to Vercel.

## Prerequisites

1. **GitHub Repository** (Already set up ✅)
   - Repository: `princethummar1/AI-Tracker`
   - Branch: `main`

2. **Vercel Account**
   - Sign up at https://vercel.com
   - Connect your GitHub account

3. **Local Git Setup**
   - Commits pushed to GitHub main branch will auto-deploy

## Deployment Methods

### Method 1: Vercel Dashboard (Easiest) ⭐

1. **Go to Vercel Dashboard**
   - Visit https://vercel.com/dashboard
   - Click "Add New..." → "Project"

2. **Import from Git**
   - Select "Import Git Repository"
   - Find and select `princethummar1/AI-Tracker`
   - Click "Import"

3. **Configure Project**
   - Framework Preset: Other
   - Root Directory: ./
   - Build Command: `npm install` (leave empty - already in vercel.json)
   - Install Command: `npm install`
   - Start Command: Leave empty

4. **Environment Variables**
   - Add `NODE_ENV`: `production`
   - Click "Deploy"

5. **Deployment Complete!**
   - Vercel will build and deploy
   - You'll get a live URL like: `https://ai-tracker.vercel.app`

---

### Method 2: Vercel CLI

1. **Install Vercel CLI**
   ```bash
   npm install -g vercel
   ```

2. **Deploy from Project Directory**
   ```bash
   cd d:\Projects\Server\Ai-Tracker
   vercel
   ```

3. **Follow Prompts**
   - Link to GitHub account
   - Select your GitHub project
   - Configure deployment settings
   - Deploy!

---

## Important Notes

### Database Persistence

⚠️ **SQLite Storage Limitation**

Vercel serverless functions have **ephemeral storage** - files created during execution are deleted after the request ends.

**Solutions:**

1. **Option A: Cloud Database (Recommended)**
   - Migrate from SQLite to MongoDB, PostgreSQL, or similar
   - Services: MongoDB Atlas, Supabase, PlanetScale
   - Update `database.js` to use cloud database

2. **Option B: File-Based Persistence with Service**
   - Use Vercel's Blob Storage (requires Vercel Pro)
   - Or use external storage like AWS S3

3. **Option C: Keep SQLite Locally**
   - Vercel deployments will reset database on each deploy
   - Suitable for testing/demo purposes only
   - Not recommended for production

**Current Configuration:** SQLite (will reset on redeploy)

---

## Post-Deployment Configuration

### 1. Environment Variables

Add to Vercel Dashboard → Settings → Environment Variables:

```
NODE_ENV=production
PORT=3000
```

### 2. Custom Domain (Optional)

1. In Vercel Dashboard → Project Settings → Domains
2. Add your custom domain
3. Update DNS records as instructed

### 3. Monitoring & Logs

- View deployment logs: Vercel Dashboard → Deployments → Logs
- Real-time logs: `vercel logs`

---

## Continuous Deployment

Your project is now **automatically deployed** whenever you:

1. **Push to main branch**
   ```bash
   git add .
   git commit -m "Update feature"
   git push origin main
   ```

2. **Vercel automatically:**
   - Detects the push
   - Builds the project
   - Deploys to production (if all checks pass)

3. **Monitor deployments:**
   - Vercel Dashboard shows all deployments
   - Gets a unique URL for each deployment
   - Keeps production pointing to latest successful build

---

## Troubleshooting

### Build Fails

**Common issues:**
- Missing dependencies: Check `package.json`
- Node version: Vercel uses Node 18+ by default
- Environment variables: Check all are set

**Check logs:**
```bash
vercel logs --follow
```

### Database Issues

- Data not persisting? See "Database Persistence" section above
- Need to reset? Delete `.sqlite` files, redeploy

### CORS Errors

- Check `cors()` middleware in server.js
- Vercel automatically handles CORS for same-origin requests

### Static Files Not Loading

- Ensure `app.use(express.static())` is configured
- Check `.vercelignore` doesn't exclude necessary files

---

## File Structure for Deployment

```
Ai-Tracker/
├── server.js              ✅ Entry point
├── index.html             ✅ Frontend
├── script.js              ✅ Frontend logic
├── style.css              ✅ Styling
├── api.js                 ✅ API routes
├── database.js            ✅ Database layer
├── habitSystem.js         ✅ Business logic
├── settingsAuthority.js   ✅ Settings
├── package.json           ✅ Dependencies
├── vercel.json            ✅ Vercel config
├── .vercelignore          ✅ Ignore patterns
├── .gitignore             ✅ Git ignore
└── data/                  ⚠️ Local SQLite (not persisted)
```

---

## Performance Tips

1. **Enable Compression**
   ```javascript
   const compression = require('compression');
   app.use(compression());
   ```

2. **Cache Static Assets**
   - Add cache headers to static files
   - Vercel CDN handles this automatically

3. **Monitor Performance**
   - Vercel Analytics shows performance metrics
   - Optimize slow API endpoints

---

## Rollback to Previous Version

If deployment breaks:

1. **Revert last commit**
   ```bash
   git revert HEAD
   git push origin main
   ```

2. **Or redeploy previous build**
   - Vercel Dashboard → Deployments
   - Click previous successful deployment
   - Click "Redeploy"

---

## Next Steps

1. ✅ Push code to GitHub (if not already)
   ```bash
   git push origin main
   ```

2. ✅ Sign up for Vercel (if not already)
   - https://vercel.com/signup

3. ✅ Deploy via Vercel Dashboard
   - Import your GitHub repository
   - Configure and deploy

4. ✅ Get your live URL
   - Share with users
   - Monitor in Vercel Dashboard

---

## Support & Resources

- **Vercel Docs:** https://vercel.com/docs
- **Node.js Guide:** https://nodejs.org/docs
- **Troubleshooting:** https://vercel.com/support
- **Community:** https://github.com/vercel/community

---

**Deployment Status:** Ready for Vercel! 🎉
