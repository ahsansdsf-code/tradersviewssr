const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const multer = require("multer");
const { Server } = require("socket.io");
const nodemailer = require("nodemailer");

try {
  require("dotenv").config();
} catch {
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}

const HOST = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const PORT = Number(process.env.PORT || 5177);
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/tradersview_pkr";
const JWT_SECRET = process.env.JWT_SECRET || crypto.createHash("sha256").update(`${__dirname}:dev-jwt-secret`).digest("hex");
const APP_VERSION = "5.0";
const PROFIT_RATE = Number(process.env.TRADE_PROFIT_RATE || 0.8);
const PKR_RATE = Number(process.env.PKR_USD_RATE || 278);
const root = __dirname;
const uploadRoot = path.join(root, "uploads");
const allowedUploadExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".pdf"]);
const priceCache = { at: 0, prices: null };
let io;

fs.mkdirSync(path.join(uploadRoot, "kyc"), { recursive: true });
fs.mkdirSync(path.join(uploadRoot, "deposits"), { recursive: true });

const coinsSeed = [
  ["BTC", "Bitcoin", "#f7931a", "B"], ["ETH", "Ethereum", "#627eea", "E"],
  ["BNB", "BNB", "#f3ba2f", "B"], ["XRP", "XRP", "#111111", "X"],
  ["SOL", "Solana", "#111111", "S"], ["TRX", "TRON", "#ef0027", "T"],
  ["DOGE", "Dogecoin", "#c3a634", "D"], ["ADA", "Cardano", "#0846a8", "A"],
  ["BCH", "Bitcoin Cash", "#0ac18e", "B"], ["LTC", "Litecoin", "#345d9d", "L"],
  ["STX", "Stacks", "#5546ff", "S"], ["MATIC", "Polygon", "#8247e5", "P"],
  ["PKR", "PKR Wallet", "#149cff", "Rs"]
];

const defaultSettings = {
  captcha: { font: "monospace", style: "neon", length: 6, rotate: true },
  siteName: "TradersView PKR",
  tagline: "Markets. Insights. Opportunities.",
  logoText: "TRADERSVIEW",
  faviconText: "TV",
  supportEmail: "support@tradersview.org",
  supportPhone: "+447418683034",
  address: "1317 Edgewater Drive, Suite 1880",
  maintenance: false,
  defaultTradeResult: "Auto",
  notifications: { email: true, sms: false, firebase: true, fromName: "TradersView PKR" },
  seo: { title: "TradersView PKR", description: "PKR-only trading practice platform.", keywords: "PKR,trading,practice" },
  frontend: {
    welcome: "Welcome to Traders View, your ultimate destination to learn, practice, and master trading with a PKR-only wallet.",
    newsletterText: "Subscribe for regular news and tips."
  },
  kycFields: ["Full Name", "CNIC Number", "Gender", "CNIC Front", "CNIC Back", "CNIC Photo"],
  language: { default: "English", enabled: "English, Urdu" },
  socialLogin: { google: false, facebook: false },
  oauth: { googleClientId: "", facebookAppId: "" },
  gatewayCredentials: { automatic: "Configure API keys in environment variables before enabling automatic live gateways." },
  cron: { enabled: true, interval: "5 minutes" },
  gdpr: { enabled: false, text: "This site uses cookies to improve your experience." },
  customCss: "",
  sitemap: "/sitemap.xml",
  robots: "User-agent: *\nAllow: /",
  quickLinks: [
    { label: "Home", path: "/dashboard" },
    { label: "Contact", path: "/contact" },
    { label: "Dashboard", path: "/dashboard" }
  ],
  pages: {
    termsOfUse: {
      title: "Terms of Use",
      body: "By using TradersView PKR, you agree to use this platform for lawful PKR-only practice trading and account management."
    },
    termsOfService: {
      title: "Terms of Service",
      body: "TradersView PKR provides a trading interface, admin controls, notifications, KYC workflow, deposit records, and PKR balance tools."
    },
    privacyPolicy: {
      title: "Privacy Policy",
      body: "We store account, KYC, notification, support, and transaction data in MongoDB for this application."
    },
    riskDisclaimer: {
      title: "Risk Disclaimer",
      body: "Trading practice screens are for learning and simulation. This platform is not financial advice."
    },
    contact: {
      title: "Contact",
      body: "Need help? Contact support@tradersview.org or call +447418683034."
    }
  },
  paymentMethods: ["Bank Deposit", "EasyPaisa", "Jazz Cash"],
  withdrawalMethods: ["Bank Transfer", "EasyPaisa", "Jazz Cash"],
  automaticGateways: []
};

const { Schema } = mongoose;
const mixed = Schema.Types.Mixed;
const schemaOptions = { timestamps: true, versionKey: false };

const Admin = mongoose.model("Admin", new Schema({
  username: { type: String, unique: true, index: true },
  email: { type: String, unique: true, sparse: true },
  name: String,
  passwordHash: String,
  role: { type: String, default: "admin" },
  status: { type: String, default: "Active" },
  lastLoginAt: String,
  passwordUpdatedAt: String
}, schemaOptions));

const User = mongoose.model("User", new Schema({
  customId: { type: String, unique: true, index: true },
  name: String,
  username: { type: String, unique: true, sparse: true, index: true },
  email: { type: String, unique: true, sparse: true, index: true },
  passwordHash: String,
  role: { type: String, default: "user" },
  balance: { type: Number, default: 0 },
  frozen: { type: Number, default: 0 },
  kyc: { type: String, default: "Required" },
  kycStatus: { type: String, default: "Required" },
  kycData: mixed,
  credit: { type: Number, default: 100 },
  phone: String,
  country: { type: String, default: "PK" },
  status: { type: String, default: "Active" },
  referralCode: String,
  referredBy: String,
  twoFactor: { type: Boolean, default: false },
  emailVerified: { type: Boolean, default: false }
}, schemaOptions));

const Setting = mongoose.model("Setting", new Schema({ key: { type: String, unique: true }, data: mixed }, schemaOptions));
const Coin = mongoose.model("Coin", new Schema({ symbol: { type: String, unique: true }, name: String, color: String, icon: String, status: { type: String, default: "Enabled" } }, schemaOptions));
const Gateway = mongoose.model("Gateway", new Schema({ name: { type: String, unique: true }, type: { type: String, default: "manual" }, status: { type: String, default: "Enabled" }, supportedCurrency: { type: String, default: "PKR" }, credentials: mixed }, schemaOptions));
const TradeDuration = mongoose.model("TradeDuration", new Schema({ label: String, seconds: Number }, schemaOptions));
const Signal = mongoose.model("Signal", new Schema({ crypto: String, direction: String, time: String, schedule: String, status: String }, schemaOptions));

const Deposit = mongoose.model("Deposit", new Schema({
  userId: String, user: String, gateway: String, trx: String, amount: Number, currency: { type: String, default: "PKR" },
  proof: String, proofFile: mixed, status: { type: String, default: "Pending" }, credited: { type: Boolean, default: false }, adminNote: String, date: String
}, schemaOptions));

const Withdrawal = mongoose.model("Withdrawal", new Schema({
  userId: String, user: String, amount: Number, wallet: String, network: String, status: String, adminNote: String, released: Boolean, date: String
}, schemaOptions));

const Trade = mongoose.model("Trade", new Schema({
  userId: String, user: String, crypto: String, amount: Number, seconds: Number, direction: String,
  openPrice: Number, closePrice: Number, profit: Number, result: String, status: String,
  settled: Boolean, createdAtText: String, completedAt: String, endsAt: Number, adminNote: String
}, schemaOptions));

const KycSubmission = mongoose.model("KycSubmission", new Schema({
  userId: String, user: String, fullName: String, documentType: String, documentNumber: String, gender: String,
  hobbies: [String], files: mixed, status: String, adminNote: String, date: String
}, schemaOptions));

const Notification = mongoose.model("Notification", new Schema({ to: String, subject: String, msg: String, read: Boolean, date: String }, schemaOptions));
const NotificationHistory = mongoose.model("NotificationHistory", new Schema({ channel: String, to: String, subject: String, msg: String, recipients: [mixed], recipientCount: Number, startFrom: Number, perBatch: Number, coolingPeriod: Number, status: String, error: String, date: String }, schemaOptions));
const Subscriber = mongoose.model("Subscriber", new Schema({ email: { type: String, unique: true, index: true }, status: String, source: String, date: String }, schemaOptions));
const Ticket = mongoose.model("Ticket", new Schema({ user: String, username: String, subject: String, message: String, priority: String, status: String, messages: Number, createdAtText: String, lastReply: String }, schemaOptions));
const ChatMessage = mongoose.model("ChatMessage", new Schema({ from: String, text: String, ticketId: String, userId: String, date: String }, schemaOptions));
const Transaction = mongoose.model("Transaction", new Schema({ userId: String, type: String, amount: Number, balanceBefore: Number, balanceAfter: Number, remark: String, date: String }, schemaOptions));
const AuditLog = mongoose.model("AuditLog", new Schema({ actor: String, action: String, entity: String, detail: mixed, date: String }, schemaOptions));
const BalanceAdjustment = mongoose.model("BalanceAdjustment", new Schema({ userKey: String, user: String, type: String, amount: Number, balanceAfter: Number, remark: String, date: String }, schemaOptions));
const PasswordResetToken = mongoose.model("PasswordResetToken", new Schema({ userId: String, token: String, expiresAt: Number, used: Boolean, date: String }, schemaOptions));
const SystemAction = mongoose.model("SystemAction", new Schema({ type: String, detail: String, date: String }, schemaOptions));

