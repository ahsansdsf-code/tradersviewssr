# TradersView PKR

PKR-only trading platform with a Node.js, Express.js, MongoDB, Mongoose, JWT, bcrypt, multer, Socket.IO, and nodemailer backend.

## Run On Windows

Install and start MongoDB first, then open PowerShell:

```powershell
cd C:\Users\Admin\Documents\Codex\2026-06-22\ma\outputs\tradersview-pkr
copy .env.example .env
notepad .env
npm install
npm run seed:admin
npm start
```

Open the website:

```text
http://127.0.0.1:5177
```

Admin login:

```text
http://127.0.0.1:5177/#/admin/login
```

## Required Env

Set these in `.env` before running:

```text
MONGO_URI=mongodb://127.0.0.1:27017/tradersview_pkr
JWT_SECRET=your-long-random-secret
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@tradersview.pk
ADMIN_PASSWORD=your-real-admin-password
```

## Checks

```powershell
npm run check
```

## Backend Features

- Real MongoDB storage through Mongoose models.
- Admin and user JWT login, bcrypt password hashing, admin route protection.
- Admin password change with current password verification.
- Newsletter subscribe, list, and delete.
- KYC form with CNIC front/back/photo upload through multer.
- JazzCash, EasyPaisa, and Bank Deposit proof upload with admin approve/reject.
- Balance updates only after approved deposits.
- Notification history with real SMTP email when SMTP env is configured, plus SMS/Firebase placeholder services.
- Gateway add, edit, enable, and disable.
- Trade durations, signals, trades, users, withdrawals, tickets, settings, audit logs, and subscribers APIs.
- Socket.IO live support chat.
- PKR-only currency rules.

Uploads are saved in `uploads\kyc` and `uploads\deposits`. MongoDB is the source of truth; `data.json` is no longer used by the backend.
