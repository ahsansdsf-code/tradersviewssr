# Replit Run + Publish

## 1. Add Secrets

Open Replit Secrets and add:

```env
MONGO_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/tradersview_pkr?appName=Cluster0
JWT_SECRET=change-this-to-a-long-random-secret
JWT_EXPIRES_IN=7d
NODE_ENV=production
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@tradersview.pk
ADMIN_PASSWORD=ahsan123
DEMO_USERNAME=demo
DEMO_EMAIL=demo@tradersview.pk
DEMO_PASSWORD=123456
DEMO_BALANCE=100000
TRADE_PROFIT_RATE=0.8
PKR_USD_RATE=278
MAX_UPLOAD_MB=5
```

Do not share `MONGO_URI` or passwords.

## 2. Install

In Replit Shell:

```bash
npm install
```

## 3. Seed Admin

Run once:

```bash
npm run seed:admin
```

## 4. Start

```bash
npm start
```

Admin login:

```text
/#/admin/login
username: admin
password: ahsan123
```

## 5. Publish / Deploy

Click Replit `Deploy` or `Publish`, keep run command:

```bash
npm start
```

Uploads on Replit storage are for testing. For production, use Cloudinary/S3 for KYC and deposit proof files.