function now() {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function normalizeEmail(value = "") {
  return cleanText(value).toLowerCase();
}

function validEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function id(prefix) {
  return prefix + crypto.randomBytes(5).toString("hex").toUpperCase();
}

function pkr(amount) {
  return `PKR${Number(amount || 0).toLocaleString("en-PK")}.00 PKR`;
}

function docId(doc) {
  return String(doc?._id || "");
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "7d" });
}

function safeAdmin(admin) {
  if (!admin) return null;
  const obj = admin.toObject ? admin.toObject() : admin;
  delete obj.passwordHash;
  obj.id = docId(admin);
  return obj;
}

function safeUser(user) {
  if (!user) return null;
  const obj = user.toObject ? user.toObject() : user;
  delete obj.passwordHash;
  obj.id = user.customId || docId(user);
  return obj;
}

function pkrOnlyList(items = []) {
  return (items || []).map(item => cleanText(item)).filter(item => item && !/^usdt$/i.test(item) && !/tether/i.test(item));
}

function mergeSettings(current = {}, input = {}) {
  const merged = {
    ...defaultSettings,
    ...current,
    ...input,
    captcha: { ...defaultSettings.captcha, ...(current.captcha || {}), ...(input.captcha || {}) },
    notifications: { ...defaultSettings.notifications, ...(current.notifications || {}), ...(input.notifications || {}) },
    seo: { ...defaultSettings.seo, ...(current.seo || {}), ...(input.seo || {}) },
    frontend: { ...defaultSettings.frontend, ...(current.frontend || {}), ...(input.frontend || {}) },
    language: { ...defaultSettings.language, ...(current.language || {}), ...(input.language || {}) },
    socialLogin: { ...defaultSettings.socialLogin, ...(current.socialLogin || {}), ...(input.socialLogin || {}) },
    oauth: { ...defaultSettings.oauth, ...(current.oauth || {}), ...(input.oauth || {}) },
    gatewayCredentials: { ...defaultSettings.gatewayCredentials, ...(current.gatewayCredentials || {}), ...(input.gatewayCredentials || {}) },
    cron: { ...defaultSettings.cron, ...(current.cron || {}), ...(input.cron || {}) },
    gdpr: { ...defaultSettings.gdpr, ...(current.gdpr || {}), ...(input.gdpr || {}) },
    pages: { ...defaultSettings.pages, ...(current.pages || {}), ...(input.pages || {}) }
  };
  merged.paymentMethods = pkrOnlyList(merged.paymentMethods).length ? pkrOnlyList(merged.paymentMethods) : defaultSettings.paymentMethods;
  merged.withdrawalMethods = pkrOnlyList(merged.withdrawalMethods).length ? pkrOnlyList(merged.withdrawalMethods) : defaultSettings.withdrawalMethods;
  merged.automaticGateways = pkrOnlyList(merged.automaticGateways || []);
  return merged;
}

async function getSettings() {
  const row = await Setting.findOne({ key: "adminSettings" });
  if (!row) return defaultSettings;
  return mergeSettings(row.data || {});
}

async function saveSettings(input) {
  const current = await getSettings();
  const data = mergeSettings(current, input);
  await Setting.updateOne({ key: "adminSettings" }, { $set: { data } }, { upsert: true });
  return data;
}

async function audit(action, entity, detail = {}, actor = "admin") {
  await AuditLog.create({ actor, action, entity, detail, date: now() });
}

async function addTransaction({ userId, type, amount = 0, before = 0, after = 0, remark = "" }) {
  return Transaction.create({ userId, type: cleanText(type), amount: Number(amount || 0), balanceBefore: Number(before || 0), balanceAfter: Number(after || 0), remark: cleanText(remark), date: now() });
}

async function addNotification(subject, msg, to = "All Users") {
  return Notification.create({ to, subject: cleanText(subject), msg: cleanText(msg), date: now(), read: false });
}

function paginateList(items, req) {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25)));
  const search = cleanText(req.query.search).toLowerCase();
  const filtered = search ? items.filter(item => JSON.stringify(item).toLowerCase().includes(search)) : items;
  const start = (page - 1) * limit;
  return { page, limit, total: filtered.length, rows: filtered.slice(start, start + limit) };
}

function uploadPath(file) {
  return file ? `/uploads/${path.relative(uploadRoot, file.path).replace(/\\/g, "/")}` : "";
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const folder = req.uploadFolder === "deposits" ? "deposits" : "kyc";
    cb(null, path.join(uploadRoot, folder));
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 5) * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedUploadExts.has(ext)) return cb(new Error("Only jpg, jpeg, png, webp, and pdf files are allowed."));
    cb(null, true);
  }
});

function setUploadFolder(folder) {
  return (req, _res, next) => {
    req.uploadFolder = folder;
    next();
  };
}

function authOptional(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return next();
  try {
    req.auth = jwt.verify(token, JWT_SECRET);
  } catch {
    req.auth = null;
  }
  return next();
}

async function adminAuth(req, res, next) {
  authOptional(req, res, async () => {
    try {
      if (!req.auth || req.auth.role !== "admin") return res.status(403).json({ ok: false, error: "Admin login required." });
      const admin = mongoose.isValidObjectId(req.auth.sub)
        ? await Admin.findById(req.auth.sub)
        : await Admin.findOne({ $or: [{ username: cleanText(req.auth.sub) }, { email: normalizeEmail(req.auth.sub) }] });
      if (!admin || admin.status === "Disabled") return res.status(403).json({ ok: false, error: "Admin login required." });
      req.admin = admin;
      next();
    } catch (err) {
      next(err);
    }
  });
}

async function currentUser(req) {
  if (req.auth?.role === "user" && req.auth.sub) {
    const user = await findUserRecord(req.auth.sub);
    if (user) return user;
  }
  return User.findOne({ username: process.env.DEMO_USERNAME || "demo" });
}

async function findUserRecord(userKey) {
  const key = cleanText(userKey);
  if (!key) return null;
  const clauses = [{ customId: key }, { email: key }, { username: key }, { name: key }];
  if (mongoose.isValidObjectId(key)) clauses.unshift({ _id: key });
  return User.findOne({ $or: clauses });
}

async function allAdminUsers() {
  const users = await User.find({ role: { $ne: "admin" } }).sort({ createdAt: -1 });
  return users.map((user, index) => ({
    key: user.customId || docId(user),
    id: docId(user),
    name: user.name,
    email: user.email,
    balance: Number(user.balance || 0),
    index,
    kind: "mongo",
    status: user.status || "Active",
    country: user.country || "PK"
  }));
}

async function resolveNotificationRecipients(group = "All Users") {
  const users = await allAdminUsers();
  const pending = await KycSubmission.find({ status: "Pending" }).select("userId user");
  const approved = await KycSubmission.find({ status: "Approved" }).select("userId user");
  const pendingSet = new Set(pending.flatMap(k => [k.userId, k.user].filter(Boolean)));
  const approvedSet = new Set(approved.flatMap(k => [k.userId, k.user].filter(Boolean)));
  const key = cleanText(group).toLowerCase();
  if (key.includes("active")) return users.filter(user => user.status !== "Banned");
  if (key.includes("pending")) return users.filter(user => pendingSet.has(user.id) || pendingSet.has(user.key) || pendingSet.has(user.name));
  if (key.includes("unverified")) return users.filter(user => !approvedSet.has(user.id) && !approvedSet.has(user.key) && !approvedSet.has(user.name));
  if (key.includes("balance")) return users.filter(user => Number(user.balance || 0) > 0);
  return users;
}

