# 🚀 Deploy Your Watch Party App - Step by Step

## ✅ Code is Ready for Deployment!

I've already prepared your code. Now follow these steps:

---

## Step 1: Push to GitHub

Open your terminal in the project folder and run these commands:

```bash
# Initialize git (if not already done)
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit - Watch Party app"

# Create a new repository on GitHub
# Go to https://github.com/new
# Name it: watch-party
# Don't initialize with README
# Click "Create repository"

# Then run these commands (replace YOUR_USERNAME with your GitHub username):
git remote add origin https://github.com/YOUR_USERNAME/watch-party.git
git branch -M main
git push -u origin main
```

---

## Step 2: Deploy to Render

### 2.1 Go to Render
1. Visit: https://render.com
2. Click "Get Started for Free"
3. Sign up with your GitHub account

### 2.2 Create a New Web Service
1. Click "New +" button (top right)
2. Select "Web Service"
3. Connect your GitHub account (if not already)
4. Find and select your `watch-party` repository

### 2.3 Configure the Service
Fill in these settings:

- **Name**: `watch-party` (or any name you like)
- **Region**: Choose closest to you
- **Branch**: `main`
- **Root Directory**: Leave empty
- **Runtime**: `Node`
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`
- **Instance Type**: `Free`

### 2.4 Environment Variables
Click "Advanced" and add:
- **Key**: `NODE_ENV`
- **Value**: `production`

### 2.5 Deploy!
1. Click "Create Web Service"
2. Wait 5-10 minutes for deployment
3. You'll get a URL like: `https://watch-party-xxxx.onrender.com`

---

## Step 3: Share with Friends!

Once deployed, share the URL with your friends:
1. They visit the URL
2. Everyone joins the same room ID
3. Add a video
4. Watch together! 🎉

---

## 🔧 Troubleshooting

### If deployment fails:
1. Check the logs in Render dashboard
2. Make sure all files are pushed to GitHub
3. Verify the build command completed successfully

### If friends can't connect:
1. Make sure they're using the exact same Room ID
2. Check that the Render service is running (green status)
3. Try refreshing the page

---

## 📝 Notes

- **Free tier**: Render free tier may sleep after 15 minutes of inactivity
- **First load**: May take 30 seconds to wake up
- **Upgrade**: For 24/7 uptime, upgrade to paid tier ($7/month)

---

## Need Help?

If you get stuck, let me know at which step and I'll help you!
