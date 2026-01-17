# 🗄️ Database Integration Guide - MongoDB Atlas

This guide explains how to switch from SQLite to MongoDB Atlas for Vercel deployment.

## Why MongoDB?

- ✅ **Persistent Storage** - Data survives Vercel redeployments
- ✅ **Free Tier** - 512MB free cluster with MongoDB Atlas
- ✅ **Easy Setup** - 5-minute configuration
- ✅ **Scalable** - Grows with your app
- ✅ **No Local Files** - Works perfectly on serverless platforms

---

## Step 1: Set Up MongoDB Atlas

### 1a. Create Account
1. Visit https://www.mongodb.com/cloud/atlas
2. Click **"Start Free"**
3. Sign up with email or GitHub
4. Verify your email

### 1b. Create Organization & Project
1. After login, create organization
2. **Organization Name**: Your name or company
3. Click **"Create"**
4. Click **"New Project"**
5. **Project Name**: `ai-tracker`
6. Click **"Create Project"**

### 1c. Create Cluster
1. Click **"Build a Database"**
2. **Choose**: "Shared (Free)"
3. **Cloud Provider**: AWS
4. **Region**: Choose closest to you
   - US: `us-east-1` (N. Virginia)
   - EU: `eu-west-1` (Ireland)
   - Asia: `ap-southeast-1` (Singapore)
5. **Cluster Name**: `ai-tracker-prod`
6. Click **"Create Cluster"** (takes 1-2 minutes)

### 1d. Create Database User
1. Click **"Security"** → **"Database Access"**
2. Click **"Add New Database User"**
3. **Authentication Method**: Password
4. **Username**: `aitracker`
5. **Password**: Click **"Generate Secure Password"** (copy this!)
6. **Database User Privileges**: `Atlas admin`
7. Click **"Add User"**

### 1e. Configure Network Access
1. Click **"Security"** → **"Network Access"**
2. Click **"Add IP Address"**
3. For development: Click **"Allow Access from Anywhere"**
4. Click **"Confirm"**

### 1f. Get Connection String
1. Go to **"Clusters"**
2. Click **"Connect"** on your cluster
3. Choose **"Drivers"**
4. **Driver**: Node.js
5. **Version**: Latest (4.x or 5.x)
6. Copy the connection string

**Format:**
```
mongodb+srv://aitracker:PASSWORD@ai-tracker-prod.xxxxx.mongodb.net/ai-tracker?retryWrites=true&w=majority
```

**Replace:**
- `PASSWORD` with your actual password (from step 1d)
- `xxxxx` is already in the string

---

## Step 2: Update Your Project

### 2a. Install MongoDB Package

```bash
cd d:\Projects\Server\Ai-Tracker
npm install mongodb
```

### 2b. Update Environment Variables

**Local Development (.env file):**
```bash
# Create file: d:\Projects\Server\Ai-Tracker\.env

MONGODB_URI=mongodb+srv://aitracker:PASSWORD@ai-tracker-prod.xxxxx.mongodb.net/ai-tracker?retryWrites=true&w=majority
NODE_ENV=development
PORT=3000
```

**For Vercel:**
1. Go to https://vercel.com/dashboard
2. Select your project
3. Go to **"Settings"** → **"Environment Variables"**
4. Add:
   - **Name**: `MONGODB_URI`
   - **Value**: Your connection string from step 1f
   - Click **"Save"**

### 2c. Update server.js to Use MongoDB

```javascript
// server.js - Change this line:

// OLD (SQLite):
const db = require('./database');

// NEW (MongoDB):
const db = require('./database-mongodb');
```

Or set up conditional loading:

```javascript
const dbModule = process.env.MONGODB_URI ? './database-mongodb' : './database';
const db = require(dbModule);
```

### 2d. Update Your .gitignore

Ensure `.env` is ignored (already there):
```
.env
.env.local
.env.*.local
```

But commit `.env.example`:
```bash
git add .env.example
```

---

## Step 3: Test Connection Locally

### 3a. Create .env File

```bash
# d:\Projects\Server\Ai-Tracker\.env
MONGODB_URI=mongodb+srv://aitracker:YOUR_PASSWORD@ai-tracker-prod.xxxxx.mongodb.net/ai-tracker?retryWrites=true&w=majority
NODE_ENV=development
PORT=3000
```

### 3b. Install dotenv Package

```bash
npm install dotenv
```

### 3c. Load Environment Variables in server.js

Add at the very top of `server.js`:

```javascript
require('dotenv').config();

const express = require('express');
// ... rest of your imports
```