async function livePrices() {
  const current = Date.now();
  if (priceCache.prices && current - priceCache.at < 5000) return priceCache.prices;
  const coins = await Coin.find({ symbol: { $ne: "PKR" }, status: { $ne: "Disabled" } });
  const symbols = coins.map(c => c.symbol);
  const prices = {};
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const response = await fetch("https://api.binance.com/api/v3/ticker/price", { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) throw new Error("Binance price request failed.");
    const list = await response.json();
    const usdt = Object.fromEntries(list.filter(item => item.symbol.endsWith("USDT")).map(item => [item.symbol.replace("USDT", ""), Number(item.price)]));
    for (const sym of symbols) {
      const usd = Number(usdt[sym]);
      if (Number.isFinite(usd) && usd > 0) prices[sym] = { pkr: Math.round(usd * PKR_RATE), source: "binance" };
    }
  } catch {
    symbols.forEach((sym, index) => {
      prices[sym] = { pkr: Math.round((18800000 / (index + 1)) + Math.random() * 15000), source: "local-fallback" };
    });
  }
  priceCache.at = current;
  priceCache.prices = prices;
  return prices;
}

async function autoResult(settings) {
  if (["Win", "Loss", "Draw"].includes(settings.defaultTradeResult)) return settings.defaultTradeResult;
  return ["Win", "Loss", "Draw"][Math.floor(Math.random() * 3)];
}

async function settleTrade(trade, result, closePrice = 0) {
  if (!trade || trade.settled) return trade;
  const user = await findUserRecord(trade.userId);
  if (!user) return trade;
  const amount = Number(trade.amount || 0);
  const before = Number(user.balance || 0);
  let payout = 0;
  let profit = 0;
  if (result === "Win") {
    profit = Math.round(amount * PROFIT_RATE);
    payout = amount + profit;
  } else if (result === "Draw") {
    payout = amount;
  }
  user.balance = Math.max(0, before + payout);
  user.frozen = Math.max(0, Number(user.frozen || 0) - amount);
  await user.save();
  trade.result = result;
  trade.status = "Completed";
  trade.completedAt = trade.completedAt || now();
  trade.endsAt = Date.now();
  trade.closePrice = Number(closePrice || trade.closePrice || trade.openPrice || 0);
  trade.profit = result === "Loss" ? -amount : profit;
  trade.settled = true;
  await trade.save();
  await addTransaction({ userId: user.customId || docId(user), type: `Trade ${result}`, amount: result === "Loss" ? -amount : payout, before, after: user.balance, remark: `${trade.crypto} ${trade.direction}` });
  await addNotification("Trade Completed", `${trade.crypto} ${trade.direction} trade completed as ${result}.`, user.customId || docId(user));
  io?.emit("trade:settled", tradeForState(trade));
  return trade;
}

async function syncTrades() {
  const running = await Trade.find({ status: "Running", endsAt: { $lte: Date.now() } });
  if (!running.length) return;
  const settings = await getSettings();
  const prices = await livePrices();
  for (const trade of running) {
    const symbol = cleanText(trade.crypto).split(" ")[0];
    await settleTrade(trade, await autoResult(settings), prices[symbol]?.pkr || trade.openPrice);
    trade.adminNote = trade.adminNote || "Auto completed by backend timer";
    await trade.save();
  }
}

function userForState(user) {
  return {
    id: user.customId || docId(user),
    name: user.name,
    username: user.username,
    email: user.email,
    balance: Number(user.balance || 0),
    frozen: Number(user.frozen || 0),
    kyc: user.kycStatus || user.kyc || "Required",
    kycStatus: user.kycStatus || "Required",
    kycData: user.kycData || {},
    credit: Number(user.credit || 100),
    twoFactor: Boolean(user.twoFactor),
    phone: user.phone || "",
    country: user.country || "PK",
    referralCode: user.referralCode || user.username
  };
}

function coinForState(coin) {
  return [coin.symbol, coin.name, coin.color, coin.icon];
}

function tradeForState(trade) {
  return {
    id: docId(trade),
    userId: trade.userId,
    user: trade.user,
    crypto: trade.crypto,
    amount: trade.amount,
    seconds: trade.seconds,
    direction: trade.direction,
    openPrice: trade.openPrice,
    closePrice: trade.closePrice,
    profit: trade.profit,
    result: trade.result || "",
    status: trade.status,
    settled: Boolean(trade.settled),
    createdAt: trade.createdAtText || now(),
    completedAt: trade.completedAt,
    endsAt: trade.endsAt,
    adminNote: trade.adminNote
  };
}

function depositForState(deposit) {
  const proof = deposit.proof || deposit.proofFile?.path || "";
  return {
    id: docId(deposit), userId: deposit.userId, gateway: deposit.gateway, trx: deposit.trx, proof,
    proofFile: deposit.proofFile, user: deposit.user, amount: deposit.amount, currency: deposit.currency || "PKR",
    status: deposit.status, credited: Boolean(deposit.credited), adminNote: deposit.adminNote, date: deposit.date
  };
}

function transactionForState(item) {
  return { id: docId(item), userId: item.userId, type: item.type, amount: item.amount, balanceBefore: item.balanceBefore, balanceAfter: item.balanceAfter, remark: item.remark, date: item.date };
}

async function buildState(req) {
  await syncTrades();
  const [
    settings, current, users, coins, durations, gateways, trades, deposits, withdrawals,
    transactions, kyc, notifications, history, tickets, chat, signals, subscribers, auditLogs, adjustments
  ] = await Promise.all([
    getSettings(),
    currentUser(req),
    User.find({ role: { $ne: "admin" } }).sort({ createdAt: -1 }),
    Coin.find().sort({ createdAt: 1 }),
    TradeDuration.find().sort({ seconds: -1 }),
    Gateway.find().sort({ createdAt: 1 }),
    Trade.find().sort({ createdAt: -1 }).limit(500),
    Deposit.find().sort({ createdAt: -1 }).limit(500),
    Withdrawal.find().sort({ createdAt: -1 }).limit(500),
    Transaction.find().sort({ createdAt: -1 }).limit(1000),
    KycSubmission.find().sort({ createdAt: -1 }).limit(500),
    Notification.find().sort({ createdAt: -1 }).limit(500),
    NotificationHistory.find().sort({ createdAt: -1 }).limit(500),
    Ticket.find().sort({ createdAt: -1 }).limit(500),
    ChatMessage.find().sort({ createdAt: 1 }).limit(500),
    Signal.find().sort({ createdAt: -1 }),
    Subscriber.find().sort({ createdAt: -1 }),
    AuditLog.find().sort({ createdAt: -1 }).limit(500),
    BalanceAdjustment.find().sort({ createdAt: -1 }).limit(500)
  ]);
  const user = current || users[0];
  const isAdmin = req.auth?.role === "admin";
  const userKey = user.customId || docId(user);
  const userMongoId = docId(user);
  const belongsToUser = item => [item.userId, item.user, item.username].some(value => [userKey, userMongoId, user.name, user.username].includes(String(value || "")));
  const notificationForUser = item => {
    const target = cleanText(item.to);
    return ["All Users", "Active Users", userKey, userMongoId, user.name, user.username].includes(target);
  };
  const visibleDeposits = isAdmin ? deposits : deposits.filter(belongsToUser);
  const visibleTrades = isAdmin ? trades : trades.filter(belongsToUser);
  const visibleWithdrawals = isAdmin ? withdrawals : withdrawals.filter(belongsToUser);
  const visibleTransactions = isAdmin ? transactions : transactions.filter(belongsToUser);
  const visibleNotifications = isAdmin ? notifications : notifications.filter(notificationForUser);
  const visibleTickets = isAdmin ? tickets : tickets.filter(belongsToUser);
  const visibleChat = isAdmin ? chat : chat.filter(belongsToUser);
  const visibleKyc = isAdmin ? kyc : kyc.filter(belongsToUser);
  const coinStatuses = Object.fromEntries(coins.map(c => [c.symbol, c.status || "Enabled"]));
  const gatewayStatuses = Object.fromEntries(gateways.map(g => [g.name, g.status || "Enabled"]));
  const userStatuses = Object.fromEntries(users.map(u => [u.customId || docId(u), u.status || "Active"]));
  return {
    user: userForState(user),
    coins: coins.map(coinForState),
    tradeDurations: durations.map(item => ({ label: item.label, seconds: item.seconds })),
    adminSettings: settings,
    deposits: visibleDeposits.map(depositForState),
    trades: visibleTrades.map(tradeForState),
    users: isAdmin ? users.filter(u => (u.customId || docId(u)) !== userKey).map(u => [u.name, u.customId || docId(u), u.email, u.country || "PK", Number(u.balance || 0)]) : [],
    notifications: visibleNotifications.map(n => ({ id: docId(n), to: n.to, subject: n.subject, msg: n.msg, read: Boolean(n.read), date: n.date })),
    notificationHistory: isAdmin ? history.map(h => ({ id: docId(h), channel: h.channel, to: h.to, subject: h.subject, msg: h.msg, recipients: h.recipients, recipientCount: h.recipientCount, startFrom: h.startFrom, perBatch: h.perBatch, coolingPeriod: h.coolingPeriod, status: h.status, error: h.error, date: h.date })) : [],
    tickets: visibleTickets.map(t => ({ id: docId(t), user: t.user, username: t.username, subject: t.subject, message: t.message, priority: t.priority, status: t.status, messages: t.messages, createdAt: t.createdAtText, lastReply: t.lastReply })),
    chat: visibleChat.map(m => ({ id: docId(m), from: m.from, text: m.text, ticketId: m.ticketId, userId: m.userId, date: m.date })),
    signals: signals.map(s => ({ id: docId(s), crypto: s.crypto, direction: s.direction, time: s.time, schedule: s.schedule, status: s.status })),
    withdrawals: visibleWithdrawals.map(w => ({ id: docId(w), userId: w.userId, user: w.user, amount: w.amount, wallet: w.wallet, network: w.network, status: w.status, adminNote: w.adminNote, released: w.released, date: w.date })),
    transactions: visibleTransactions.map(transactionForState),
    referrals: [],
    kycSubmissions: visibleKyc.map(k => ({ id: docId(k), userId: k.userId, user: k.user, fullName: k.fullName, documentType: k.documentType, documentNumber: k.documentNumber, gender: k.gender, hobbies: k.hobbies || [], files: k.files || {}, status: k.status, adminNote: k.adminNote, date: k.date })),
    subscribers: isAdmin ? subscribers.map(s => ({ id: docId(s), email: s.email, status: s.status, source: s.source, date: s.date })) : [],
    auditLogs: isAdmin ? auditLogs.map(log => ({ id: docId(log), actor: log.actor, action: log.action, entity: log.entity, detail: log.detail, date: log.date })) : [],
    coinStatuses: isAdmin ? coinStatuses : {},
    gatewayStatuses: isAdmin ? gatewayStatuses : {},
    userStatuses: isAdmin ? userStatuses : {},
    balanceAdjustments: isAdmin ? adjustments.map(a => ({ id: docId(a), userKey: a.userKey, user: a.user, type: a.type, amount: a.amount, balanceAfter: a.balanceAfter, remark: a.remark, date: a.date })) : [],
    serverTime: Date.now()
  };
}

