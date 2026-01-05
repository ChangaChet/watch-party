# How to Deploy Your Watch Party App

## Option 1: Deploy to Render (Free, Easiest for Full-Stack Apps)

### Step 1: Prepare Your Code
1. Make sure both servers are working locally (they are!)
2. We need to combine frontend and backend for deployment

### Step 2: Update package.json for production
Add this to your `package.json`:
```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "server": "node server/index.js",
  "start": "node server/index.js"
}
```

### Step 3: Deploy to Render
1. Go to https://render.com and sign up (free)
2. Click "New +" → "Web Service"
3. Connect your GitHub repo (or upload your code)
4. Settings:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Environment**: Node
5. Click "Create Web Service"
6. Wait 5 minutes for deployment
7. You'll get a URL like: `https://your-app.onrender.com`

### Step 4: Update Socket Connection
After deployment, update `src/App.jsx`:
```javascript
const socket = io(window.location.origin); // Instead of 'http://localhost:3001'
```

---

## Option 2: Deploy to Vercel (Frontend) + Render (Backend)

### Frontend (Vercel):
1. Go to https://vercel.com
2. Import your project
3. Deploy (automatic)

### Backend (Render):
1. Create a separate repo for just the `server` folder
2. Deploy to Render as above

---

## Option 3: Use Ngrok (Quick Test - Not Permanent)

For a quick test with friends:

1. Install ngrok: https://ngrok.com/download
2. Run: `ngrok http 3001` (for backend)
3. Run: `ngrok http 5173` (for frontend)
4. Share the ngrok URLs with friends

**Note**: Ngrok URLs change every time you restart.

---

## Recommended: Option 1 (Render)

It's free, easy, and keeps everything together.

**Next Steps:**
1. Create a GitHub account if you don't have one
2. Push your code to GitHub
3. Deploy to Render
4. Share the URL with friends!

Let me know which option you want to use, and I'll help you set it up!