### 3d. Test Connection

```bash
npm start
```

**Expected output:**
```
Connected to MongoDB Atlas
Indexes created successfully
Default settings initialized
Server listening on port 3000
```

---

## Step 4: Deploy to Vercel

### 4a. Install dotenv in package.json

```bash
npm install dotenv
```

### 4b. Commit Changes

```bash
git add package.json package-lock.json database-mongodb.js .env.example server.js
git commit -m "feat: Integrate MongoDB Atlas for Vercel deployment"
git push origin main
```

### 4c. Vercel Auto-Deploys

Vercel will:
1. Detect the push
2. Install dependencies (including `mongodb`)
3. Use `MONGODB_URI` environment variable
4. Deploy automatically

**Check deployment:**
1. Go to https://vercel.com/dashboard
2. Click your project
3. Check **"Deployments"** tab
4. Wait for "Ready" status

---

## Switching Between SQLite and MongoDB

### Keep Both (Recommended for Transition)

```javascript
// server.js
const db = process.env.MONGODB_URI 
    ? require('./database-mongodb')  // Use MongoDB on Vercel
    : require('./database');          // Use SQLite locally
```

**This way:**
- Local development: Still uses SQLite
- Vercel production: Uses MongoDB
- No code changes needed

### Switch Completely to MongoDB

1. Update `server.js`:
```javascript
const db = require('./database-mongodb');
```

2. Update `package.json` scripts to use MongoDB:
```json
"migrate": "node -e \"require('./database-mongodb').initDatabase().then(() => console.log('Database ready')).catch(console.error)\""
```

3. You can delete `database.js` later (keep for backup)

---

## Common Issues & Solutions

### ❌ "MongoServerError: IP address not whitelisted"

**Solution:** Add your IP to MongoDB Atlas network access
1. Go to MongoDB Atlas → Security → Network Access
2. Click "Add IP Address"
3. Choose "Allow Access from Anywhere"

### ❌ "Invalid Connection String"

**Solution:** Check password and connection string
- Don't forget to replace `PASSWORD`
- Password might contain special characters (use exact value)
- Remove `<` and `>` from connection string

### ❌ "Data not persisting on Vercel"

**Solution:** Make sure `MONGODB_URI` is set in Vercel environment
1. Vercel Dashboard → Project → Settings → Environment Variables
2. Check `MONGODB_URI` is there
3. Redeploy: Click "Redeploy" button

### ❌ "Connection timeout"

**Solution:**
- Check internet connection
- Verify MongoDB Atlas cluster is running
- Check network access whitelist

---

## Verifying Data in MongoDB

### Via MongoDB Atlas Dashboard

1. Go to https://cloud.mongodb.com
2. Click **"Clusters"** → Your cluster
3. Click **"Browse Collections"**
4. See all your data in real-time!

### Via Node.js Script

```bash
# Create test-mongo.js
const { MongoClient } = require('mongodb');

async function testConnection() {
    const uri = process.env.MONGODB_URI || 'mongodb+srv://aitracker:PASSWORD@ai-tracker-prod.xxxxx.mongodb.net/ai-tracker?retryWrites=true&w=majority';
    const client = new MongoClient(uri);
    
    try {
        await client.connect();
        console.log('✅ Connected to MongoDB!');
        
        const db = client.db('ai-tracker');
        const collections = await db.listCollections().toArray();
        console.log('Collections:', collections.map(c => c.name));
    } finally {
        await client.close();
    }
}

testConnection().catch(console.error);
```

Run:
```bash
node test-mongo.js
```

---

## Performance Tips

1. **Add Indexes** - Already done in `database-mongodb.js`
2. **Use Aggregation** - For complex queries
3. **Pagination** - For large datasets
4. **Caching** - Cache frequently accessed data

---

## Next Steps

1. ✅ Create MongoDB Atlas account and cluster
2. ✅ Get connection string
3. ✅ Set up local `.env` file
4. ✅ Run `npm install mongodb`
5. ✅ Test locally with `npm start`
6. ✅ Add `MONGODB_URI` to Vercel environment variables
7. ✅ Push to GitHub
8. ✅ Verify Vercel deployment

---

## Support

- **MongoDB Docs**: https://docs.mongodb.com
- **MongoDB Atlas**: https://www.mongodb.com/cloud/atlas
- **Node.js Driver**: https://www.npmjs.com/package/mongodb
- **Vercel Docs**: https://vercel.com/docs

---

**Your app is now ready for production with MongoDB Atlas! 🎉**