async function seedDefaults() {
  if (!await Setting.findOne({ key: "adminSettings" })) await saveSettings(defaultSettings);
  if (!await Admin.findOne({ username: process.env.ADMIN_USERNAME || "admin" })) {
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (adminPassword && adminPassword !== "change-this-admin-password") {
      await Admin.create({
        username: process.env.ADMIN_USERNAME || "admin",
        email: process.env.ADMIN_EMAIL || "admin@tradersview.pk",
        name: "admin",
        role: "admin",
        status: "Active",
        passwordHash: await bcrypt.hash(adminPassword, 10)
      });
    } else {
      console.warn("Admin account was not auto-created. Set ADMIN_PASSWORD and run: npm run seed:admin");
    }
  }
  if (!await User.findOne({ username: process.env.DEMO_USERNAME || "demo" })) {
    await User.create({
      customId: "u-demo",
      name: "Demo User",
      username: process.env.DEMO_USERNAME || "demo",
      email: process.env.DEMO_EMAIL || "demo@tradersview.pk",
      passwordHash: await bcrypt.hash(process.env.DEMO_PASSWORD || "demo123", 10),
      balance: Number(process.env.DEMO_BALANCE || 120000),
      frozen: 0,
      kyc: "Required",
      kycStatus: "Required",
      credit: 100,
      country: "PK",
      referralCode: id("REF")
    });
  }
  if (await Coin.countDocuments() === 0) await Coin.insertMany(coinsSeed.map(c => ({ symbol: c[0], name: c[1], color: c[2], icon: c[3], status: c[0] === "PKR" ? "System" : "Enabled" })));
  if (await TradeDuration.countDocuments() === 0) {
    await TradeDuration.insertMany([
      { label: "25 minutes", seconds: 1500 }, { label: "10 minutes", seconds: 600 }, { label: "5 minutes", seconds: 300 },
      { label: "3 minutes", seconds: 180 }, { label: "2 minutes", seconds: 120 }, { label: "30 seconds", seconds: 30 }, { label: "10 seconds", seconds: 10 }
    ]);
  }
  if (await Gateway.countDocuments() === 0) {
    await Gateway.insertMany(defaultSettings.paymentMethods.map(name => ({ name, type: "manual", status: "Enabled", supportedCurrency: "PKR" })));
  }
  if (await Signal.countDocuments() === 0) {
    await Signal.create({ crypto: "BTC", direction: "High / Long", time: "3 minutes", schedule: "Manual / Always", status: "Active" });
  }
}

async function notificationDeliveryStatus(channel) {
  if (channel === "email") return process.env.SMTP_HOST ? "queued-smtp" : "saved-email-placeholder";
  if (channel === "sms") return process.env.SMS_PROVIDER_URL ? "queued-sms-placeholder" : "saved-sms-placeholder";
  if (channel === "firebase") return process.env.FIREBASE_PROJECT_ID ? "queued-firebase-placeholder" : "saved-firebase-placeholder";
  return "saved";
}

async function deliverNotification(history) {
  if (history.channel === "email" && process.env.SMTP_HOST) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" } : undefined
      });
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: history.recipients.map(user => user.email).filter(Boolean).join(","),
        subject: history.subject,
        text: history.msg,
        html: `<p>${cleanText(history.msg).replace(/\n/g, "<br>")}</p>`
      });
      history.status = "sent-email";
      await history.save();
    } catch (err) {
      history.status = "email-error";
      history.error = err.message;
      await history.save();
    }
  }
}

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(uploadRoot, { maxAge: "1h" }));
app.get(["/", "/index.html"], (_req, res) => res.sendFile(path.join(root, "index.html")));
app.get("/app.js", (_req, res) => res.sendFile(path.join(root, "app.js")));
app.get("/styles.css", (_req, res) => res.sendFile(path.join(root, "styles.css")));

app.get("/api/state", authOptional, async (req, res, next) => {
  try {
    if (req.query.scope === "admin") {
      if (!req.auth || req.auth.role !== "admin") return res.status(403).json({ ok: false, error: "Admin login required." });
      const admin = mongoose.isValidObjectId(req.auth.sub)
        ? await Admin.findById(req.auth.sub)
        : await Admin.findOne({ $or: [{ username: cleanText(req.auth.sub) }, { email: normalizeEmail(req.auth.sub) }] });
      if (!admin || admin.status === "Disabled") return res.status(403).json({ ok: false, error: "Admin login required." });
      req.admin = admin;
    }
    res.json(await buildState(req));
  } catch (err) { next(err); }
});

app.get("/api/prices", async (_req, res, next) => {
  try { res.json({ ok: true, prices: await livePrices(), updatedAt: Date.now() }); } catch (err) { next(err); }
});

app.post("/api/auth", async (req, res, next) => {
  try {
    const username = cleanText(req.body.username || req.body.email || req.body.identifier);
    const email = normalizeEmail(req.body.email);
    const password = cleanText(req.body.password);
    if (req.body.role === "admin") {
      const key = normalizeEmail(username);
      const admin = await Admin.findOne({ $or: [{ username: key }, { email: key }] });
      if (!admin || admin.status === "Disabled" || !await bcrypt.compare(password, admin.passwordHash)) {
        await audit("failed-login", "auth", { role: "admin", username }, username || "unknown");
        return res.status(401).json({ ok: false, error: "Invalid admin credentials." });
      }
      admin.lastLoginAt = now();
      await admin.save();
      await audit("login", "auth", { role: "admin", adminId: docId(admin) }, admin.username);
      return res.json({ ok: true, user: safeAdmin(admin), token: signToken({ sub: docId(admin), role: "admin" }), role: "admin" });
    }
    if (req.body.mode === "register" || (email && username && password)) {
      const cleanUsername = cleanText(username).toLowerCase();
      if (cleanUsername === "admin") return res.status(400).json({ ok: false, error: "This username is reserved." });
      if (!validEmail(email)) return res.status(400).json({ ok: false, error: "Valid email is required." });
      if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(cleanUsername)) return res.status(400).json({ ok: false, error: "Username must be 3-30 letters or numbers." });
      if (password.length < 6) return res.status(400).json({ ok: false, error: "Password must be at least 6 characters." });
      if (await User.findOne({ $or: [{ email }, { username: cleanUsername }] })) return res.status(409).json({ ok: false, error: "Email or username already exists." });
      const user = await User.create({
        customId: id("U"),
        name: cleanText(req.body.name, cleanUsername),
        email,
        username: cleanUsername,
        passwordHash: await bcrypt.hash(password, 10),
        role: "user",
        balance: 0,
        referralCode: id("REF"),
        referredBy: cleanText(req.body.referredBy),
        kycStatus: "Required",
        country: "PK"
      });
      await addTransaction({ userId: user.customId, type: "Account Created", remark: "Registration" });
      await addNotification("Welcome", "Your account has been created.", user.customId);
      await audit("register", "auth", { userId: user.customId }, user.username);
      return res.status(201).json({ ok: true, user: safeUser(user), token: signToken({ sub: docId(user), role: "user" }), role: "user" });
    }
    const key = normalizeEmail(username);
    const user = await User.findOne({ $or: [{ username: key }, { email: key }] });
    if (!user || !await bcrypt.compare(password, user.passwordHash)) return res.status(401).json({ ok: false, error: "Invalid login details." });
    if (user.status === "Banned") return res.status(403).json({ ok: false, error: "Your account is banned." });
    await audit("login", "auth", { role: "user" }, user.username);
    return res.json({ ok: true, user: safeUser(user), token: signToken({ sub: docId(user), role: "user" }), role: "user" });
  } catch (err) { next(err); }
});

