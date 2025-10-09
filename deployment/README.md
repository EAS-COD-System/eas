# EastAfricaShop Admin System

This repository provides everything needed to deploy and operate the EAS Admin System, built with Node.js (backend), React + Vite (frontend), and MongoDB.

---

## ⚙️ Setup

### Backend
1. `cd eas-backend`
2. Copy `.env.example` → `.env` and set:
   ```
   MONGO_URI=mongodb+srv://...
   JWT_SECRET=your-secret
   PORT=4000
   ```
3. Install dependencies and seed data:
   ```bash
   npm install
   npm run seed
   npm run dev
   ```

### Frontend
1. `cd eas-frontend`
2. Copy `.env.example` → `.env` and set the backend URL:
   ```
   VITE_API_URL=http://localhost:4000
   ```
3. Install and run:
   ```bash
   npm install
   npm run dev
   ```

4. Visit http://localhost:5173

---

## 🧪 Login
```
Username: eas
Password: easnew
```

---

## 🗃️ MongoDB Sample Data

File: `seed.json`

Contains collections for:
- Products
- Countries
- Shipments
- Daily Delivered
- Ad Spends
- Remittances
- Finance Entries
- Tasks (To-do & Weekly)

Import:
```bash
mongoimport --uri "YOUR_MONGO_URI" --db eas --collection products --file seed.json --jsonArray
```

---

## 🚀 Deployment (Render / Vercel)

### Backend (Render)
1. Create a new Render Web Service
2. Connect your repo or upload `backend.zip`
3. Environment variables:
   - `MONGO_URI`
   - `JWT_SECRET`
4. Build command:
   ```bash
   npm install
   ```
   Start command:
   ```bash
   npm start
   ```

### Frontend (Vercel)
1. Deploy the `frontend` folder to Vercel
2. Add env var `VITE_API_URL` → Backend URL
3. Done

---

## 🐳 Docker Compose

This file will run both frontend and backend together with MongoDB.

```bash
docker-compose up --build
```

Then open http://localhost:5173

