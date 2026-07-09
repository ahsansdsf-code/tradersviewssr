require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/tradersview_pkr";
const username = (process.env.ADMIN_USERNAME || "admin").trim();
const email = (process.env.ADMIN_EMAIL || "admin@tradersview.pk").trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;

const adminSchema = new mongoose.Schema(
  {
    username: { type: String, unique: true, index: true },
    email: { type: String, unique: true, index: true },
    name: String,
    passwordHash: String,
    role: { type: String, default: "admin" },
    active: { type: Boolean, default: true },
    lastLogin: Date
  },
  { timestamps: true }
);

async function main() {
  if (!password || password.length < 6 || password === "change-this-admin-password") {
    throw new Error("Set ADMIN_PASSWORD in .env to a real password with at least 6 characters.");
  }

  await mongoose.connect(mongoUri);
  const Admin = mongoose.models.Admin || mongoose.model("Admin", adminSchema);
  const passwordHash = await bcrypt.hash(password, 12);

  await Admin.findOneAndUpdate(
    { username },
    { username, email, name: "Admin", passwordHash, role: "admin", active: true },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log(`Admin account ready: ${username}`);
  await mongoose.disconnect();
}

main().catch(async err => {
  console.error(err.message);
  try {
    await mongoose.disconnect();
  } catch (_) {
    // ignore disconnect failures during failed setup
  }
  process.exit(1);
});