app.post("/api/auth/forgot-password", async (req, res, next) => {
  try {
    const identifier = normalizeEmail(req.body.email || req.body.username);
    const user = await User.findOne({ $or: [{ email: identifier }, { username: identifier }] });
    const token = crypto.randomBytes(20).toString("hex");
    if (user) await PasswordResetToken.create({ userId: docId(user), token, expiresAt: Date.now() + 30 * 60 * 1000, used: false, date: now() });
    res.json({ ok: true, resetToken: token, message: "Reset request saved." });
  } catch (err) { next(err); }
});

app.post("/api/auth/reset-password", async (req, res, next) => {
  try {
    const password = cleanText(req.body.password);
    if (password.length < 6) return res.status(400).json({ ok: false, error: "Password must be at least 6 characters." });
    const reset = await PasswordResetToken.findOne({ token: cleanText(req.body.token), used: false, expiresAt: { $gt: Date.now() } });
    if (!reset) return res.status(400).json({ ok: false, error: "Reset token is invalid or expired." });
    const user = await User.findById(reset.userId);
    if (user) {
      user.passwordHash = await bcrypt.hash(password, 10);
      await user.save();
    }
    reset.used = true;
    await reset.save();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.post("/api/profile", authOptional, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const name = cleanText(req.body.name);
    const email = normalizeEmail(req.body.email);
    if (name.length < 2) return res.status(400).json({ ok: false, error: "Name is required." });
    if (!validEmail(email)) return res.status(400).json({ ok: false, error: "Valid email is required." });
    user.name = name;
    user.email = email;
    user.phone = cleanText(req.body.phone);
    user.country = cleanText(req.body.country, "PK").toUpperCase();
    await user.save();
    await audit("update", "profile", { user: user.username }, user.username);
    res.json({ ok: true, user: userForState(user) });
  } catch (err) { next(err); }
});

app.post("/api/security/password", authOptional, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const password = cleanText(req.body.password);
    if (password.length < 6) return res.status(400).json({ ok: false, error: "Password must be at least 6 characters." });
    user.passwordHash = await bcrypt.hash(password, 10);
    await user.save();
    await audit("update", "password", { user: user.username }, user.username);
    res.json({ ok: true, updatedAt: now() });
  } catch (err) { next(err); }
});

app.post("/api/security/2fa", authOptional, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    user.twoFactor = Boolean(req.body.enabled);
    await user.save();
    res.json({ ok: true, twoFactor: user.twoFactor });
  } catch (err) { next(err); }
});

app.post("/api/kyc", authOptional, setUploadFolder("kyc"), upload.fields([
  { name: "front", maxCount: 1 }, { name: "back", maxCount: 1 }, { name: "photo", maxCount: 1 }, { name: "kycFront", maxCount: 1 }, { name: "kycBack", maxCount: 1 }, { name: "kycFile", maxCount: 1 }
]), async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const fullName = cleanText(req.body.fullName || req.body.name);
    const documentNumber = cleanText(req.body.documentNumber || req.body.cnic);
    if (fullName.length < 2) return res.status(400).json({ ok: false, error: "Full name is required." });
    if (documentNumber.length < 5) return res.status(400).json({ ok: false, error: "Document number is required." });
    const files = {
      front: req.files?.front?.[0] || req.files?.kycFront?.[0],
      back: req.files?.back?.[0] || req.files?.kycBack?.[0],
      photo: req.files?.photo?.[0] || req.files?.kycFile?.[0]
    };
    if (!files.front || !files.back || !files.photo) return res.status(400).json({ ok: false, error: "CNIC front, back, and photo files are required." });
    const kycFiles = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, { originalName: file.originalname, path: uploadPath(file), size: file.size, type: file.mimetype, date: now() }]));
    const hobbies = Array.isArray(req.body.hobbies) ? req.body.hobbies : cleanText(req.body.hobbies).split(",").map(x => x.trim()).filter(Boolean);
    const kyc = await KycSubmission.create({ userId: user.customId || docId(user), user: user.name, fullName, documentType: cleanText(req.body.documentType, "CNIC"), documentNumber, gender: cleanText(req.body.gender), hobbies, files: kycFiles, status: "Pending", adminNote: "", date: now() });
    user.kyc = "Pending";
    user.kycStatus = "Pending";
    await user.save();
    await addNotification("KYC Submitted", "Your KYC request is pending admin review.", user.customId || docId(user));
    await audit("create", "kyc", { kycId: docId(kyc) }, user.username);
    res.status(201).json({ ok: true, kyc: { id: docId(kyc), ...kyc.toObject() } });
  } catch (err) { next(err); }
});

app.post("/api/deposits", authOptional, setUploadFolder("deposits"), upload.single("proofFile"), async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const amount = Number(req.body.amount || 0);
    const gatewayName = cleanText(req.body.gateway, "Bank Deposit");
    if (!amount || amount < 1) return res.status(400).json({ ok: false, error: "Enter PKR amount." });
    const gateway = await Gateway.findOne({ name: gatewayName, type: "manual", status: { $ne: "Disabled" } });
    if (!gateway) return res.status(400).json({ ok: false, error: "Only enabled manual PKR deposit methods are allowed." });
    const trx = cleanText(req.body.transactionId);
    if (trx.length < 3) return res.status(400).json({ ok: false, error: "Transaction ID is required." });
    if (!req.file) return res.status(400).json({ ok: false, error: "Payment screenshot/proof is required." });
    const proofFile = { originalName: req.file.originalname, path: uploadPath(req.file), size: req.file.size, type: req.file.mimetype, date: now() };
    const deposit = await Deposit.create({ userId: user.customId || docId(user), gateway: gatewayName, trx, proof: proofFile.path, proofFile, user: user.name, amount, currency: "PKR", status: "Pending", credited: false, adminNote: "", date: now() });
    await addTransaction({ userId: user.customId || docId(user), type: "Deposit Requested", amount, before: user.balance, after: user.balance, remark: gatewayName });
    await addNotification("Deposit Requested", `Your ${gatewayName} deposit request is pending.`, user.customId || docId(user));
    await audit("create", "deposit", { id: docId(deposit), gateway: gatewayName, amount }, user.username);
    io?.emit("deposit:created", depositForState(deposit));
    res.status(201).json({ ok: true, deposit: depositForState(deposit) });
  } catch (err) { next(err); }
});

app.post("/api/trades", authOptional, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const seconds = Number(req.body.seconds || 180);
    const amount = Number(req.body.amount || 0);
    const duration = await TradeDuration.findOne({ seconds });
    if (!amount || amount < 1) return res.status(400).json({ ok: false, error: "Enter PKR amount first." });
    if (!duration) return res.status(400).json({ ok: false, error: "Invalid trade duration." });
    const symbol = cleanText(req.body.symbol, "BTC").toUpperCase();
    const coin = await Coin.findOne({ symbol, status: { $ne: "Disabled" } });
    if (!coin || symbol === "PKR") return res.status(400).json({ ok: false, error: "Coin is not available." });
    if (Number(user.balance || 0) < amount) return res.status(400).json({ ok: false, error: "Insufficient PKR balance." });
    const prices = await livePrices();
    const before = Number(user.balance || 0);
    user.balance = before - amount;
    user.frozen = Number(user.frozen || 0) + amount;
    await user.save();
    const trade = await Trade.create({ userId: user.customId || docId(user), user: user.name, crypto: `${symbol} - PKR`, amount, seconds, direction: req.body.direction === "Down" ? "Down" : "Up", openPrice: Number(prices[symbol]?.pkr || 0), closePrice: 0, profit: 0, result: "", status: "Running", settled: false, createdAtText: now(), endsAt: Date.now() + seconds * 1000, adminNote: "Waiting for admin result or timer" });
    await addTransaction({ userId: user.customId || docId(user), type: "Trade Started", amount: -amount, before, after: user.balance, remark: `${trade.crypto} ${trade.direction}` });
    await audit("create", "trade", { id: docId(trade), crypto: trade.crypto, amount }, user.username);
    io?.emit("trade:created", tradeForState(trade));
    res.status(201).json({ ok: true, trade: tradeForState(trade) });
  } catch (err) { next(err); }
});

app.post("/api/withdrawals", authOptional, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const settings = await getSettings();
    const amount = Number(req.body.amount || 0);
    const min = Number(settings.withdrawMin || 500);
    const max = Number(settings.withdrawMax || 500000);
    if (!amount || amount < min) return res.status(400).json({ ok: false, error: `Minimum withdrawal is ${pkr(min)}.` });
    if (amount > max) return res.status(400).json({ ok: false, error: `Maximum withdrawal is ${pkr(max)}.` });
    if (Number(user.balance || 0) < amount) return res.status(400).json({ ok: false, error: "Insufficient PKR balance." });
    const wallet = cleanText(req.body.wallet);
    if (wallet.length < 5) return res.status(400).json({ ok: false, error: "Wallet/account number is required." });
    const before = Number(user.balance || 0);
    user.balance = before - amount;
    await user.save();
    const withdrawal = await Withdrawal.create({ userId: user.customId || docId(user), user: user.name, amount, wallet, network: cleanText(req.body.network, "PKR Bank"), status: "Pending", adminNote: "", released: false, date: now() });
    await addTransaction({ userId: user.customId || docId(user), type: "Withdrawal Requested", amount: -amount, before, after: user.balance, remark: withdrawal.network });
    await addNotification("Withdrawal Requested", `${pkr(amount)} withdrawal request is pending.`, user.customId || docId(user));
    res.status(201).json({ ok: true, withdrawal });
  } catch (err) { next(err); }
});

app.post("/api/tickets", authOptional, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const subject = cleanText(req.body.subject);
    const message = cleanText(req.body.message);
    if (subject.length < 3) return res.status(400).json({ ok: false, error: "Ticket subject is required." });
    if (message.length < 5) return res.status(400).json({ ok: false, error: "Ticket message is required." });
    const ticket = await Ticket.create({ user: user.name, username: user.username, subject, message, priority: cleanText(req.body.priority, "Normal"), status: "Open", messages: 1, createdAtText: now(), lastReply: "" });
    const chat = await ChatMessage.create({ from: "user", text: `${subject}: ${message}`, ticketId: docId(ticket), userId: user.customId || docId(user), date: now() });
    io?.emit("chat:message", { id: docId(chat), from: chat.from, text: chat.text, ticketId: chat.ticketId, userId: chat.userId, date: chat.date });
    await audit("create", "ticket", { ticketId: docId(ticket), subject }, user.username);
    res.status(201).json({ ok: true, ticket });
  } catch (err) { next(err); }
});

app.post("/api/chat", authOptional, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const text = cleanText(req.body.text);
    if (text.length < 1) return res.status(400).json({ ok: false, error: "Message is required." });
    const message = await ChatMessage.create({ from: cleanText(req.body.from, "user"), text, ticketId: cleanText(req.body.ticketId), userId: user?.customId || docId(user), date: now() });
    const payload = { id: docId(message), from: message.from, text: message.text, ticketId: message.ticketId, userId: message.userId, date: message.date };
    io?.emit("chat:message", payload);
    res.status(201).json({ ok: true, message: payload });
  } catch (err) { next(err); }
});

app.post("/api/notifications/:id", authOptional, async (req, res, next) => {
  try {
    const notification = await Notification.findById(req.params.id);
    if (!notification) return res.status(404).json({ ok: false, error: "Notification not found." });
    notification.read = true;
    await notification.save();
    res.json({ ok: true, notification });
  } catch (err) { next(err); }
});

app.get("/api/transactions", async (req, res, next) => {
  try { res.json({ ok: true, ...paginateList((await Transaction.find().sort({ createdAt: -1 })).map(transactionForState), req) }); } catch (err) { next(err); }
});
app.get("/api/withdrawals", async (req, res, next) => {
  try { res.json({ ok: true, ...paginateList(await Withdrawal.find().sort({ createdAt: -1 }), req) }); } catch (err) { next(err); }
});
app.get("/api/kyc", async (req, res, next) => {
  try { res.json({ ok: true, ...paginateList(await KycSubmission.find().sort({ createdAt: -1 }), req) }); } catch (err) { next(err); }
});

app.post("/api/newsletter/subscribe", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!validEmail(email)) return res.status(400).json({ ok: false, error: "Valid email is required." });
    if (await Subscriber.findOne({ email })) return res.status(409).json({ ok: false, error: "This email is already subscribed." });
    const subscriber = await Subscriber.create({ email, status: "Active", source: "footer", date: now() });
    await audit("create", "subscriber", { email }, email);
    res.status(201).json({ ok: true, subscriber: { id: docId(subscriber), email: subscriber.email, status: subscriber.status, date: subscriber.date } });
  } catch (err) { next(err); }
});

app.use("/api/admin", adminAuth);

app.get("/api/admin/subscribers", async (req, res, next) => {
  try { res.json({ ok: true, ...paginateList((await Subscriber.find().sort({ createdAt: -1 })).map(s => ({ id: docId(s), email: s.email, status: s.status, date: s.date })), req) }); } catch (err) { next(err); }
});

app.delete("/api/admin/subscribers/:id", async (req, res, next) => {
  try {
    const key = decodeURIComponent(req.params.id);
    const deleted = await Subscriber.findOneAndDelete({ $or: [{ _id: mongoose.isValidObjectId(key) ? key : undefined }, { email: normalizeEmail(key) }].filter(Boolean) });
    if (!deleted) return res.status(404).json({ ok: false, error: "Subscriber not found." });
    await audit("delete", "subscriber", { id: key }, req.admin.username);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.post("/api/admin/password", async (req, res, next) => {
  try {
    const currentPassword = cleanText(req.body.currentPassword);
    const newPassword = cleanText(req.body.newPassword);
    if (!await bcrypt.compare(currentPassword, req.admin.passwordHash)) return res.status(400).json({ ok: false, error: "Current password is incorrect." });
    if (newPassword.length < 6) return res.status(400).json({ ok: false, error: "New password must be at least 6 characters." });
    req.admin.passwordHash = await bcrypt.hash(newPassword, 10);
    req.admin.passwordUpdatedAt = now();
    await req.admin.save();
    await saveSettings({ adminSecurity: { twoFactor: Boolean(req.body.twoFactor), passwordUpdatedAt: req.admin.passwordUpdatedAt, passwordHint: "Password updated from admin password page" } });
    await audit("update", "admin-password", { adminId: docId(req.admin) }, req.admin.username);
    res.json({ ok: true, admin: safeAdmin(req.admin) });
  } catch (err) { next(err); }
});

app.get("/api/admin/system/info", async (_req, res, next) => {
  try {
    const systemActions = await SystemAction.find().sort({ createdAt: -1 }).limit(10);
    res.json({
      ok: true,
      app: { name: (await getSettings()).siteName, version: APP_VERSION, backend: "Express.js", node: process.version, environment: process.env.NODE_ENV || "development", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, dataStore: "MongoDB / Mongoose", uptime: Math.round(process.uptime()) },
      server: { software: "Node.js Express Server", host: HOST, port: PORT, protocol: "HTTP/1.1", address: HOST, memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024), platform: process.platform },
      cache: { priceCacheAgeMs: priceCache.at ? Date.now() - priceCache.at : 0, rateBuckets: 0, lastActions: systemActions },
      updates: { currentVersion: APP_VERSION, latestVersion: APP_VERSION, status: "Current", logs: [] }
    });
  } catch (err) { next(err); }
});

app.post("/api/admin/system/cache-clear", async (req, res, next) => {
  try {
    priceCache.at = 0;
    priceCache.prices = null;
    const action = await SystemAction.create({ type: "Cache Clear", detail: "Price cache cleared", date: now() });
    await audit("clear", "system-cache", { actionId: docId(action) }, req.admin.username);
    res.json({ ok: true, action, message: "System cache cleared." });
  } catch (err) { next(err); }
});

app.post("/api/admin/system/update-check", async (req, res, next) => {
  try {
    const action = await SystemAction.create({ type: "Update Check", detail: "Application is running the local latest version.", date: now() });
    await audit("check", "system-update", { version: APP_VERSION }, req.admin.username);
    res.json({ ok: true, currentVersion: APP_VERSION, latestVersion: APP_VERSION, status: "Current", log: action });
  } catch (err) { next(err); }
});

app.get("/api/admin/audit", async (req, res, next) => {
  try { res.json({ ok: true, ...paginateList(await AuditLog.find().sort({ createdAt: -1 }), req) }); } catch (err) { next(err); }
});

app.get("/api/admin/list/:resource", async (req, res, next) => {
  try {
    const resource = req.params.resource;
    const state = await buildState(req);
    const collections = {
      coins: state.coins.map(c => ({ symbol: c[0], name: c[1], color: c[2], icon: c[3], status: state.coinStatuses[c[0]] || "Enabled" })),
      trades: state.trades,
      deposits: state.deposits,
      withdrawals: state.withdrawals,
      users: (await allAdminUsers()),
      tickets: state.tickets,
      signals: state.signals,
      kyc: state.kycSubmissions,
      transactions: state.transactions,
      subscribers: state.subscribers,
      notifications: state.notificationHistory,
      audit: state.auditLogs
    };
    res.json({ ok: true, ...paginateList(collections[resource] || [], req) });
  } catch (err) { next(err); }
});

app.post("/api/admin/coins", async (req, res, next) => {
  try {
    const symbol = cleanText(req.body.symbol).toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(symbol)) return res.status(400).json({ ok: false, error: "Enter a valid symbol." });
    if (symbol === "USDT") return res.status(400).json({ ok: false, error: "USDT is disabled. PKR only." });
    if (await Coin.findOne({ symbol })) return res.status(409).json({ ok: false, error: "Coin already exists." });
    const coin = await Coin.create({ symbol, name: cleanText(req.body.name, symbol), color: cleanText(req.body.color, "#149cff"), icon: cleanText(req.body.icon, symbol[0]), status: "Enabled" });
    await audit("create", "coin", { symbol }, req.admin.username);
    res.status(201).json({ ok: true, coin });
  } catch (err) { next(err); }
});

app.post("/api/admin/coins/:symbol", async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const coin = await Coin.findOne({ symbol });
    if (!coin) return res.status(404).json({ ok: false, error: "Coin not found." });
    if (symbol === "PKR" && ["delete", "disable"].includes(req.body.action)) return res.status(400).json({ ok: false, error: "PKR wallet cannot be removed." });
    if (req.body.action === "delete") await coin.deleteOne();
    else {
      coin.name = cleanText(req.body.name, coin.name);
      coin.color = cleanText(req.body.color, coin.color);
      coin.icon = cleanText(req.body.icon, coin.icon);
      if (req.body.action === "disable") coin.status = "Disabled";
      if (req.body.action === "enable") coin.status = "Enabled";
      if (["Enabled", "Disabled"].includes(req.body.status)) coin.status = req.body.status;
      await coin.save();
    }
    await audit(req.body.action === "delete" ? "delete" : "update", "coin", { symbol }, req.admin.username);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.post("/api/admin/trade-durations", async (req, res, next) => {
  try {
    const seconds = Number(req.body.seconds || 0);
    if (!seconds || seconds < 10) return res.status(400).json({ ok: false, error: "Trade time must be at least 10 seconds." });
    const row = await TradeDuration.create({ label: cleanText(req.body.label, `${seconds} seconds`), seconds });
    await audit("create", "trade-duration", { seconds }, req.admin.username);
    res.status(201).json({ ok: true, tradeDuration: row });
  } catch (err) { next(err); }
});

app.post("/api/admin/trade-durations/:index", async (req, res, next) => {
  try {
    const rows = await TradeDuration.find().sort({ seconds: -1 });
    const row = rows[Number(req.params.index)];
    if (!row) return res.status(404).json({ ok: false, error: "Trade time not found." });
    if (req.body.action === "delete") await row.deleteOne();
    else {
      row.label = cleanText(req.body.label, row.label);
      row.seconds = Number(req.body.seconds || row.seconds);
      await row.save();
    }
    await audit(req.body.action === "delete" ? "delete" : "update", "trade-duration", { id: docId(row) }, req.admin.username);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.post("/api/admin/signals", async (req, res, next) => {
  try {
    const signal = await Signal.create({ crypto: cleanText(req.body.crypto, "BTC"), direction: cleanText(req.body.direction, "High / Long"), time: cleanText(req.body.time, "3 minutes"), schedule: cleanText(req.body.schedule, "Manual / Always"), status: cleanText(req.body.status, "Active") });
    await audit("create", "signal", { id: docId(signal) }, req.admin.username);
    res.status(201).json({ ok: true, signal });
  } catch (err) { next(err); }
});

app.post("/api/admin/signals/:id", async (req, res, next) => {
  try {
    const signal = await Signal.findById(req.params.id);
    if (!signal) return res.status(404).json({ ok: false, error: "Signal not found." });
    if (req.body.action === "delete") await signal.deleteOne();
    else {
      signal.crypto = cleanText(req.body.crypto, signal.crypto);
      signal.direction = cleanText(req.body.direction, signal.direction);
      signal.time = cleanText(req.body.time, signal.time);
      signal.schedule = cleanText(req.body.schedule, signal.schedule);
      signal.status = cleanText(req.body.status, signal.status);
      await signal.save();
    }
    await audit(req.body.action === "delete" ? "delete" : "update", "signal", { id: req.params.id }, req.admin.username);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.post("/api/admin/users/:key", async (req, res, next) => {
  try {
    const user = await findUserRecord(decodeURIComponent(req.params.key));
    if (!user) return res.status(404).json({ ok: false, error: "User not found." });
    if (req.body.action === "delete") {
      if (user.username === (process.env.DEMO_USERNAME || "demo")) return res.status(400).json({ ok: false, error: "Demo user cannot be deleted." });
      await user.deleteOne();
    } else {
      if (req.body.action === "ban") user.status = "Banned";
      if (req.body.action === "unban") user.status = "Active";
      if (req.body.name) user.name = cleanText(req.body.name);
      if (req.body.email) user.email = normalizeEmail(req.body.email);
      if (req.body.country) user.country = cleanText(req.body.country, "PK").toUpperCase();
      await user.save();
    }
    await audit(req.body.action === "delete" ? "delete" : "update", "user", { user: user.name }, req.admin.username);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.post("/api/admin/gateways", async (req, res, next) => {
  try {
    const name = cleanText(req.body.name);
    if (!name) return res.status(400).json({ ok: false, error: "Gateway name is required." });
    if (!pkrOnlyList([name]).length) return res.status(400).json({ ok: false, error: "USDT/Tether gateways are not allowed. PKR only." });
    const type = req.body.type === "automatic" ? "automatic" : "manual";
    if (await Gateway.findOne({ name })) return res.status(409).json({ ok: false, error: "Gateway already exists." });
    const gateway = await Gateway.create({ name, type, status: "Enabled", supportedCurrency: "PKR" });
    await audit("create", "gateway", { name, type }, req.admin.username);
    res.status(201).json({ ok: true, gateway });
  } catch (err) { next(err); }
});

app.post("/api/admin/gateways/:name", async (req, res, next) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const gateway = await Gateway.findOne({ name });
    if (!gateway) return res.status(404).json({ ok: false, error: "Gateway not found." });
    if (req.body.action === "delete") await gateway.deleteOne();
    else {
      if (req.body.newName && req.body.newName !== name) {
        if (!pkrOnlyList([req.body.newName]).length) return res.status(400).json({ ok: false, error: "USDT/Tether gateways are not allowed. PKR only." });
        gateway.name = cleanText(req.body.newName);
      }
      if (req.body.action === "disable") gateway.status = "Disabled";
      if (req.body.action === "enable") gateway.status = "Enabled";
      if (["Enabled", "Disabled"].includes(req.body.status)) gateway.status = req.body.status;
      await gateway.save();
    }
    await audit(req.body.action === "delete" ? "delete" : "update", "gateway", { name }, req.admin.username);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.post("/api/admin/deposits/:id", async (req, res, next) => {
  try {
    const deposit = await Deposit.findById(req.params.id);
    if (!deposit) return res.status(404).json({ ok: false, error: "Deposit not found." });
    if (["Pending", "Approved", "Successful", "Rejected", "Initiated"].includes(req.body.status)) deposit.status = req.body.status;
    deposit.adminNote = cleanText(req.body.adminNote, deposit.adminNote || "");
    if (["Approved", "Successful"].includes(deposit.status) && !deposit.credited) {
      const user = await findUserRecord(deposit.userId);
      if (user) {
        const before = Number(user.balance || 0);
        user.balance = before + Number(deposit.amount || 0);
        await user.save();
        deposit.credited = true;
        await addTransaction({ userId: user.customId || docId(user), type: "Deposit Approved", amount: deposit.amount, before, after: user.balance, remark: deposit.gateway });
        await addNotification("Deposit Approved", `${pkr(deposit.amount)} deposit has been credited.`, user.customId || docId(user));
      }
    }
    if (deposit.status === "Rejected") await addNotification("Deposit Rejected", `${pkr(deposit.amount)} deposit was rejected.`, deposit.userId);
    await deposit.save();
    await audit("update", "deposit", { depositId: req.params.id, status: deposit.status }, req.admin.username);
    io?.emit("deposit:updated", depositForState(deposit));
    res.json({ ok: true, deposit: depositForState(deposit) });
  } catch (err) { next(err); }
});

app.post("/api/admin/withdrawals/:id", async (req, res, next) => {
  try {
    const withdrawal = await Withdrawal.findById(req.params.id);
    if (!withdrawal) return res.status(404).json({ ok: false, error: "Withdrawal not found." });
    if (["Pending", "Approved", "Rejected"].includes(req.body.status)) withdrawal.status = req.body.status;
    withdrawal.adminNote = cleanText(req.body.adminNote, withdrawal.adminNote || "");
    if (withdrawal.status === "Rejected" && !withdrawal.released) {
      const user = await findUserRecord(withdrawal.userId);
      if (user) {
        const before = Number(user.balance || 0);
        user.balance = before + Number(withdrawal.amount || 0);
        await user.save();
        withdrawal.released = true;
        await addTransaction({ userId: user.customId || docId(user), type: "Withdrawal Rejected Refund", amount: withdrawal.amount, before, after: user.balance, remark: withdrawal.adminNote });
      }
    }
    await withdrawal.save();
    await addNotification(`Withdrawal ${withdrawal.status}`, `${pkr(withdrawal.amount)} withdrawal is ${withdrawal.status}.`, withdrawal.userId);
    await audit("update", "withdrawal", { withdrawalId: req.params.id, status: withdrawal.status }, req.admin.username);
    res.json({ ok: true, withdrawal });
  } catch (err) { next(err); }
});

app.post("/api/admin/trades/:id", async (req, res, next) => {
  try {
    const trade = await Trade.findById(req.params.id);
    if (!trade) return res.status(404).json({ ok: false, error: "Trade not found." });
    if (["Win", "Loss", "Draw"].includes(req.body.result)) {
      const symbol = cleanText(trade.crypto).split(" ")[0];
      const prices = await livePrices();
      await settleTrade(trade, req.body.result, prices[symbol]?.pkr || trade.openPrice);
      trade.adminNote = req.body.note || "Admin controlled result";
      await trade.save();
      await audit("control", "trade", { tradeId: req.params.id, result: req.body.result }, req.admin.username);
    }
    res.json({ ok: true, trade: tradeForState(trade) });
  } catch (err) { next(err); }
});

app.post("/api/admin/balance-adjustments", async (req, res, next) => {
  try {
    const amount = Number(req.body.amount || 0);
    const action = req.body.action === "deduct" ? "deduct" : "add";
    if (!amount || amount < 1) return res.status(400).json({ ok: false, error: "Enter a valid PKR amount." });
    const user = await findUserRecord(req.body.userKey);
    if (!user) return res.status(404).json({ ok: false, error: "User not found." });
    const before = Number(user.balance || 0);
    const delta = action === "deduct" ? -amount : amount;
    user.balance = Math.max(0, before + delta);
    await user.save();
    const adjustment = await BalanceAdjustment.create({ userKey: user.customId || docId(user), user: user.name, type: action === "deduct" ? "Deduct" : "Add", amount, balanceAfter: user.balance, remark: cleanText(req.body.remark, "Admin balance adjustment"), date: now() });
    await addTransaction({ userId: user.customId || docId(user), type: action === "deduct" ? "Admin Deduct" : "Admin Add", amount: delta, before, after: user.balance, remark: adjustment.remark });
    await addNotification("Balance Updated", `${adjustment.type} ${pkr(amount)}. New balance ${pkr(user.balance)}.`, user.customId || docId(user));
    await audit(action, "balance", { user: user.name, amount, balanceAfter: user.balance }, req.admin.username);
    res.status(201).json({ ok: true, adjustment, user: safeUser(user) });
  } catch (err) { next(err); }
});

app.post("/api/admin/kyc/:id", async (req, res, next) => {
  try {
    const kyc = await KycSubmission.findById(req.params.id);
    if (!kyc) return res.status(404).json({ ok: false, error: "KYC request not found." });
    if (["Pending", "Approved", "Rejected"].includes(req.body.status)) kyc.status = req.body.status;
    kyc.adminNote = cleanText(req.body.adminNote, kyc.adminNote || "");
    await kyc.save();
    const user = await findUserRecord(kyc.userId);
    if (user) {
      user.kyc = kyc.status;
      user.kycStatus = kyc.status;
      user.kycData = kyc.toObject();
      await user.save();
    }
    await addNotification(`KYC ${kyc.status}`, `Your KYC request is ${kyc.status}.`, kyc.userId);
    await audit("update", "kyc", { kycId: req.params.id, status: kyc.status }, req.admin.username);
    res.json({ ok: true, kyc });
  } catch (err) { next(err); }
});

app.post("/api/admin/settings", async (req, res, next) => {
  try {
    const settings = await saveSettings(req.body || {});
    await audit("update", "settings", { keys: Object.keys(req.body || {}) }, req.admin.username);
    res.json({ ok: true, adminSettings: settings });
  } catch (err) { next(err); }
});

app.post("/api/admin/notifications", async (req, res, next) => {
  try {
    const subject = cleanText(req.body.subject);
    const msg = cleanText(req.body.msg);
    if (subject.length < 2) return res.status(400).json({ ok: false, error: "Subject is required." });
    if (msg.length < 2) return res.status(400).json({ ok: false, error: "Message is required." });
    const channel = ["email", "sms", "firebase"].includes(req.body.channel) ? req.body.channel : "email";
    const recipientsAll = await resolveNotificationRecipients(req.body.to || "All Users");
    const startFrom = Math.max(0, Number(req.body.startFrom || 0));
    const perBatch = Math.max(1, Math.min(500, Number(req.body.perBatch || recipientsAll.length || 1)));
    const coolingPeriod = Math.max(0, Number(req.body.coolingPeriod || 0));
    const recipients = recipientsAll.slice(startFrom, startFrom + perBatch);
    if (!recipients.length) return res.status(400).json({ ok: false, error: "No users found for this notification group/batch." });
    const notification = await addNotification(subject, msg, req.body.to || "All Users");
    const history = await NotificationHistory.create({ channel, to: req.body.to || "All Users", subject, msg, recipients: recipients.map(user => ({ key: user.key, name: user.name, email: user.email })), recipientCount: recipients.length, startFrom, perBatch, coolingPeriod, status: await notificationDeliveryStatus(channel), date: now() });
    await deliverNotification(history);
    await audit("create", "notification", { to: notification.to, subject, channel, recipientCount: recipients.length }, req.admin.username);
    res.status(201).json({ ok: true, notification, history });
  } catch (err) { next(err); }
});

app.post("/api/admin/tickets/:id", async (req, res, next) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ ok: false, error: "Ticket not found." });
    if (req.body.action === "delete") await ticket.deleteOne();
    else {
      ticket.status = cleanText(req.body.status, req.body.action === "close" ? "Closed" : "Open");
      ticket.priority = cleanText(req.body.priority, ticket.priority || "Normal");
      if (req.body.reply) {
        const chat = await ChatMessage.create({ from: "support", text: cleanText(req.body.reply), ticketId: docId(ticket), date: now() });
        io?.emit("chat:message", { id: docId(chat), from: chat.from, text: chat.text, ticketId: chat.ticketId, date: chat.date });
        ticket.messages = Number(ticket.messages || 0) + 1;
        ticket.lastReply = now();
      }
      await ticket.save();
    }
    await audit(req.body.action === "delete" ? "delete" : "update", "ticket", { ticketId: req.params.id }, req.admin.username);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/uploads") || req.path.startsWith("/socket.io")) return next();
  return res.sendFile(path.join(root, "index.html"));
});

app.use((err, _req, res, _next) => {
  const message = err.message || "Server error.";
  if (message.includes("Only jpg")) return res.status(400).json({ ok: false, error: message });
  if (err.code === 11000) return res.status(409).json({ ok: false, error: "Duplicate record already exists." });
  console.error(err);
  res.status(500).json({ ok: false, error: message });
});

const server = http.createServer(app);
io = new Server(server, { cors: { origin: "*" } });

io.on("connection", socket => {
  socket.on("chat:send", async payload => {
    try {
      const text = cleanText(payload?.text);
      if (!text) return;
      const message = await ChatMessage.create({ from: cleanText(payload?.from, "user"), text, ticketId: cleanText(payload?.ticketId), userId: cleanText(payload?.userId), date: now() });
      io.emit("chat:message", { id: docId(message), from: message.from, text: message.text, ticketId: message.ticketId, userId: message.userId, date: message.date });
    } catch (err) {
      socket.emit("chat:error", err.message);
    }
  });
});

async function start() {
  await mongoose.connect(MONGO_URI);
  await seedDefaults();
  server.listen(PORT, HOST, () => {
    console.log(`TradersView PKR Express backend running at http://${HOST}:${PORT}`);
  });
}

start().catch(err => {
  console.error("Backend failed to start:", err.message);
  process.exit(1);
});
