const app = document.querySelector("#app");
const $ = (s, r = document) => r.querySelector(s);
const API = {
  headers(url = "") {
    const token = String(url).startsWith("/api/admin") ? adminToken() : userToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  },
  async get(url) {
    const res = await fetch(url, { headers: this.headers(url) });
    const json = await res.json();
    if (!res.ok || json.ok === false) {
      if (res.status === 403 && String(url).startsWith("/api/admin")) {
        localStorage.removeItem("tv_admin_token");
        localStorage.removeItem("tv_admin_role");
        setTimeout(() => go("/admin/login"), 0);
      }
      throw new Error(json.error || "Request failed.");
    }
    return json;
  },
  async getState() {
    const currentRoute = route();
    const adminScope = currentRoute.startsWith("/admin") && currentRoute !== "/admin/login" && Boolean(adminToken());
    const token = adminScope ? adminToken() : userToken();
    const res = await fetch(adminScope ? "/api/state?scope=admin" : "/api/state", {
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) {
      if (res.status === 403 && adminScope) {
        localStorage.removeItem("tv_admin_token");
        localStorage.removeItem("tv_admin_role");
        setTimeout(() => go("/admin/login"), 0);
      }
      throw new Error(json.error || "State could not be loaded.");
    }
    return json;
  },
  async post(url, data) {
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(url),
      body: JSON.stringify(data || {})
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) {
      if (res.status === 403 && String(url).startsWith("/api/admin")) {
        localStorage.removeItem("tv_admin_token");
        localStorage.removeItem("tv_admin_role");
        setTimeout(() => go("/admin/login"), 0);
      }
      throw new Error(json.error || "Request failed.");
    }
    return json;
  },
  async delete(url) {
    const res = await fetch(url, { method: "DELETE", headers: this.headers(url) });
    const json = await res.json();
    if (!res.ok || json.ok === false) {
      if (res.status === 403 && String(url).startsWith("/api/admin")) {
        localStorage.removeItem("tv_admin_token");
        localStorage.removeItem("tv_admin_role");
        setTimeout(() => go("/admin/login"), 0);
      }
      throw new Error(json.error || "Request failed.");
    }
    return json;
  },
  async form(url, formData) {
    const token = String(url).startsWith("/api/admin") ? adminToken() : userToken();
    const res = await fetch(url, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) {
      if (res.status === 403 && String(url).startsWith("/api/admin")) {
        localStorage.removeItem("tv_admin_token");
        localStorage.removeItem("tv_admin_role");
        setTimeout(() => go("/admin/login"), 0);
      }
      throw new Error(json.error || "Request failed.");
    }
    return json;
  }
};

let db = null;
let chatOpen = false;
let socket = null;
let refreshTimer = null;
let countdownTimer = null;
let lastCaptchaCode = "";

const pkr = n => "PKR" + Number(n || 0).toLocaleString("en-PK") + ".00 PKR";
const shortPkr = n => Number(n || 0).toLocaleString("en-PK") + " PKR";
const go = path => { location.hash = path; };
const route = () => location.hash.replace("#", "") || "/login";
const adminToken = () => localStorage.getItem("tv_admin_token");
const userToken = () => localStorage.getItem("tv_user_token");
const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]));
const checked = value => value ? "checked" : "";
const boolValue = id => Boolean(document.querySelector(`#${id}`)?.checked);
const listValue = value => String(value || "").split(",").map(x => x.trim()).filter(Boolean);
const listText = value => (value || []).join(", ");
const quickLinksText = links => (links || []).map(link => `${link.label}|${link.path}`).join("\n");
const parseQuickLinks = value => String(value || "").split("\n").map(line => {
  const [label, path] = line.split("|").map(x => x.trim());
  return label && path ? { label, path } : null;
}).filter(Boolean);
function applyCustomCss() {
  let node = document.querySelector("#adminCustomCss");
  if (!node) {
    node = document.createElement("style");
    node.id = "adminCustomCss";
    document.head.appendChild(node);
  }
  node.textContent = db?.adminSettings?.customCss || "";
}

function toast(msg, title = "Notice") {
  document.body.insertAdjacentHTML("beforeend", `<div class="toast"><b>${esc(title)}</b><br>${esc(msg)}</div>`);
  setTimeout(() => document.querySelector(".toast")?.remove(), 3600);
}

function initSocket() {
  if (socket || typeof io !== "function") return;
  socket = io();
  socket.on("chat:message", message => {
    db.chat = db.chat || [];
    if (!db.chat.some(item => item.id && item.id === message.id)) db.chat.push(message);
    if (chatOpen) render();
  });
  socket.on("deposit:updated", async () => {
    await loadState();
    if (route().includes("deposit") || route().startsWith("/admin")) render();
  });
  socket.on("trade:settled", async () => {
    await loadState();
    render();
  });
}

function brand() {
  const name = db?.adminSettings?.logoText || "TRADERSVIEW";
  const first = name.slice(0, Math.max(1, Math.floor(name.length / 2)));
  const second = name.slice(first.length);
  return `<div class="brand"><span class="mark"><span></span></span><div><b>${esc(first)}<i>${esc(second)}</i><small>${esc(db?.adminSettings?.tagline || "Markets. Insights. Opportunities.")}</small></b></div></div>`;
}

function icon(name) {
  const map = { user: "U", mail: "@", lock: "L", shield: "S", cash: "PKR", bell: "N", gear: "G", chart: "C" };
  return map[name] || ">";
}

function coinClass(symbol) {
  return String(symbol || "coin").toLowerCase().replace(/[^a-z0-9-]/g, "");
}

function coinColor(color) {
  return /^#[0-9a-f]{3,8}$/i.test(String(color || "")) ? color : "#149cff";
}

function coinIconText(symbol, fallback) {
  const map = {
    BTC: "&#8383;",
    ETH: "&#9670;",
    BNB: "B",
    XRP: "X",
    SOL: "S",
    TRX: "T",
    DOGE: "D",
    ADA: "A",
    BCH: "&#8383;",
    LTC: "L",
    STX: "S",
    MATIC: "P",
    USDC: "$",
    BUSD: "B",
    WBTC: "&#8383;",
    WBTECH: "B"
  };
  return map[String(symbol || "").toUpperCase()] || esc(fallback || String(symbol || "?").slice(0, 2).toUpperCase());
}

function coinIconOnly(coin, size = "") {
  const symbol = coin?.[0] || coin?.symbol || "";
  const name = coin?.[1] || coin?.name || symbol;
  const color = coinColor(coin?.[2] || coin?.color);
  const fallback = coin?.[3] || coin?.icon;
  return `<span class="crypto-icon ${size} crypto-${coinClass(symbol)}" style="--coin-color:${esc(color)}" title="${esc(name)}"><span>${coinIconText(symbol, fallback)}</span></span>`;
}

function coinLabel(coin) {
  const symbol = coin?.[0] || "";
  const name = coin?.[1] || symbol;
  return `<span class="crypto-cell">${coinIconOnly(coin, "crypto-icon-sm")}<span><b>${esc(name)}</b><small>${esc(symbol)}</small></span></span>`;
}

function field(label, ph, type, iconName, id = "") {
  return `<div class="field"><label>${label}</label><div class="input-wrap"><span class="icon-box">${icon(iconName)}</span><input ${id ? `id="${id}"` : ""} required type="${type}" placeholder="${ph}"></div></div>`;
}

function fullField(label, ph, type, iconName, id = "") {
  return `<div class="field full-field"><label>${label}</label><div class="input-wrap"><span class="icon-box">${icon(iconName)}</span><input ${id ? `id="${id}"` : ""} required type="${type}" placeholder="${ph}"></div></div>`;
}

function captchaCode() {
  const length = db?.adminSettings?.captcha?.length || 6;
  return Array.from({ length }, () => Math.floor(Math.random() * 10)).join("");
}

function captchaBox(id = "captchaInput") {
  const c = db?.adminSettings?.captcha || {};
  const code = captchaCode();
  lastCaptchaCode = code;
  const display = code.split("").join(" ");
  const cls = `captcha-code captcha-${c.style || "neon"} ${c.rotate ? "captcha-tilt" : ""}`;
  return `<div class="field"><label>Security Verification</label><div class="captcha"><div class="${cls}" data-code="${esc(code)}" style="font-family:${esc(c.font || "monospace")}">${esc(display)}</div><button type="button" class="captcha-helper" onclick="fillCaptcha('${id}')">Use Code</button><div class="input-wrap"><span class="icon-box">${icon("shield")}</span><input id="${id}" required inputmode="numeric" maxlength="${Number(c.length || 6)}" placeholder="Enter Code" autocomplete="off"></div></div></div>`;
}

function captchaValid(id = "captchaInput") {
  const input = document.querySelector(`#${id}`);
  const expected = input?.closest("form")?.querySelector(".captcha-code")?.dataset.code || lastCaptchaCode;
  const entered = String(input?.value || "").replace(/\D/g, "");
  return !expected || entered === expected;
}

function fillCaptcha(id = "captchaInput") {
  const input = document.querySelector(`#${id}`);
  const code = input?.closest("form")?.querySelector(".captcha-code")?.dataset.code;
  if (input && code) input.value = code;
}

function auth(type) {
  const title = type === "register" ? "Create Your Account" : type === "reset" ? "Account Recovery" : "Secure Sign In";
  const isReg = type === "register";
  const isReset = type === "reset";
  app.innerHTML = `<main class="auth-page"><form class="auth-card ${isReg ? "register-card" : ""}" id="authForm">${brand()}<div class="auth-title">${title}</div>
    <div class="form-grid ${isReg ? "two" : ""}">
      ${isReg ? field("First Name", "e.g. John", "text", "user", "firstName") + field("Last Name", "e.g. Doe", "text", "user", "lastName") : ""}
      ${isReg ? fullField("Username / Email", "your-email@example.com", "text", "mail", "authIdentifier") : field(isReset ? "Email or Username" : "Username / Email", isReset ? "your-username-or-email" : "your-account", "text", "mail", "authIdentifier")}
      ${isReset ? "" : field("Password", "password", "password", "lock", "authPassword")}
      ${isReg ? field("Confirm Password", "Repeat password", "password", "lock", "confirmPassword") : ""}
    </div>
    <div style="margin-top:17px">${captchaBox()}</div>
    ${isReg ? `<label class="check-line terms-line"><input type="checkbox" required><span>I accept the <button type="button" class="text-link" onclick="go('/terms-of-use')">Terms of Use</button>, <button type="button" class="text-link" onclick="go('/terms-of-service')">Terms of Service</button>, and <button type="button" class="text-link" onclick="go('/privacy-policy')">Privacy Policy</button></span></label>` : ""}
    ${type === "login" ? `<div class="check-line"><label><input type="checkbox"> Stay signed in</label><span style="margin-left:auto" class="link" onclick="go('/reset')">Reset password?</span></div>` : ""}
    <button class="btn" style="width:100%;margin-top:12px">${isReg ? "Create Account" : isReset ? "Submit" : "Sign In"}</button>
    <div class="auth-foot">${isReg ? "Already have a professional account? <span class='link' onclick=\"go('/login')\">Sign In</span>" : isReset ? "<span class='link' onclick=\"go('/login')\">Back to Login</span>" : "New to TradersView? <span class='link' onclick=\"go('/register')\">Create account</span>"}</div>
  </form></main>`;
  $("#authForm").onsubmit = async e => {
    e.preventDefault();
    if (!captchaValid()) return toast("Security code does not match.", "Error");
    try {
      const identifier = $("#authIdentifier")?.value.trim();
      if (isReset) {
        await API.post("/api/auth/forgot-password", { email: identifier });
        toast("Password reset request saved in backend.", "Account Recovery");
        return go("/login");
      }
      const password = $("#authPassword")?.value || "";
      if (isReg && password !== $("#confirmPassword")?.value) return toast("Password confirmation does not match.", "Error");
      const looksEmail = identifier.includes("@");
      const username = looksEmail ? identifier.split("@")[0].replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 30) : identifier;
      const email = looksEmail ? identifier : `${identifier}@tradersview.pk`;
      const payload = isReg
        ? { mode: "register", username, email, password, name: `${$("#firstName").value.trim()} ${$("#lastName").value.trim()}`.trim() }
        : { username: identifier, password };
      const data = await API.post("/api/auth", payload);
      if (!data.token) throw new Error("Login token missing from backend response.");
      localStorage.setItem("tv_user_token", data.token);
      await loadState();
      go("/dashboard");
    } catch (err) {
      toast(err.message, "Error");
    }
  };
}

function adminLogin() {
  app.innerHTML = `<main class="auth-page admin-login-page"><form class="auth-card admin-login-card" id="adminLoginForm">
    ${brand()}
    <div class="auth-title">Admin Control Login</div>
    <div class="admin-login-note">Secure admin access for trades, deposits, users, settings, and notifications.</div>
    <div class="form-grid">
      ${fullField("Username", "admin", "text", "user", "adminUser")}
      ${fullField("Password", "password", "password", "lock", "adminPass")}
    </div>
    <div style="margin-top:17px">${captchaBox()}</div>
    <button class="btn" style="width:100%;margin-top:14px">Login Admin Panel</button>
    <div class="auth-foot"><span class="link" onclick="go('/login')">Back to Website Login</span></div>
  </form></main>`;
  $("#adminLoginForm").onsubmit = async e => {
    e.preventDefault();
    if (!captchaValid()) return toast("Security code does not match.", "Error");
    const username = $("#adminUser").value.trim();
    const password = $("#adminPass").value.trim();
    if (!username || !password) return toast("Enter admin username and password.", "Error");
    try {
      const data = await API.post("/api/auth", { username, password, role: "admin" });
      if (!data.token) throw new Error("Admin token missing from backend response.");
      localStorage.setItem("tv_admin_token", data.token);
      localStorage.setItem("tv_admin_role", data.role || "admin");
      await loadState();
      go("/admin/dashboard");
    } catch (err) {
      toast(err.message, "Admin Login Error");
    }
  };
}

function logoutUser() {
  localStorage.removeItem("tv_user_token");
  go("/login");
}

function logoutAdmin() {
  localStorage.removeItem("tv_admin_token");
  localStorage.removeItem("tv_admin_role");
  go("/admin/login");
}

function nav(path, label) {
  return `<button onclick="go('${path}')">${label}</button>`;
}

function menuItem(path, label, glyph) {
  return `<button class="menu-item" onclick="go('${path}')"><span>${glyph}</span><b>${label}</b></button>`;
}

function userShell(title, inner, opts = {}) {
  const initials = (db.user?.name || "Demo User").split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase();
  const unread = (db.notifications || []).filter(n => !n.read).length;
  app.innerHTML = `<div class="user-shell"><div class="top-strip"><span>English</span><span>${unread} Notifications</span></div>
    <nav class="user-nav">${brand()}<div class="nav-links">
      ${nav("/dashboard", "Dashboard")} ${nav("/practice", "Practice")} ${nav("/trade-log", "Trade Log")} ${nav("/deposit", "Deposit")} ${nav("/withdraw", "Withdraw")} ${nav("/deposit-history", "Deposit History")} ${nav("/referral", "Referral")} ${nav("/transactions", "Transaction Log")}
      <div class="profile"><button class="profile-btn"><span>${esc(initials)}</span><i>${esc(db.user?.username || "user")}</i></button><div class="profile-menu">
        <div class="profile-head"><strong>${esc(db.user?.name || "Demo User")}</strong><small>${esc(db.user?.email || "")}</small></div>
        ${menuItem("/ticket", "Support Ticket", "?")}
        ${menuItem("/profile", "Profile Setting", "U")}
        ${menuItem("/password", "Change Password", "L")}
        ${menuItem("/2fa", "2FA Security", "S")}
        ${menuItem("/notifications", `Notifications${unread ? ` (${unread})` : ""}`, "N")}
        <button class="menu-item danger-text" onclick="logoutUser()"><span>!</span><b>Logout</b></button>
      </div></div></div></nav>
    <section class="hero"><h1>${esc(title)}</h1></section><section class="section"><div class="container ${opts.wide ? "wide" : ""}">${inner}</div></section>${footer()}${chatWidget()}</div>`;
  wireChat();
}

function footer() {
  const s = db?.adminSettings || {};
  const links = s.quickLinks || [{ label: "Home", path: "/dashboard" }, { label: "Contact", path: "/contact" }, { label: "Dashboard", path: "/dashboard" }];
  const linkHtml = links.map(link => `<button class="footer-link" onclick="go('${esc(link.path)}')">${esc(link.label)}</button>`).join("");
  return `<footer class="footer"><div class="footer-grid"><div>${brand()}<p>${esc(s.frontend?.welcome || "Welcome to Traders View, your ultimate destination to learn, practice, and master trading with a PKR-only wallet.")}</p></div><div><h3>Quick Links</h3>${linkHtml}</div><div><h3>Policies</h3><button class="footer-link" onclick="go('/terms-of-use')">Terms of Use</button><button class="footer-link" onclick="go('/terms-of-service')">Terms Of Service</button><button class="footer-link" onclick="go('/privacy-policy')">Privacy Policy</button><button class="footer-link" onclick="go('/risk-disclaimer')">Risk Disclaimer</button></div><div><h3>Our Newsletter</h3><p>${esc(s.frontend?.newsletterText || "Subscribe for regular news and tips.")}</p><input id="newsletterEmail" class="plain-input" placeholder="Your Email Address" onkeydown="newsletterKey(event,this)"></div></div><div class="contact-row"><div>${esc(s.supportEmail || "support@tradersview.org")}<br><small>Email Address</small></div><div>${esc(s.supportPhone || "+447418683034")}<br><small>Call Us Now</small></div><div>${esc(s.address || "1317 Edgewater Drive, Suite 1880")}<br><small>Our Address</small></div></div><p style="text-align:center">Copyright 2026. All Rights Reserved By <span class="link">${esc(s.siteName || "TradersView")}</span></p></footer>`;
}

async function newsletterKey(event, input) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  await subscribeNewsletter(input.value);
  input.value = "";
}

async function subscribeNewsletter(email) {
  try {
    await API.post("/api/newsletter/subscribe", { email });
    await loadState();
    toast("Newsletter subscription saved.", "Newsletter");
  } catch (err) {
    toast(err.message, "Newsletter");
  }
}

function publicPage(key) {
  const settings = db.adminSettings || {};
  const page = settings.pages?.[key] || { title: "Page", body: "Content coming soon." };
  const contact = key === "contact" ? `<div class="content-cards"><div><b>Email</b><span>${esc(settings.supportEmail)}</span></div><div><b>Phone</b><span>${esc(settings.supportPhone)}</span></div><div><b>Address</b><span>${esc(settings.address)}</span></div></div>` : "";
  userShell(page.title, `<article class="content-page"><p>${esc(page.body).replace(/\n/g, "<br>")}</p>${contact}<div class="actions"><button class="btn small" onclick="go('/dashboard')">Back Dashboard</button></div></article>`, { wide: true });
}

function table(headers, rows, cls = "") {
  return `<div class="table-wrap"><table class="${cls}"><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}" style="text-align:center">Data not found</td></tr>`}</tbody></table></div>`;
}

function statusPill(status) {
  const cls = status === "Rejected" || status === "Loss" ? "bad" : status === "Pending" || status === "Initiated" || status === "Running" ? "warn" : "good";
  return `<span class="pill ${cls}">${esc(status)}</span>`;
}

function dashboard() {
  const trades = db.trades || [];
  const win = trades.filter(t => t.result === "Win").length;
  const loss = trades.filter(t => t.result === "Loss").length;
  const draw = trades.filter(t => t.result === "Draw").length;
  const running = trades.filter(t => t.status === "Running").length;
  const deposits = db.deposits || [];
  const approved = deposits.filter(d => ["Approved", "Successful"].includes(d.status)).reduce((sum, d) => sum + Number(d.amount), 0);
  const stats = [
    [pkr(db.user.balance), "Available Balance", "$", "/transactions"],
    [pkr(db.user.frozen), "Frozen Balance", "L", "/trade-log"],
    [pkr(approved), "Total Deposit", "D", "/deposit-history"],
    [trades.length, "Total Transactions", "T", "/transactions"],
    [trades.length, "Total Trade", "C", "/trade-log"],
    [running, "Running Trade", "R", "/trade-log"],
    [win, "Total Winning Trade", "W", "/trade-log"],
    [loss, "Total Losing Trade", "L", "/trade-log"],
    [draw, "Total Draw Trade", "D", "/trade-log"]
  ];
  userShell("Dashboard", `<div class="credit"><span>Credit Score<br><small>Your current credit rating</small></span><span>${db.user.credit}/100</span></div>
    <div class="actions"><button class="btn small" onclick="go('/practice')">Trade Now</button><button class="btn small" onclick="go('/deposit')">Deposit</button><button class="btn small" onclick="go('/withdraw')">Withdraw</button></div>
    <div class="notice"><b>KYC Verification Required</b><br>Complete KYC to unlock the full potential of our platform.</div>
    <div class="stats">${stats.map(s => `<div class="stat"><span class="sicon">${s[2]}</span><div><strong>${s[0]}</strong><small>${s[1]}</small><br><button class="btn small ghost" onclick="go('${s[3]}')">View All</button></div></div>`).join("")}</div>
    <div class="ref-box"><span>My Referral Link</span><input id="referralLink" value="https://tradersview.pk/ref/${db.user.username}" readonly><button class="btn" onclick="copyReferral()">Copy</button></div>
    ${table(["S.L", "Crypto", "Amount", "Up/Down", "Result", "Status", "Date"], trades.slice(0, 5).map((t, i) => [i + 1, esc(t.crypto), pkr(t.amount), esc(t.direction), esc(t.result || "-"), statusPill(t.status), esc(t.createdAt)]))}`, { wide: true });
}

async function copyReferral() {
  const value = $("#referralLink")?.value || "";
  try {
    await navigator.clipboard.writeText(value);
    toast("Referral link copied.", "Referral");
  } catch {
    const input = $("#referralLink");
    input?.select?.();
    document.execCommand("copy");
    toast("Referral link copied.", "Referral");
  }
}

function practice() {
  userShell("Practice Trade Now", `<div class="coin-grid">${db.coins.map(c => `<div class="coin"><h3>${esc(c[1])}</h3><div class="coin-logo">${coinIconOnly(c, "crypto-icon-lg")}</div><button class="btn small" onclick="go('/trade/${esc(c[0])}')">Trade Now</button></div>`).join("")}</div>`, { wide: true });
}

function trade(sym = "BTC") {
  const coin = db.coins.find(c => c[0] === sym) || db.coins[0];
  const active = db.trades.find(t => t.status === "Running");
  const durationButtons = db.tradeDurations.map((t, i) => `<button type="button" class="btn small ghost duration ${i === 3 ? "active" : ""}" data-seconds="${t.seconds}">${t.label}</button>`).join("");
  userShell(`Practice Trade With ${coin[0]}`, `<div class="timer-row">${durationButtons}</div>
    <div class="trade-area"><div class="chart live-chart"><div class="chart-top"><b>${esc(coin[0])}/PKR Live Chart</b><span id="chartSource">Connecting...</span></div><canvas id="tradeChart" aria-label="${esc(coin[0])} PKR live trading chart"></canvas><span id="clock" class="trade-clock">${active ? "Running..." : "Ready"}</span></div>
    <div class="trade-card"><div class="trade-head">Current ${esc(coin[0])} Price : <span id="priceLabel">Loading...</span></div>
    <div class="trade-body"><input class="plain-input" id="tradeAmt" type="number" min="1" placeholder="Enter PKR Amount"><div><button class="btn buy" style="width:100%" onclick="startTrade('${coin[0]}','Up')">Buy Up</button><button class="btn sell" style="width:100%;margin-top:8px" onclick="startTrade('${coin[0]}','Down')">Buy Down</button></div></div>
    <div class="active-trade">${active ? activeTradeHtml(active) : "No active trade. Choose a time, amount, and direction."}</div></div></div>`, { wide: true });
  document.querySelectorAll(".duration").forEach(btn => btn.onclick = () => {
    document.querySelectorAll(".duration").forEach(item => item.classList.remove("active"));
    btn.classList.add("active");
  });
  startLiveChart(coin[0]);
  startCountdown();
}

function drawTradeChart(canvas, prices, symbol, statusText) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width || 720));
  const height = Math.max(240, Math.floor(rect.height || 280));
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const pad = { top: 26, right: 20, bottom: 34, left: 54 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const values = prices.length ? prices : [1, 1.01, 1.02, 1.03];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(1, max - min);

  ctx.fillStyle = "#0f1c24";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#263b47";
  ctx.lineWidth = 1;
  ctx.font = "11px Trebuchet MS, Arial";
  ctx.fillStyle = "#93a7b8";
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    const label = Math.round(max - (spread / 4) * i).toLocaleString("en-PK");
    ctx.fillText(label, 8, y + 4);
  }

  const points = values.map((value, index) => {
    const x = pad.left + (plotW / Math.max(1, values.length - 1)) * index;
    const y = pad.top + plotH - ((value - min) / spread) * plotH;
    return { x, y, value };
  });
  const rising = values.at(-1) >= values[0];
  const stroke = rising ? "#20c979" : "#ff334f";
  const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
  gradient.addColorStop(0, rising ? "rgba(32,201,121,.28)" : "rgba(255,51,79,.28)");
  gradient.addColorStop(1, "rgba(20,156,255,0)");

  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.lineTo(points.at(-1).x, height - pad.bottom);
  ctx.lineTo(points[0].x, height - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3;
  ctx.stroke();

  const last = points.at(-1);
  ctx.fillStyle = stroke;
  ctx.beginPath();
  ctx.arc(last.x, last.y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f5f7ff";
  ctx.font = "bold 12px Trebuchet MS, Arial";
  ctx.fillText(`${symbol} ${shortPkr(last.value)}`, pad.left, 18);
  ctx.fillStyle = "#9fb1c4";
  ctx.font = "11px Trebuchet MS, Arial";
  ctx.fillText(statusText || "Live", width - 110, height - 12);
}

async function fetchTradePrice(symbol, fallback) {
  try {
    const data = await API.get("/api/prices");
    const value = Number(data.prices?.[symbol]?.pkr);
    if (!Number.isFinite(value) || value <= 0) throw new Error("Price unavailable.");
    return { value, source: data.prices[symbol]?.source || "API" };
  } catch (err) {
    const drift = (Math.random() - 0.47) * Math.max(1200, fallback * 0.0015);
    return { value: Math.max(1, Math.round((fallback || 1000000) + drift)), source: "offline demo feed" };
  }
}

function startLiveChart(symbol) {
  clearInterval(refreshTimer);
  const canvas = $("#tradeChart");
  const label = $("#priceLabel");
  const source = $("#chartSource");
  if (!canvas) return;
  const seed = symbol === "BTC" ? 18900000 : Math.max(120000, Math.round(18900000 / ((db.coins.findIndex(c => c[0] === symbol) || 1) + 1)));
  const prices = Array.from({ length: 36 }, (_, index) => Math.round(seed + Math.sin(index / 3) * seed * 0.006 + (Math.random() - 0.5) * seed * 0.002));

  const update = async () => {
    const last = prices.at(-1) || seed;
    const next = await fetchTradePrice(symbol, last);
    prices.push(next.value);
    while (prices.length > 48) prices.shift();
    if (label) label.textContent = shortPkr(next.value);
    if (source) source.textContent = next.source === "local-fallback" ? "Live PKR feed" : next.source;
    drawTradeChart(canvas, prices, symbol, next.source);
  };

  drawTradeChart(canvas, prices, symbol, "Starting");
  update();
  refreshTimer = setInterval(update, 3000);
}

function activeTradeHtml(t) {
  return `<b>Running Trade</b><br>${esc(t.crypto)} | ${pkr(t.amount)} | ${esc(t.direction)}<br><span id="remaining" data-end="${t.endsAt}">Calculating...</span><br>Admin result: ${esc(t.result || "Waiting")}`;
}

function startCountdown() {
  clearInterval(countdownTimer);
  const remaining = document.querySelector("#remaining");
  const clock = document.querySelector("#clock");
  if (!remaining) return;
  countdownTimer = setInterval(async () => {
    const left = Math.max(0, Math.ceil((Number(remaining.dataset.end) - Date.now()) / 1000));
    remaining.textContent = `${left}s remaining`;
    if (clock) clock.textContent = `${left}s`;
    if (left <= 0) {
      clearInterval(countdownTimer);
      await loadState();
      render();
    }
  }, 1000);
}

async function startTrade(symbol, direction) {
  const amount = Number($("#tradeAmt")?.value || 0);
  const seconds = Number(document.querySelector(".duration.active")?.dataset.seconds || 180);
  if (!amount) return toast("Enter PKR amount first.", "Error");
  try {
    await API.post("/api/trades", { symbol, direction, amount, seconds });
    await loadState();
    render();
  } catch (err) {
    toast(err.message, "Error");
  }
}

function deposit() {
  const methods = db.adminSettings.paymentMethods || ["Bank Deposit", "EasyPaisa", "Jazz Cash"];
  userShell("Deposit Methods", `<div class="deposit-box"><div class="deposit-head">Deposit</div><div class="deposit-body"><div>${methods.map((m, i) => `<label class="pay-method"><span><input name="pay" value="${esc(m)}" type="radio" ${i === 0 ? "checked" : ""}> ${esc(m)}</span><b>PKR</b></label>`).join("")}</div><form id="depForm"><label>Amount</label><div class="input-wrap"><span class="icon-box">PKR</span><input id="depAmt" type="number" min="1" placeholder="00.00"></div><label>Transaction ID</label><input id="depTrx" class="plain-input" required placeholder="JazzCash/EasyPaisa/Bank reference"><label>Payment Screenshot</label><input id="depProof" class="plain-input" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" required><p><b>Limit</b><br>PKR1,000.00 - PKR500,000.00</p><p><b>Total</b> <span id="depTotal">0.00 PKR</span></p><button class="btn" style="width:100%">Confirm Deposit</button><p>Funds are submitted to the backend as PKR deposits.</p></form></div></div>`);
  $("#depAmt").oninput = e => $("#depTotal").textContent = pkr(e.target.value);
  $("#depForm").onsubmit = async e => {
    e.preventDefault();
    const amount = Number($("#depAmt").value);
    const gateway = document.querySelector("input[name='pay']:checked")?.value || "Bank Deposit";
    try {
      const proofFile = $("#depProof")?.files?.[0];
      const data = new FormData();
      data.append("amount", amount);
      data.append("gateway", gateway);
      data.append("transactionId", $("#depTrx").value);
      if (proofFile) data.append("proofFile", proofFile);
      await API.form("/api/deposits", data);
      await loadState();
      go("/deposit-history");
    } catch (err) {
      toast(err.message, "Error");
    }
  };
}

function withdrawPage() {
  const methods = db.adminSettings.withdrawalMethods || ["Bank Transfer", "EasyPaisa", "Jazz Cash"];
  const history = (db.withdrawals || []).filter(w => !w.userId || w.userId === db.user.id || w.user === db.user.name);
  userShell("Withdraw PKR", `<div class="deposit-box"><div class="deposit-head">Withdraw</div><form class="deposit-body withdraw-form" id="withdrawForm">
    <div>
      <label>Method</label>
      <select id="withdrawMethod" class="plain-input">${methods.map(m => `<option>${esc(m)}</option>`).join("")}</select>
      <label>Account / Wallet Number</label>
      <input id="withdrawWallet" class="plain-input" required placeholder="Bank account, EasyPaisa, or Jazz Cash number">
    </div>
    <div>
      <label>Amount PKR</label>
      <div class="input-wrap"><span class="icon-box">PKR</span><input id="withdrawAmount" type="number" min="${Number(db.adminSettings.withdrawMin || 500)}" placeholder="00.00" required></div>
      <p><b>Available</b><br>${pkr(db.user.balance)}</p>
      <p><b>Limit</b><br>${pkr(db.adminSettings.withdrawMin || 500)} - ${pkr(db.adminSettings.withdrawMax || 500000)}</p>
      <button class="btn" style="width:100%">Submit Withdrawal</button>
    </div>
  </form></div>
  <div style="margin-top:24px">${table(["Date", "Method", "Amount", "Status", "Admin Note"], history.map(w => [esc(w.date), esc(w.network), pkr(w.amount), statusPill(w.status), esc(w.adminNote || "-")]))}</div>`, { wide: true });
  $("#withdrawForm").onsubmit = async e => {
    e.preventDefault();
    try {
      await API.post("/api/withdrawals", { amount: Number($("#withdrawAmount").value), wallet: $("#withdrawWallet").value, network: $("#withdrawMethod").value });
      await loadState();
      toast("Withdrawal request sent to admin.", "Wallet");
      render();
    } catch (err) {
      toast(err.message, "Error");
    }
  };
}

function kyc() {
  userShell("KYC Form", `<form class="form-panel" id="kycForm"><div class="form-grid"><div><label>Full Name</label><input id="kycName" class="plain-input" required></div><div><label>CNIC Number</label><input id="kycCnic" class="plain-input" required></div><div><label>Gender</label><select id="kycGender"><option>Select One</option><option>Male</option><option>Female</option></select></div><div><label>Your Hobby *</label><label><input class="kycHobby" value="Programming" type="checkbox"> Programming</label> <label><input class="kycHobby" value="Gardening" type="checkbox"> Gardening</label> <label><input class="kycHobby" value="Traveling" type="checkbox"> Traveling</label> <label><input class="kycHobby" value="Others" type="checkbox"> Others</label></div><div><label>CNIC Front</label><input id="kycFront" class="plain-input" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" required></div><div><label>CNIC Back</label><input id="kycBack" class="plain-input" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" required></div><div><label>CNIC Photo</label><input id="kycFile" class="plain-input" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" required></div></div><button class="btn" style="width:100%;margin-top:18px">Submit</button></form>`);
  toast("You are not KYC verified. Please provide this information.", "KYC");
  $("#kycForm").onsubmit = async e => {
    e.preventDefault();
    try {
      const hobbies = Array.from(document.querySelectorAll(".kycHobby:checked")).map(item => item.value);
      const data = new FormData();
      data.append("fullName", $("#kycName").value);
      data.append("documentNumber", $("#kycCnic").value);
      data.append("gender", $("#kycGender").value);
      data.append("documentType", "CNIC");
      hobbies.forEach(hobby => data.append("hobbies", hobby));
      const front = $("#kycFront")?.files?.[0];
      const back = $("#kycBack")?.files?.[0];
      const photo = $("#kycFile")?.files?.[0];
      if (front) data.append("front", front);
      if (back) data.append("back", back);
      if (photo) data.append("photo", photo);
      await API.form("/api/kyc", data);
      await loadState();
      toast("KYC submitted for admin review.", "KYC");
      go("/dashboard");
    } catch (err) {
      toast(err.message, "Error");
    }
  };
}

function profilePage() {
  userShell("Profile Setting", `<form class="form-panel account-panel" id="profileForm">
    <div class="account-top"><div class="account-avatar">${esc((db.user.name || "DU").split(/\s+/).map(x => x[0]).slice(0,2).join("").toUpperCase())}</div><div><h2>${esc(db.user.name)}</h2><p>${esc(db.user.email)}</p></div></div>
    <div class="form-grid"><div><label>Full Name</label><input id="profileName" class="plain-input" required value="${esc(db.user.name)}"></div><div><label>Email Address</label><input id="profileEmail" class="plain-input" type="email" required value="${esc(db.user.email)}"></div><div><label>Phone</label><input id="profilePhone" class="plain-input" value="${esc(db.user.phone || "")}" placeholder="+92..."></div><div><label>Country</label><input id="profileCountry" class="plain-input" value="${esc(db.user.country || "PK")}"></div></div>
    <button class="btn" style="width:100%;margin-top:18px">Save Profile</button>
  </form>`);
  $("#profileForm").onsubmit = async e => {
    e.preventDefault();
    try {
      await API.post("/api/profile", { name: $("#profileName").value, email: $("#profileEmail").value, phone: $("#profilePhone").value, country: $("#profileCountry").value });
      await loadState();
      toast("Profile saved.");
      render();
    } catch (err) {
      toast(err.message, "Error");
    }
  };
}

function supportTicketPage() {
  const myTickets = (db.tickets || []).filter(t => t.username === db.user.username || t.user === db.user.name);
  userShell("Support Ticket", `<form class="form-panel account-panel" id="ticketForm">
    <div class="form-grid"><div><label>Subject</label><input id="ticketSubject" class="plain-input" required placeholder="Deposit issue, KYC issue, trade issue"></div><div><label>Priority</label><select id="ticketPriority" class="plain-input"><option>Normal</option><option>High</option><option>Urgent</option></select></div></div>
    <label>Message</label><textarea id="ticketMessage" required placeholder="Write your issue clearly..."></textarea>
    <button class="btn" style="width:100%;margin-top:18px">Submit Ticket</button>
  </form>
  <div class="form-panel account-panel"><h3>My Tickets</h3>${table(["Subject", "Priority", "Status", "Messages"], myTickets.map(t => [esc(t.subject), esc(t.priority || "Normal"), statusPill(t.status || "Open"), String(t.messages || 1)]))}</div>`, { wide: true });
  $("#ticketForm").onsubmit = async e => {
    e.preventDefault();
    try {
      await API.post("/api/tickets", { subject: $("#ticketSubject").value, priority: $("#ticketPriority").value, message: $("#ticketMessage").value });
      await loadState();
      toast("Ticket submitted.");
      render();
    } catch (err) {
      toast(err.message, "Error");
    }
  };
}

function passwordPage() {
  userShell("Change Password", `<form class="form-panel account-panel" id="passwordForm">
    <div class="form-grid"><div><label>New Password</label><input id="newPassword" class="plain-input" type="password" minlength="6" required></div><div><label>Confirm Password</label><input id="confirmPassword" class="plain-input" type="password" minlength="6" required></div></div>
    <button class="btn" style="width:100%;margin-top:18px">Update Password</button>
  </form>`);
  $("#passwordForm").onsubmit = async e => {
    e.preventDefault();
    if ($("#newPassword").value !== $("#confirmPassword").value) return toast("Password confirmation does not match.", "Error");
    try {
      await API.post("/api/security/password", { password: $("#newPassword").value });
      toast("Password updated.");
      go("/profile");
    } catch (err) {
      toast(err.message, "Error");
    }
  };
}

function twoFactorPage() {
  userShell("2FA Security", `<form class="form-panel account-panel" id="twofaForm">
    <div class="security-card"><div><h2>Two Factor Authentication</h2><p>Add an extra security check to your account login.</p></div><label class="switch"><input id="twoFactorEnabled" type="checkbox" ${checked(db.user.twoFactor)}><span></span></label></div>
    <button class="btn" style="width:100%;margin-top:18px">Save 2FA Setting</button>
  </form>`);
  $("#twofaForm").onsubmit = async e => {
    e.preventDefault();
    try {
      await API.post("/api/security/2fa", { enabled: boolValue("twoFactorEnabled") });
      await loadState();
      toast("2FA setting saved.");
      render();
    } catch (err) {
      toast(err.message, "Error");
    }
  };
}

function notificationsPage() {
  userShell("Notifications", `<div class="notification-list">${(db.notifications || []).map(n => `<div class="notification-card ${n.read ? "" : "unread"}"><div><b>${esc(n.subject)}</b><p>${esc(n.msg)}</p><small>${esc(n.date)}</small></div><button class="btn small ghost" onclick="markNotification('${n.id}')">${n.read ? "Read" : "Mark Read"}</button></div>`).join("") || "<div class='form-panel'>No notifications found.</div>"}</div>`, { wide: true });
}

function logPage(title, headers, rows) {
  userShell(title, `<div class="log-toolbar"><input id="logSearch" class="plain-input" placeholder="Search ${esc(title)}"><button class="btn small" onclick="filterVisibleTable('logSearch')">Search</button></div>${table(headers, rows)}`, { wide: true });
}

function chatWidget() {
  return `<button class="chat-float" onclick="chatOpen=!chatOpen;render()">Chat</button>${chatOpen ? `<div class="chat-box"><b>Live Support Chat</b><div class="chat-log">${(db.chat || []).map(m => `<div class="bubble ${m.from === "user" ? "me" : ""}">${esc(m.text)}</div>`).join("")}</div><form id="chatForm"><input class="plain-input" id="chatMsg" placeholder="Message"><button class="btn" style="width:100%;margin-top:8px">Send</button></form></div>` : ""}`;
}

function wireChat() {
  const form = $("#chatForm");
  if (!form) return;
  form.onsubmit = async e => {
    e.preventDefault();
    const text = $("#chatMsg").value.trim();
    if (!text) return;
    $("#chatMsg").value = "";
    if (socket?.connected) {
      socket.emit("chat:send", { from: "user", text, userId: db.user?.id, date: new Date().toISOString() });
    } else {
      await API.post("/api/chat", { from: "user", text });
      await loadState();
    }
    render();
  };
}

function adminMenuItems() {
  const chatCount = (db.tickets || []).reduce((total, ticket) => total + Number(ticket.messages || 0), 0);
  return [
    { key: "dashboard", label: "Dashboard", icon: "&#8962;", path: "/admin/dashboard" },
    { key: "crypto", label: "Crypto Currency", icon: "&#164;", path: "/admin/crypto" },
    { key: "settings", label: "Trade Setting", icon: "&#9881;", path: "/admin/settings" },
    { key: "signals", label: "Trade Signals", icon: "&#8645;", path: "/admin/signals" },
    {
      key: "trades",
      label: "Trade Log",
      icon: "&#9671;",
      path: "/admin/trades",
      children: [
        { key: "trades-all", label: "All", path: "/admin/trades" },
        { key: "trades-winning", label: "Winning", path: "/admin/trades/winning" },
        { key: "trades-losing", label: "Losing", path: "/admin/trades/losing" },
        { key: "trades-draw", label: "Draw", path: "/admin/trades/draw" }
      ]
    },
    {
      key: "practice-trades",
      label: "Practice Trade Log",
      icon: "&#9635;",
      path: "/admin/practice-trades",
      children: [
        { key: "practice-all", label: "All", path: "/admin/practice-trades" },
        { key: "practice-winning", label: "Winning", path: "/admin/practice-trades/winning" },
        { key: "practice-losing", label: "Losing", path: "/admin/practice-trades/losing" },
        { key: "practice-draw", label: "Draw", path: "/admin/practice-trades/draw" }
      ]
    },
    {
      key: "users",
      label: "Manage Users",
      icon: "&#9874;",
      path: "/admin/users",
      badge: "!",
      children: [
        { key: "users-active", label: "Active Users", path: "/admin/users/active" },
        { key: "users-banned", label: "Banned Users", path: "/admin/users/banned" },
        { key: "users-email", label: "Email Unverified", path: "/admin/users/email-unverified" },
        { key: "users-mobile", label: "Mobile Unverified", path: "/admin/users/mobile-unverified" },
        { key: "users-kyc", label: "KYC Unverified", path: "/admin/users/kyc-unverified" },
        { key: "users-kyc-pending", label: "KYC Pending", path: "/admin/users/kyc-pending" },
        { key: "users-balance", label: "With Balance", path: "/admin/users/with-balance" },
        { key: "users-all", label: "All Users", path: "/admin/users/all" },
        { key: "notify", label: "Send Notification", path: "/admin/notify" }
      ]
    },
    {
      key: "deposits",
      label: "Deposits",
      icon: "&#8359;",
      path: "/admin/deposits",
      badge: "!",
      children: [
        { key: "deposits-adjust", label: "Deposit Add / Deduct", path: "/admin/adjust" },
        { key: "deposits-pending", label: "Pending Deposits", path: "/admin/deposits/pending" },
        { key: "deposits-approved", label: "Approved Deposits", path: "/admin/deposits/approved" },
        { key: "deposits-successful", label: "Successful Deposits", path: "/admin/deposits/successful" },
        { key: "deposits-rejected", label: "Rejected Deposits", path: "/admin/deposits/rejected" },
        { key: "deposits-initiated", label: "Initiated Deposits", path: "/admin/deposits/initiated" },
        { key: "deposits-all", label: "All Deposits", path: "/admin/deposits/all" }
      ]
    },
    {
      key: "withdrawals",
      label: "Withdrawals",
      icon: "&#8359;",
      path: "/admin/withdrawals",
      badge: "!",
      children: [
        { key: "withdrawals-pending", label: "Pending Withdrawals", path: "/admin/withdrawals/pending" },
        { key: "withdrawals-approved", label: "Approved Withdrawals", path: "/admin/withdrawals/approved" },
        { key: "withdrawals-rejected", label: "Rejected Withdrawals", path: "/admin/withdrawals/rejected" },
        { key: "withdrawals-all", label: "All Withdrawals", path: "/admin/withdrawals/all" }
      ]
    },
    {
      key: "tickets",
      label: "Support Ticket",
      icon: "&#9633;",
      path: "/admin/tickets",
      badge: "!",
      children: [
        { key: "tickets-pending", label: "Pending Ticket", path: "/admin/tickets/pending" },
        { key: "tickets-closed", label: "Closed Ticket", path: "/admin/tickets/closed" },
        { key: "tickets-answered", label: "Answered Ticket", path: "/admin/tickets/answered" },
        { key: "tickets-all", label: "All Ticket", path: "/admin/tickets" }
      ]
    },
    {
      key: "report",
      label: "Report",
      icon: "&#9776;",
      path: "/admin/transactions",
      children: [
        { key: "transactions", label: "Transaction History", path: "/admin/transactions" },
        { key: "login-history", label: "Login History", path: "/admin/login-history" },
        { key: "notification-history", label: "Notification History", path: "/admin/notifications-report" }
      ]
    },
    { key: "subscribers", label: "Subscribers", icon: "&#9757;", path: "/admin/subscribers" },
    { key: "system", label: "System Setting", icon: "&#9737;", path: "/admin/system" },
    {
      key: "extra",
      label: "Extra",
      icon: "&#9638;",
      path: "/admin/extra-app",
      children: [
        { key: "extra-app", label: "Application", path: "/admin/extra-app" },
        { key: "extra-server", label: "Server", path: "/admin/extra-server" },
        { key: "extra-cache", label: "Cache", path: "/admin/extra-cache" },
        { key: "extra-update", label: "Update", path: "/admin/extra-update" }
      ]
    },
    { key: "audit", label: "Report & Request", icon: "&#9878;", path: "/admin/audit" },
    { key: "chat", label: "Live Support Chat", icon: "&#9634;", path: "/admin/chat", badge: String(chatCount || 0), badgeClass: "info" }
  ];
}

function adminMenuEntry(item, active) {
  const hasChildren = Array.isArray(item.children) && item.children.length > 0;
  const isActive = active === item.key || (hasChildren && item.children.some(child => active === child.key));
  const badgeClass = item.badgeClass || "warn";
  const badge = item.badge ? `<span class="badge ${badgeClass}">${esc(item.badge)}</span>` : "";
  const children = hasChildren && isActive ? `<div class="side-children">${item.children.map(child => `<button class="side-child ${active === child.key ? "active" : ""}" onclick="go('${child.path}')"><span class="side-dot">o</span>${esc(child.label)}</button>`).join("")}</div>` : "";
  return `<div class="side-group"><button class="side-link ${isActive ? "active" : ""}" onclick="go('${item.path}')"><span class="side-icon">${item.icon}</span><span class="side-label">${esc(item.label)}</span>${badge}${hasChildren ? '<span class="side-chevron">v</span>' : ""}</button>${children}</div>`;
}

function adminAlertCount() {
  const pendingDeposits = (db.deposits || []).filter(item => ["Pending", "Initiated"].includes(item.status)).length;
  const pendingWithdrawals = (db.withdrawals || []).filter(item => item.status === "Pending").length;
  const openTickets = (db.tickets || []).filter(item => (item.status || "Open") !== "Closed").length;
  const runningTrades = (db.trades || []).filter(item => item.status === "Running").length;
  const unread = (db.notifications || []).filter(item => !item.read).length;
  return pendingDeposits + pendingWithdrawals + openTickets + runningTrades + unread;
}

function adminIcon(name) {
  const common = `width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  const icons = {
    globe: `<svg ${common}><circle cx="12" cy="12" r="10"></circle><path d="M2 12h20"></path><path d="M12 2c3 3 4 6 4 10s-1 7-4 10"></path><path d="M12 2c-3 3-4 6-4 10s1 7 4 10"></path></svg>`,
    bell: `<svg ${common}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg>`,
    tool: `<svg ${common}><path d="M14.7 6.3a4 4 0 0 0-5 5L3 18v3h3l6.7-6.7a4 4 0 0 0 5-5l-2.4 2.4-2.8-2.8z"></path></svg>`,
    profile: `<svg ${common}><circle cx="12" cy="8" r="4"></circle><path d="M4 21c1.8-4 5-6 8-6s6.2 2 8 6"></path></svg>`,
    password: `<svg ${common}><circle cx="7.5" cy="14.5" r="3.5"></circle><path d="M11 14.5h10"></path><path d="M17 14.5v-3"></path><path d="M20 14.5v-2"></path></svg>`,
    logout: `<svg ${common}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><path d="M16 17l5-5-5-5"></path><path d="M21 12H9"></path></svg>`
  };
  return icons[name] || "";
}

function adminTopBar() {
  const profile = db.adminSettings?.adminProfile || {};
  const adminName = profile.name || "admin";
  const alerts = adminAlertCount();
  const alertBadge = alerts ? `<span class="top-badge">${alerts > 9 ? "9+" : alerts}</span>` : "";
  return `<div class="admin-top">
    <input id="adminGlobalSearch" placeholder="Search here..." onkeydown="adminGlobalSearchKey(event,this)">
    <div class="admin-top-actions">
      <button class="top-icon-btn" title="Language" onclick="toast('Language selector is saved in System Settings. Multi-language switching is disabled until translation files are added.', 'Admin')">${adminIcon("globe")}</button>
      <button class="top-icon-btn has-badge" title="Notifications" onclick="go('/admin/notifications-report')">${adminIcon("bell")}${alertBadge}</button>
      <button class="top-icon-btn" title="Tools" onclick="go('/admin/system')">${adminIcon("tool")}</button>
      <div class="admin-profile" id="adminProfileMenu">
        <button class="admin-profile-trigger" onclick="toggleAdminProfileMenu(event)">
          <span class="admin-avatar">${esc(db.adminSettings?.faviconText || "TV")}</span>
          <span class="admin-name">${esc(adminName)}</span>
          <span class="admin-caret">v</span>
        </button>
        <div class="admin-profile-menu">
          <button onclick="go('/admin/profile')">${adminIcon("profile")} Profile</button>
          <button onclick="go('/admin/password')">${adminIcon("password")} Password</button>
          <button onclick="logoutAdmin()">${adminIcon("logout")} Logout</button>
        </div>
      </div>
    </div>
  </div>`;
}

function adminShell(title, inner, active = "dashboard") {
  const links = adminMenuItems().map(item => adminMenuEntry(item, active)).join("");
  app.innerHTML = `<div class="admin-shell"><aside class="sidebar">${brand()}<nav class="admin-nav">${links}<button class="side-link admin-logout" onclick="logoutAdmin()"><span class="side-icon">x</span><span class="side-label">Logout Admin</span></button></nav><div class="version">SAJJULAB V5.0</div></aside><main class="admin-main">${adminTopBar()}<div class="admin-content"><h1 class="admin-title">${esc(title)}</h1>${inner}</div></main></div>`;
}

function adminDashboard() {
  const users = [{ key: db.user.id, name: db.user.name, email: db.user.email, balance: db.user.balance }, ...db.users.map(user => ({ key: user[1], name: user[0], email: user[2], balance: user[4] }))];
  const trades = db.trades || [];
  const deposits = db.deposits || [];
  const withdrawals = db.withdrawals || [];
  const activeUsers = users.filter(user => (db.userStatuses?.[user.key] || "Active") !== "Banned").length;
  const totalDeposits = deposits.filter(item => ["Approved", "Successful"].includes(item.status)).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalWithdrawals = withdrawals.filter(item => item.status === "Approved").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const rejectedDeposits = deposits.filter(item => item.status === "Rejected").length;
  const pendingDeposits = deposits.filter(item => ["Pending", "Initiated"].includes(item.status)).length;
  const rejectedWithdrawals = withdrawals.filter(item => item.status === "Rejected").length;
  const pendingWithdrawals = withdrawals.filter(item => item.status === "Pending").length;
  const winTrades = trades.filter(item => item.result === "Win").length;
  const lossTrades = trades.filter(item => item.result === "Loss").length;
  const drawTrades = trades.filter(item => item.result === "Draw").length;
  const practiceTrades = trades.filter(item => item.status !== "Running");
  const statCards = [
    ["Total Users", users.length, "users", "blue", "/admin/users/all"],
    ["Active Users", activeUsers, "network", "green", "/admin/users/active"],
    ["Email Unverified Users", 0, "mail", "red", "/admin/users/email-unverified"],
    ["Mobile Unverified Users", 0, "phone", "orange", "/admin/users/mobile-unverified"],
    ["Total Trades", trades.length, "trade", "blue", "/admin/trades"],
    ["Win Trades", winTrades, "cup", "green", "/admin/trades/winning"],
    ["Loss Trades", lossTrades, "line", "red", "/admin/trades/losing"],
    ["Draw Trades", drawTrades, "draw", "orange", "/admin/trades/draw"],
    ["Total Practice Trades", practiceTrades.length, "trade", "blue", "/admin/practice-trades"],
    ["Win Practice Trades", practiceTrades.filter(item => item.result === "Win").length, "cup", "green", "/admin/practice-trades/winning"],
    ["Loss Practice Trades", practiceTrades.filter(item => item.result === "Loss").length, "line", "red", "/admin/practice-trades/losing"],
    ["Draw Practice Trades", practiceTrades.filter(item => item.result === "Draw").length, "draw", "orange", "/admin/practice-trades/draw"]
  ];
  const statIcon = name => ({ users: "&#9874;", network: "&#9901;", mail: "&#9993;", phone: "&#9633;", trade: "&#9635;", cup: "&#9812;", line: "&#9585;", draw: "&#9675;" }[name] || "&#8226;");
  const statHtml = statCards.map(card => `<button class="dash-stat ${card[3]}" onclick="go('${card[4]}')"><span class="dash-stat-icon">${statIcon(card[2])}</span><span><small>${esc(card[0])}</small><strong>${esc(card[1])}</strong></span><i>&rsaquo;</i></button>`).join("");
  const mini = (icon, value, label, tone, path) => `<button class="dash-mini ${tone}" onclick="go('${path}')"><span>${icon}</span><b>${value}</b><small>${esc(label)}</small><i>&rsaquo;</i></button>`;
  adminShell("Dashboard", `
    <div class="dash-head-actions"><button class="admin-btn" onclick="go('/admin/system/cron')">&#9635; Cron Setup</button></div>
    <div class="dash-stat-grid">${statHtml}</div>
    <div class="dash-summary-grid">
      <section class="dash-panel"><h3>Deposits</h3><div class="dash-mini-grid">
        ${mini("&#9827;", pkr(totalDeposits), "Total Deposited", "green", "/admin/deposits/successful")}
        ${mini("&#9686;", pendingDeposits, "Pending Deposits", "orange", "/admin/deposits/pending")}
        ${mini("&#8856;", rejectedDeposits, "Rejected Deposits", "red", "/admin/deposits/rejected")}
        ${mini("%", pkr(0), "Deposited Charge", "purple", "/admin/transactions")}
      </div></section>
      <section class="dash-panel"><h3>Withdrawals</h3><div class="dash-mini-grid">
        ${mini("&#9644;", pkr(totalWithdrawals), "Total Withdrawn", "green", "/admin/withdrawals/approved")}
        ${mini("&#9686;", pendingWithdrawals, "Pending Withdrawals", "orange", "/admin/withdrawals/pending")}
        ${mini("&#8856;", rejectedWithdrawals, "Rejected Withdrawals", "red", "/admin/withdrawals/rejected")}
        ${mini("%", pkr(0), "Withdrawal Charge", "purple", "/admin/transactions")}
      </div></section>
    </div>
    <div class="dash-chart-grid">
      <section class="dash-panel chart-panel"><div class="dash-panel-title"><h3>Deposit & Withdraw Report</h3><span>June 25, 2026 - July 9, 2026</span></div><canvas id="dashBar" height="250"></canvas></section>
      <section class="dash-panel chart-panel"><div class="dash-panel-title"><h3>Transactions Report</h3><span>June 25, 2026 - July 9, 2026</span></div><canvas id="dashLine" height="250"></canvas></section>
    </div>
    <div class="dash-donut-grid">
      <section class="dash-panel donut-panel"><h3>Login By Browser (Last 30 days)</h3><canvas id="browserDonut" height="420"></canvas></section>
      <section class="dash-panel donut-panel"><h3>Login By OS (Last 30 days)</h3><canvas id="osDonut" height="420"></canvas></section>
      <section class="dash-panel donut-panel"><h3>Login By Country (Last 30 days)</h3><canvas id="countryDonut" height="420"></canvas></section>
    </div>`, "dashboard");
  drawCharts();
}

function adminTable(title, headers, rows, active, before = "") {
  adminShell(title, `${before}<div class="admin-actions"><input id="adminSearch" class="plain-input light-input" placeholder="Search this table"><button class="admin-btn fill" onclick="filterVisibleTable('adminSearch')">Search</button><button class="admin-btn" onclick="clearVisibleTableFilter('adminSearch')">Reset</button></div><div class="admin-panel">${table(headers, rows, "admin-table")}</div>`, active);
}

function adminGlobalSearchKey(event, input) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const query = encodeURIComponent(input.value.trim());
  if (!query) return toast("Type something to search.", "Search");
  go(`/admin/search/${query}`);
}

function adminSearchPage(query = "") {
  const term = decodeURIComponent(query || "").toLowerCase();
  const rows = [];
  const push = (module, label, detail, path) => {
    if (!term || `${module} ${label} ${detail}`.toLowerCase().includes(term)) rows.push([esc(module), esc(label), esc(detail), `<button class="admin-btn" onclick="go('${path}')">Open</button>`]);
  };
  allSearchUsers().forEach(user => push("Users", user.name, `${user.email} ${user.key} ${pkr(user.balance)}`, "/admin/users/all"));
  (db.deposits || []).forEach(item => push("Deposits", item.user || item.gateway, `${item.trx} ${item.status} ${pkr(item.amount)}`, "/admin/deposits/all"));
  (db.withdrawals || []).forEach(item => push("Withdrawals", item.user || item.wallet, `${item.status} ${pkr(item.amount)} ${item.network}`, "/admin/withdrawals/all"));
  (db.trades || []).forEach(item => push("Trades", item.user || item.crypto, `${item.crypto} ${item.result} ${item.status} ${pkr(item.amount)}`, "/admin/trades"));
  (db.tickets || []).forEach(item => push("Tickets", item.subject || item.user, `${item.username} ${item.status} ${item.priority}`, "/admin/tickets"));
  adminShell(`Search: ${term || "All"}`, `<div class="admin-panel">${table(["Module", "Record", "Detail", "Action"], rows, "admin-table")}</div>`, "dashboard");
}

function allSearchUsers() {
  return [{ key: db.user.id, name: db.user.name, email: db.user.email, balance: db.user.balance }, ...db.users.map(u => ({ key: u[1], name: u[0], email: u[2], balance: u[4] }))];
}

function adminCrypto() {
  const rows = db.coins.filter(c => c[0] !== "PKR").map(c => {
    const status = db.coinStatuses?.[c[0]] || "Enabled";
    return [coinLabel(c), esc(c[0]), statusPill(status), `<button class='admin-btn' onclick="editCoin('${esc(c[0])}')">Edit</button> <button class='admin-btn' onclick="toggleCoin('${esc(c[0])}','${status === "Disabled" ? "enable" : "disable"}')">${status === "Disabled" ? "Enable" : "Disable"}</button> <button class='admin-btn danger' onclick="deleteCoin('${esc(c[0])}')">Delete</button>`];
  });
  adminTable("Crypto Currency List", ["Crypto", "Symbol", "Status", "Action"], rows, "crypto", `<div class="admin-actions"><button class="admin-btn fill" onclick="addCoin()">Add New Coin</button></div>`);
}

function adminSettings() {
  const rows = db.tradeDurations.map((d, i) => [esc(d.label.split(" ")[0]), esc(d.label.split(" ").slice(1).join(" ")), `${d.seconds}s`, `<button class='admin-btn' onclick="editDuration(${i})">Edit</button> <button class='admin-btn danger' onclick="deleteDuration(${i})">Delete</button>`]);
  adminTable("Trade Setting", ["Time", "Unit", "Seconds", "Action"], rows, "settings", `<div class="admin-panel"><b>Backend Trade Rules</b><p>Running trades use server time. Admin can force Win, Loss, or Draw before the countdown ends.</p><button class="admin-btn fill" onclick="addDuration()">Add Trade Time</button></div>`);
}

function adminSignals() {
  const rows = (db.signals || []).map(s => [esc(s.crypto), esc(s.direction), esc(s.time), esc(s.schedule), statusPill(s.status), `<button class='admin-btn' onclick="editSignal('${s.id}')">Edit</button> <button class='admin-btn danger' onclick="deleteSignal('${s.id}')">Delete</button>`]);
  adminTable("Trade Signals", ["Crypto", "Direction", "Time / Unit", "Schedule", "Status", "Action"], rows, "signals", `<div class="admin-actions"><button class="admin-btn fill" onclick="addSignal()">Add New Signal</button></div>`);
}

function adminSignalForm(id = "") {
  const signal = id ? (db.signals || []).find(item => item.id === id) : null;
  const coinOptions = (db.coins || []).filter(c => c[0] !== "PKR").map(c => `<option value="${esc(c[0])}">${esc(c[0])} - ${esc(c[1])}</option>`).join("");
  const timeOptions = (db.tradeDurations || []).map(d => `<option value="${esc(d.label)}">${esc(d.label)}</option>`).join("");
  adminShell(signal ? "Edit Trade Signal" : "Add Trade Signal", `<div class="admin-actions" style="justify-content:flex-start"><button class="admin-btn" onclick="go('/admin/signals')">Back to Signals</button></div>
    <form class="admin-panel settings-editor" id="signalForm">
      <div class="admin-form-3">
        <label>Crypto<select id="signalCrypto" class="plain-input light-input">${coinOptions}</select></label>
        <label>Direction<select id="signalDirection" class="plain-input light-input"><option>High / Long</option><option>Low / Short</option><option>Up</option><option>Down</option></select></label>
        <label>Time / Unit<select id="signalTime" class="plain-input light-input">${timeOptions}</select></label>
      </div>
      <div class="admin-form-3">
        <label>Schedule<select id="signalSchedule" class="plain-input light-input"><option>Manual / Always</option><option>Automatic</option><option>Manual Only</option></select></label>
        <label>Status<select id="signalStatus" class="plain-input light-input"><option>Active</option><option>Disabled</option></select></label>
        <label>Preview<input class="plain-input light-input" readonly value="${signal ? "Updating existing signal" : "Creating backend signal"}"></label>
      </div>
      <button class="admin-btn fill" style="margin-top:18px">${signal ? "Save Signal" : "Create Signal"}</button>
    </form>`, "signals");
  if (signal) {
    $("#signalCrypto").value = signal.crypto;
    $("#signalDirection").value = signal.direction;
    $("#signalTime").value = signal.time;
    $("#signalSchedule").value = signal.schedule;
    $("#signalStatus").value = signal.status;
  }
  $("#signalForm").onsubmit = async e => {
    e.preventDefault();
    const payload = {
      crypto: $("#signalCrypto").value,
      direction: $("#signalDirection").value,
      time: $("#signalTime").value,
      schedule: $("#signalSchedule").value,
      status: $("#signalStatus").value
    };
    try {
      if (signal) await API.post(`/api/admin/signals/${signal.id}`, payload);
      else await API.post("/api/admin/signals", payload);
      await loadState();
      toast(signal ? "Signal updated." : "Signal added.", "Admin");
      go("/admin/signals");
    } catch (err) {
      toast(err.message, "Error");
    }
  };
}

function adminTrades(filter = "", active = "trades-all", title = "") {
  const rows = db.trades.filter(t => !filter || t.result === filter).map(t => [
    esc(t.user), esc(t.crypto), pkr(t.amount), `${t.seconds}s`, esc(t.direction), esc(t.result || "Waiting"), statusPill(t.status), esc(t.createdAt),
    `<button class="admin-btn" onclick="setTradeResult('${t.id}','Win')">Win</button> <button class="admin-btn danger" onclick="setTradeResult('${t.id}','Loss')">Lose</button> <button class="admin-btn" onclick="setTradeResult('${t.id}','Draw')">Draw</button>`
  ]);
  adminTable(title || (filter ? `${filter} Trade Log` : "Trade Log"), ["User", "Crypto", "Amount", "Trade Time", "Up/Down", "Result", "Status", "Date", "Admin Control"], rows, active);
}

async function setTradeResult(id, result) {
  await API.post(`/api/admin/trades/${id}`, { result, note: "Admin selected result" });
  await loadState();
  render();
}

function adminUsers(kind = "Active Users", filter = "active", active = "users-active") {
  const users = [{ key: db.user.id, name: db.user.name, email: db.user.email, country: "PK", balance: db.user.balance }, ...db.users.map(u => ({ key: u[1], name: u[0], email: u[2], country: u[3], balance: u[4] }))];
  const kycPending = new Set((db.kycSubmissions || []).filter(k => k.status === "Pending").map(k => k.user));
  const kycApproved = new Set((db.kycSubmissions || []).filter(k => k.status === "Approved").map(k => k.user));
  const filtered = users.filter(u => {
    const status = db.userStatuses?.[u.key] || "Active";
    if (filter === "all") return true;
    if (filter === "banned") return status === "Banned";
    if (filter === "balance") return Number(u.balance || 0) > 0;
    if (filter === "kyc-pending") return kycPending.has(u.name);
    if (filter === "kyc-unverified") return !kycApproved.has(u.name);
    if (filter === "email-unverified" || filter === "mobile-unverified") return false;
    return status !== "Banned";
  });
  const rows = filtered.map(u => {
    const status = db.userStatuses?.[u.key] || "Active";
    return [esc(u.name), esc(u.key), esc(u.email), esc(u.country), statusPill(status), pkr(u.balance), `<button class='admin-btn' onclick="editUser('${esc(u.key)}')">Edit</button> <button class='admin-btn' onclick="toggleUser('${esc(u.key)}','${status === "Banned" ? "unban" : "ban"}')">${status === "Banned" ? "Unban" : "Ban"}</button> <button class='admin-btn danger' onclick="deleteUser('${esc(u.key)}')">Delete</button>`];
  });
  adminTable(kind, ["User", "UID", "Email-Mobile", "Country", "Status", "Balance", "Action"], rows, active);
}

function adminDeposits(kind = "All Deposits", status = "", active = "deposits-all") {
  const rows = db.deposits.filter(d => !status || d.status === status).map(d => [
    `${esc(d.gateway)}<br><small>${esc(d.trx)}</small>${d.proof ? `<br><a class="link" href="${esc(d.proof)}" target="_blank">View Proof</a>` : ""}`, esc(d.date), esc(d.user), `${pkr(d.amount)} + <b style='color:red'>PKR0.00 PKR</b>`, "PKR1.00 PKR = 1.00 PKR", statusPill(d.status),
    `<button class="admin-btn" onclick="setDepositStatus('${d.id}','Approved')">Approve</button> <button class="admin-btn" onclick="setDepositStatus('${d.id}','Successful')">Success</button> <button class="admin-btn danger" onclick="setDepositStatus('${d.id}','Rejected')">Reject</button>`
  ]);
  adminTable(kind, ["Gateway | Transaction", "Initiated", "User", "Amount", "Conversion", "Status", "Action"], rows, active, `<div class="admin-actions"><button class="admin-btn fill" onclick="go('/admin/adjust')">Deposit Add / Deduct</button></div>`);
}

function adminWithdrawals(kind = "All Withdrawals", status = "", active = "withdrawals-all") {
  const rows = (db.withdrawals || []).filter(w => !status || w.status === status).map(w => [
    `${esc(w.wallet)}<br><small>${esc(w.network)}</small>`,
    esc(w.date),
    esc(w.user),
    pkr(w.amount),
    statusPill(w.status),
    esc(w.adminNote || "-"),
    `<button class="admin-btn" onclick="setWithdrawalStatus('${w.id}','Approved')">Approve</button> <button class="admin-btn danger" onclick="setWithdrawalStatus('${w.id}','Rejected')">Reject</button>`
  ]);
  adminTable(kind, ["Wallet", "Requested", "User", "Amount", "Status", "Admin Note", "Action"], rows, active);
}

function adminKyc(status = "", title = "Manage KYC", active = "kyc") {
  const rows = (db.kycSubmissions || []).filter(k => !status || k.status === status).map(k => [
    esc(k.user),
    esc(k.fullName),
    `${esc(k.documentType)}<br><small>${esc(k.documentNumber)}</small>`,
    esc((k.hobbies || []).join(", ") || "-"),
    Object.entries(k.files || {}).map(([name, file]) => file?.path ? `<a class="link" href="${esc(file.path)}" target="_blank">${esc(name)}</a>` : "").filter(Boolean).join(" ") || "-",
    esc(k.date),
    statusPill(k.status),
    esc(k.adminNote || "-"),
    `<button class="admin-btn" onclick="setKycStatus('${k.id}','Approved')">Approve</button> <button class="admin-btn danger" onclick="setKycStatus('${k.id}','Rejected')">Reject</button>`
  ]);
  adminTable(title, ["User", "Full Name", "Document", "Hobbies", "Files", "Date", "Status", "Admin Note", "Action"], rows, active);
}

function adminTransactions() {
  const rows = (db.transactions || []).map(t => [
    esc(t.date),
    esc(t.userId),
    esc(t.type),
    pkr(t.amount),
    pkr(t.balanceBefore),
    pkr(t.balanceAfter),
    esc(t.remark)
  ]);
  adminTable("Transactions", ["Date", "User", "Type", "Amount", "Before", "After", "Remark"], rows, "transactions");
}

function adminAdjustments() {
  const users = [
    { key: db.user.id, name: db.user.name, email: db.user.email, balance: db.user.balance },
    ...db.users.map(user => ({ key: user[1], name: user[0], email: user[2], balance: user[4] }))
  ];
  const history = db.balanceAdjustments || [];
  const userCards = users.map(user => `<div class="adjust-user-card"><b>${esc(user.name)}</b><small>${esc(user.email)}</small><strong>${pkr(user.balance)}</strong></div>`).join("");
  const rows = history.map(item => [
    esc(item.date),
    esc(item.user),
    item.type === "Deduct" ? `<span class="pill bad">Deduct</span>` : `<span class="pill good">Add</span>`,
    pkr(item.amount),
    pkr(item.balanceAfter),
    esc(item.remark)
  ]);
  adminShell("Deposit Add / Deduct", `<div class="admin-cards adjust-cards">${userCards}</div>
    <form class="admin-panel" id="adjustForm">
      <h3>Admin Balance Control</h3>
      <div class="admin-form-3">
        <label>User<select id="adjustUser" class="plain-input light-input">${users.map(user => `<option value="${esc(user.key)}">${esc(user.name)} - ${pkr(user.balance)}</option>`).join("")}</select></label>
        <label>Function<select id="adjustAction" class="plain-input light-input"><option value="add">Deposit Add</option><option value="deduct">Deposit Deduct</option></select></label>
        <label>Amount PKR<input id="adjustAmount" class="plain-input light-input" type="number" min="1" placeholder="Enter PKR amount" required></label>
      </div>
      <label style="display:block;margin-top:16px">Remark<input id="adjustRemark" class="plain-input light-input" placeholder="Reason / note for this adjustment"></label>
      <div class="admin-actions" style="justify-content:flex-start;margin-top:16px">
        <button class="admin-btn fill">Submit Adjustment</button>
        <button type="button" class="admin-btn" onclick="go('/admin/deposits')">View Deposit History</button>
      </div>
    </form>
    <div class="admin-panel"><h3>Adjustment History</h3>${table(["Date", "User", "Type", "Amount", "Balance After", "Remark"], rows, "admin-table")}</div>`, "deposits-adjust");
  $("#adjustForm").onsubmit = async e => {
    e.preventDefault();
    try {
      await API.post("/api/admin/balance-adjustments", {
        userKey: $("#adjustUser").value,
        action: $("#adjustAction").value,
        amount: Number($("#adjustAmount").value),
        remark: $("#adjustRemark").value
      });
      await loadState();
      toast("Balance updated and saved to backend.", "Admin");
      render();
    } catch (err) {
      toast(err.message, "Error");
    }
  };
}

async function setDepositStatus(id, status) {
  await API.post(`/api/admin/deposits/${id}`, { status });
  await loadState();
  render();
}

async function setWithdrawalStatus(id, status) {
  const adminNote = status === "Rejected" ? (prompt("Rejection note", "Rejected by admin") || "Rejected by admin") : "Approved by admin";
  await API.post(`/api/admin/withdrawals/${id}`, { status, adminNote });
  await loadState();
  render();
}

async function setKycStatus(id, status) {
  const adminNote = status === "Rejected" ? (prompt("KYC note", "Document could not be verified") || "Document could not be verified") : "KYC verified";
  await API.post(`/api/admin/kyc/${id}`, { status, adminNote });
  await loadState();
  render();
}

function adminNotify() {
  adminShell("Notification to Verified Users", `<form class="admin-panel" id="notifyForm" data-channel="email"><div class="notify-tabs"><div class="notify-tab active" data-channel="email" onclick="selectNotifyChannel('email')">Mail<br>Send Via Email</div><div class="notify-tab" data-channel="sms" onclick="selectNotifyChannel('sms')">SMS<br>Send Via SMS</div><div class="notify-tab" data-channel="firebase" onclick="selectNotifyChannel('firebase')">App<br>Send Via Firebase</div></div><label>Being Sent To *</label><select id="sendTo" class="plain-input light-input"><option>Kyc Unverified Users</option><option>KYC Pending Users</option><option>Users With Balance</option><option>All Users</option><option>Active Users</option></select><p class="link">${allSearchUsers().length} users available for notification batches</p><label>Subject *</label><input id="subj" class="plain-input light-input" required placeholder="Subject / Title"><label>Message *</label><div class="editor-bar">B I U | Font Size | Font Family | Link | Image</div><textarea id="msg" class="light-input" required></textarea><div class="form-grid admin-form-3"><input id="notifyStart" class="plain-input light-input" type="number" min="0" value="0" placeholder="Start from user id e.g. 1"><input id="notifyBatch" class="plain-input light-input" type="number" min="1" value="50" placeholder="How many user"><input id="notifyCooling" class="plain-input light-input" type="number" min="0" value="0" placeholder="Waiting time"></div><button class="btn" style="width:100%;margin-top:18px;background:var(--admin-accent)">Submit</button></form>`, "notify");
  $("#notifyForm").onsubmit = async e => {
    e.preventDefault();
    try {
      const data = await API.post("/api/admin/notifications", { channel: $("#notifyForm").dataset.channel, to: $("#sendTo").value, subject: $("#subj").value, msg: $("#msg").value, startFrom: Number($("#notifyStart").value), perBatch: Number($("#notifyBatch").value), coolingPeriod: Number($("#notifyCooling").value) });
      await loadState();
      toast(`Notification saved for ${data.history?.recipientCount || 0} users.`, "Admin");
    } catch (err) {
      toast(err.message, "Error");
    }
  };
}

function selectNotifyChannel(channel) {
  const form = $("#notifyForm");
  if (form) form.dataset.channel = channel;
  document.querySelectorAll(".notify-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.channel === channel));
}

function adminSystem() {
  const cards = [
    ["general", "General Setting", "Site name, contact, address, and tagline."],
    ["logo", "Logo and Favicon", "Control logo text and favicon text."],
    ["configuration", "System Configuration", "Maintenance, captcha, and trade result rules."],
    ["notification", "Notification Setting", "Email, SMS, Firebase, and sender name."],
    ["gateways", "Payment Gateways", "Manual and automatic PKR gateways."],
    ["withdrawals", "Withdrawals Methods", "Allowed PKR withdrawal methods."],
    ["seo", "SEO Configuration", "Meta title, description, and keywords."],
    ["frontend", "Manage Frontend", "Footer text, newsletter text, and quick links."],
    ["pages", "Manage Pages", "Terms, policies, disclaimer, and contact page."],
    ["kyc", "KYC Setting", "KYC form fields."],
    ["language", "Language", "Default and enabled languages."],
    ["social", "Social Login Setting", "Google and Facebook login switches."],
    ["cron", "Cron Job Setting", "Automation interval settings."],
    ["gdpr", "GDPR Cookie", "Cookie notice settings."],
    ["custom-css", "Custom CSS", "Live custom frontend CSS."],
    ["sitemap", "Sitemap XML", "Sitemap path used by the app."],
    ["robots", "Robots txt", "Robots file content."],
    ["extensions", "Extensions", "Extra module list."]
  ];
  adminShell("System Settings", `<div class="admin-panel"><input id="settingsSearch" class="plain-input light-input" placeholder="Search settings..." oninput="filterSettingsCards(this.value)"><p>Open any setting below, edit it, and save. Changes are stored in the backend and appear after reload.</p></div><div class="settings-grid">${cards.map(card => settingCard(card[1], card[2], card[0])).join("")}</div>`, "system");
}

function settingCard(title, detail, key) {
  return `<button class="setting-card" data-setting-card="${esc(`${title} ${detail}`)}" onclick="go('/admin/system/${key}')"><span class="setting-icon">[]</span><div><b>${esc(title)}</b><small>${esc(detail)}</small></div></button>`;
}

function filterSettingsCards(value) {
  const term = String(value || "").trim().toLowerCase();
  document.querySelectorAll("[data-setting-card]").forEach(card => {
    card.style.display = !term || card.dataset.settingCard.toLowerCase().includes(term) ? "" : "none";
  });
}

async function saveAdminSettings(payload) {
  await API.post("/api/admin/settings", payload);
  await loadState();
  applyCustomCss();
  toast("Settings saved in backend.", "Admin");
  render();
}

function toggleAdminProfileMenu(event) {
  event?.stopPropagation?.();
  document.querySelector("#adminProfileMenu")?.classList.toggle("open");
}

function closeAdminProfileMenu() {
  document.querySelector("#adminProfileMenu")?.classList.remove("open");
}

function adminProfilePage() {
  const profile = db.adminSettings?.adminProfile || {};
  adminShell("Admin Profile", `<form class="admin-panel settings-editor" id="adminProfileForm">
    <div class="admin-form-3">
      <label>Display Name<input id="adminProfileName" class="plain-input light-input" required value="${esc(profile.name || "admin")}"></label>
      <label>Email<input id="adminProfileEmail" class="plain-input light-input" type="email" value="${esc(profile.email || db.adminSettings.supportEmail || "admin@tradersview.pk")}"></label>
      <label>Role<input class="plain-input light-input" readonly value="${esc(profile.role || "Super Admin")}"></label>
    </div>
    <div class="admin-form-3">
      <label>Phone<input id="adminProfilePhone" class="plain-input light-input" value="${esc(profile.phone || db.adminSettings.supportPhone || "")}"></label>
      <label>Timezone<input id="adminProfileTimezone" class="plain-input light-input" value="${esc(profile.timezone || "Asia/Karachi")}"></label>
      <label>Status<input class="plain-input light-input" readonly value="Active"></label>
    </div>
    <button class="admin-btn fill" style="margin-top:18px">Save Profile</button>
  </form>`, "admin-profile");
  $("#adminProfileForm").onsubmit = e => {
    e.preventDefault();
    saveAdminSettings({
      adminProfile: {
        name: $("#adminProfileName").value,
        email: $("#adminProfileEmail").value,
        phone: $("#adminProfilePhone").value,
        timezone: $("#adminProfileTimezone").value,
        role: profile.role || "Super Admin"
      }
    });
  };
}

function adminPasswordPage() {
  const security = db.adminSettings?.adminSecurity || {};
  adminShell("Admin Password", `<form class="admin-panel settings-editor" id="adminPasswordForm">
    <div class="admin-form-3">
      <label>Current Password<input id="adminCurrentPass" class="plain-input light-input" type="password" required placeholder="Current password"></label>
      <label>New Password<input id="adminNewPass" class="plain-input light-input" type="password" required minlength="6" placeholder="New password"></label>
      <label>Confirm Password<input id="adminConfirmPass" class="plain-input light-input" type="password" required minlength="6" placeholder="Confirm password"></label>
    </div>
    <div class="admin-form-3">
      <label><input id="adminTwoFactor" type="checkbox" ${security.twoFactor ? "checked" : ""}> Enable 2FA reminder</label>
      <label>Last Updated<input class="plain-input light-input" readonly value="${esc(security.passwordUpdatedAt || "Not updated yet")}"></label>
      <label>Session<input class="plain-input light-input" readonly value="JWT admin session active"></label>
    </div>
    <button class="admin-btn fill" style="margin-top:18px">Update Password</button>
  </form>`, "admin-password");
  $("#adminPasswordForm").onsubmit = async e => {
    e.preventDefault();
    const next = $("#adminNewPass").value;
    const confirmPass = $("#adminConfirmPass").value;
    if (next.length < 6) return toast("New password must be at least 6 characters.", "Error");
    if (next !== confirmPass) return toast("Password confirmation does not match.", "Error");
    try {
      await API.post("/api/admin/password", { currentPassword: $("#adminCurrentPass").value, newPassword: next, twoFactor: boolValue("adminTwoFactor") });
      await loadState();
      toast("Admin password updated.", "Admin");
      render();
    } catch (err) {
      toast(err.message, "Error");
    }
  };
}

function adminSystemSection(key) {
  const s = db.adminSettings;
  const wrap = (title, body) => {
    adminShell(title, `<div class="admin-actions" style="justify-content:flex-start"><button class="admin-btn" onclick="go('/admin/system')">Back to System Settings</button></div><form class="admin-panel settings-editor" id="systemSectionForm">${body}<button class="admin-btn fill" style="margin-top:18px">Save Changes</button></form>`, "system");
  };
  if (key === "general") {
    wrap("General Setting", `<div class="admin-form-3"><label>Site Name<input id="siteName" class="plain-input light-input" value="${esc(s.siteName)}"></label><label>Tagline<input id="tagline" class="plain-input light-input" value="${esc(s.tagline)}"></label><label>Support Email<input id="supportEmail" class="plain-input light-input" value="${esc(s.supportEmail)}"></label></div><div class="admin-form-3"><label>Support Phone<input id="supportPhone" class="plain-input light-input" value="${esc(s.supportPhone)}"></label><label>Address<input id="address" class="plain-input light-input" value="${esc(s.address)}"></label><label>Default Trade Result<select id="defaultTradeResult" class="plain-input light-input"><option>Auto</option><option>Win</option><option>Loss</option><option>Draw</option></select></label></div>`);
    $("#defaultTradeResult").value = s.defaultTradeResult;
    $("#systemSectionForm").onsubmit = e => { e.preventDefault(); saveAdminSettings({ siteName: $("#siteName").value, tagline: $("#tagline").value, supportEmail: $("#supportEmail").value, supportPhone: $("#supportPhone").value, address: $("#address").value, defaultTradeResult: $("#defaultTradeResult").value }); };
    return;
  }
  if (key === "logo") {
    wrap("Logo and Favicon", `<div class="admin-form-3"><label>Logo Text<input id="logoText" class="plain-input light-input" value="${esc(s.logoText)}"></label><label>Favicon Text<input id="faviconText" class="plain-input light-input" maxlength="4" value="${esc(s.faviconText)}"></label><label>Preview<div class="admin-preview">${brand()}</div></label></div>`);
    $("#systemSectionForm").onsubmit = e => { e.preventDefault(); saveAdminSettings({ logoText: $("#logoText").value, faviconText: $("#faviconText").value }); };
    return;
  }
  if (key === "configuration") {
    wrap("System Configuration", `<div class="admin-form-3"><label>Maintenance<select id="maintenance" class="plain-input light-input"><option value="false">Off</option><option value="true">On</option></select></label><label>Default Trade Result<select id="defaultTradeResult" class="plain-input light-input"><option>Auto</option><option>Win</option><option>Loss</option><option>Draw</option></select></label><label>Captcha Font<input id="captchaFont" class="plain-input light-input" value="${esc(s.captcha.font)}"></label></div><div class="admin-form-3"><label>Captcha Style<select id="captchaStyle" class="plain-input light-input"><option>neon</option><option>stripe</option><option>glass</option></select></label><label>Captcha Length<input id="captchaLength" class="plain-input light-input" type="number" min="4" max="8" value="${esc(s.captcha.length)}"></label><label><input id="captchaRotate" type="checkbox" ${checked(s.captcha.rotate)}> Rotate / tilt captcha text</label></div><div class="captcha settings-captcha"><div class="captcha-code captcha-${esc(s.captcha.style)} ${s.captcha.rotate ? "captcha-tilt" : ""}" style="font-family:${esc(s.captcha.font)}">${captchaCode()}</div></div>`);
    $("#maintenance").value = String(s.maintenance);
    $("#defaultTradeResult").value = s.defaultTradeResult;
    $("#captchaStyle").value = s.captcha.style;
    $("#systemSectionForm").onsubmit = e => { e.preventDefault(); saveAdminSettings({ maintenance: $("#maintenance").value === "true", defaultTradeResult: $("#defaultTradeResult").value, captcha: { font: $("#captchaFont").value, style: $("#captchaStyle").value, length: Number($("#captchaLength").value), rotate: boolValue("captchaRotate") } }); };
    return;
  }
  if (key === "notification") {
    wrap("Notification Setting", `<div class="admin-form-3"><label>From Name<input id="fromName" class="plain-input light-input" value="${esc(s.notifications.fromName)}"></label><label><input id="emailOn" type="checkbox" ${checked(s.notifications.email)}> Email Enabled</label><label><input id="smsOn" type="checkbox" ${checked(s.notifications.sms)}> SMS Enabled</label></div><div class="admin-form-3"><label><input id="firebaseOn" type="checkbox" ${checked(s.notifications.firebase)}> Firebase Enabled</label><label>Latest Notification<input class="plain-input light-input" readonly value="${esc(db.notifications?.[0]?.subject || "No notification")}"></label><label><button type="button" class="admin-btn" onclick="go('/admin/notify')">Open Send Notification</button></label></div>`);
    $("#systemSectionForm").onsubmit = e => { e.preventDefault(); saveAdminSettings({ notifications: { fromName: $("#fromName").value, email: boolValue("emailOn"), sms: boolValue("smsOn"), firebase: boolValue("firebaseOn") } }); };
    return;
  }
  if (key === "gateways") {
    wrap("Payment Gateways", `<div class="admin-form-3"><label>Manual PKR Gateways<input id="paymentMethods" class="plain-input light-input" value="${esc(listText(s.paymentMethods))}"></label><label>Automatic Gateways<input id="automaticGateways" class="plain-input light-input" value="${esc(listText(s.automaticGateways))}"></label><label><button type="button" class="admin-btn" onclick="go('/admin/gateways')">Open Gateway List</button></label></div><p>Use commas between gateway names. User deposits remain PKR only.</p>`);
    $("#systemSectionForm").onsubmit = e => { e.preventDefault(); saveAdminSettings({ paymentMethods: listValue($("#paymentMethods").value), automaticGateways: listValue($("#automaticGateways").value) }); };
    return;
  }
  if (key === "withdrawals") {
    wrap("Withdrawals Methods", `<label>Withdrawal Methods<textarea id="withdrawalMethods" class="light-input">${esc(listText(s.withdrawalMethods))}</textarea></label><p>Use commas between PKR withdrawal options.</p>`);
    $("#systemSectionForm").onsubmit = e => { e.preventDefault(); saveAdminSettings({ withdrawalMethods: listValue($("#withdrawalMethods").value) }); };
    return;
  }
  if (key === "seo") {
    wrap("SEO Configuration", `<div class="admin-form-3"><label>Meta Title<input id="seoTitle" class="plain-input light-input" value="${esc(s.seo.title)}"></label><label>Keywords<input id="seoKeywords" class="plain-input light-input" value="${esc(s.seo.keywords)}"></label><label>Sitemap<input id="seoSitemap" class="plain-input light-input" value="${esc(s.sitemap)}"></label></div><label>Description<textarea id="seoDescription" class="light-input">${esc(s.seo.description)}</textarea></label>`);
    $("#systemSectionForm").onsubmit = e => { e.preventDefault(); saveAdminSettings({ sitemap: $("#seoSitemap").value, seo: { title: $("#seoTitle").value, description: $("#seoDescription").value, keywords: $("#seoKeywords").value } }); };
    return;
  }
  if (key === "frontend") {
    wrap("Manage Frontend", `<label>Footer Welcome Text<textarea id="welcomeText" class="light-input">${esc(s.frontend.welcome)}</textarea></label><label>Newsletter Text<textarea id="newsletterText" class="light-input">${esc(s.frontend.newsletterText)}</textarea></label><label>Quick Links <small>One per line: Label|/route</small><textarea id="quickLinks" class="light-input">${esc(quickLinksText(s.quickLinks))}</textarea></label>`);
    $("#systemSectionForm").onsubmit = e => { e.preventDefault(); saveAdminSettings({ frontend: { welcome: $("#welcomeText").value, newsletterText: $("#newsletterText").value }, quickLinks: parseQuickLinks($("#quickLinks").value) }); };
    return;
  }
  if (key === "pages") {
    const fields = [["termsOfUse", "Terms of Use"], ["termsOfService", "Terms of Service"], ["privacyPolicy", "Privacy Policy"], ["riskDisclaimer", "Risk Disclaimer"], ["contact", "Contact"]];
    wrap("Manage Pages", fields.map(([id, label]) => `<section class="page-edit"><h3>${label}</h3><label>Title<input id="${id}Title" class="plain-input light-input" value="${esc(s.pages[id]?.title || label)}"></label><label>Body<textarea id="${id}Body" class="light-input">${esc(s.pages[id]?.body || "")}</textarea></label></section>`).join(""));
    $("#systemSectionForm").onsubmit = e => {
      e.preventDefault();
      const pages = {};
      fields.forEach(([id]) => pages[id] = { title: $(`#${id}Title`).value, body: $(`#${id}Body`).value });
      saveAdminSettings({ pages });
    };
    return;
  }
  if (key === "kyc") {
    wrap("KYC Setting", `<label>KYC Fields<textarea id="kycFields" class="light-input">${esc(listText(s.kycFields))}</textarea></label><p>Use commas between fields. This controls the backend setting used by the KYC workflow.</p>`);
    $("#systemSectionForm").onsubmit = e => { e.preventDefault(); saveAdminSettings({ kycFields: listValue($("#kycFields").value) }); };
    return;
  }
  if (key === "language") {
    wrap("Language", `<div class="admin-form-3"><label>Default Language<input id="defaultLanguage" class="plain-input light-input" value="${esc(s.language.default)}"></label><label>Enabled Languages<input id="enabledLanguage" class="plain-input light-input" value="${esc(s.language.enabled)}"></label><label>Top Bar Preview<input class="plain-input light-input" readonly value="${esc(s.language.default)}"></label></div>`);
    $("#systemSectionForm").onsubmit = e => { e.preventDefault(); saveAdminSettings({ language: { default: $("#defaultLanguage").value, enabled: $("#enabledLanguage").value } }); };
    return;
  }
  if (key === "social") {
    wrap("Social Login Setting", `<div class="admin-form-3"><label><input id="googleLogin" type="checkbox" ${checked(s.socialLogin.google)}> Google Login</label><label><input id="facebookLogin" type="checkbox" ${checked(s.socialLogin.facebook)}> Facebook Login</label><label>Status<input class="plain-input light-input" readonly value="Saved in backend settings"></label></div><div class="admin-form-3"><label>Google Client ID<input id="googleClientId" class="plain-input light-input" value="${esc(s.oauth?.googleClientId || "")}" placeholder="GOOGLE_CLIENT_ID from env"></label><label>Facebook App ID<input id="facebookAppId" class="plain-input light-input" value="${esc(s.oauth?.facebookAppId || "")}" placeholder="FACEBOOK_APP_ID from env"></label><label>Secret Storage<input class="plain-input light-input" readonly value="Secrets stay in .env"></label></div>`);
    $("#systemSectionForm").onsubmit = e => { e.preventDefault(); saveAdminSettings({ socialLogin: { google: boolValue("googleLogin"), facebook: boolValue("facebookLogin") }, oauth: { googleClientId: $("#googleClientId").value, facebookAppId: $("#facebookAppId").value } }); };
    return;
  }
  if (key === "cron") {
    wrap("Cron Job Setting", `<div class="admin-form-3"><label><input id="cronEnabled" type="checkbox" ${checked(s.cron.enabled)}> Cron Enabled</label><label>Interval<input id="cronInterval" class="plain-input light-input" value="${esc(s.cron.interval)}"></label><label>Purpose<input class="plain-input light-input" readonly value="Auto trade completion"></label></div>`);
    $("#systemSectionForm").onsubmit = e => { e.preventDefault(); saveAdminSettings({ cron: { enabled: boolValue("cronEnabled"), interval: $("#cronInterval").value } }); };
    return;
  }
  if (key === "gdpr") {
    wrap("GDPR Cookie", `<label><input id="gdprEnabled" type="checkbox" ${checked(s.gdpr.enabled)}> Enable Cookie Notice</label><label>Cookie Text<textarea id="gdprText" class="light-input">${esc(s.gdpr.text)}</textarea></label>`);
    $("#systemSectionForm").onsubmit = e => { e.preventDefault(); saveAdminSettings({ gdpr: { enabled: boolValue("gdprEnabled"), text: $("#gdprText").value } }); };
    return;
  }
  if (key === "custom-css") {
    wrap("Custom CSS", `<label>CSS<textarea id="customCss" class="light-input code-input">${esc(s.customCss || "/* Example: .hero h1 { color: #19c3ff; } */")}</textarea></label>`);
    $("#systemSectionForm").onsubmit = e => { e.preventDefault(); saveAdminSettings({ customCss: $("#customCss").value }); };
    return;
  }
  if (key === "sitemap") {
    wrap("Sitemap XML", `<label>Sitemap Path<input id="sitemap" class="plain-input light-input" value="${esc(s.sitemap)}"></label>`);
    $("#systemSectionForm").onsubmit = e => { e.preventDefault(); saveAdminSettings({ sitemap: $("#sitemap").value }); };
    return;
  }
  if (key === "robots") {
    wrap("Robots txt", `<label>Robots Content<textarea id="robots" class="light-input code-input">${esc(s.robots)}</textarea></label>`);
    $("#systemSectionForm").onsubmit = e => { e.preventDefault(); saveAdminSettings({ robots: $("#robots").value }); };
    return;
  }
  if (key === "extensions") {
    wrap("Extensions", `<label>Enabled Extensions<textarea id="extensions" class="light-input">${esc(listText(s.extensions || ["Live Support", "Notifications", "PKR Wallet", "Admin Trade Control"]))}</textarea></label>`);
    $("#systemSectionForm").onsubmit = e => { e.preventDefault(); saveAdminSettings({ extensions: listValue($("#extensions").value) }); };
    return;
  }
  adminSystem();
}

function adminGateways() {
  const gateways = [...(db.adminSettings.paymentMethods || []).map(name => ({ name, type: "manual" })), ...(db.adminSettings.automaticGateways || []).map(name => ({ name, type: "automatic" }))];
  const rows = gateways.map((g, i) => {
    const status = db.gatewayStatuses?.[g.name] || "Enabled";
    return [esc(g.name), esc(g.type), String(i + 1), statusPill(status), `<button class='admin-btn' onclick="editGateway('${esc(g.name)}')">Edit</button> <button class='admin-btn' onclick="toggleGateway('${esc(g.name)}','${status === "Disabled" ? "enable" : "disable"}')">${status === "Disabled" ? "Enable" : "Disable"}</button> <button class='admin-btn danger' onclick="deleteGateway('${esc(g.name)}')">Delete</button>`];
  });
  adminTable("Payment Gateways", ["Gateway", "Type", "Supported Currency", "Status", "Action"], rows, "gateways", `<div class="admin-panel tabs-line"><button class="admin-btn fill" onclick="addGateway('automatic')">Add Automatic Gateway</button><button class="admin-btn" onclick="addGateway('manual')">Add Manual Gateway</button><p>PKR-only user deposits stay active through manual Bank Deposit, EasyPaisa, and Jazz Cash.</p></div>`);
}

async function adminExtra(kind) {
  let info = null;
  try {
    info = await API.get("/api/admin/system/info");
  } catch (err) {
    toast(err.message, "Error");
  }
  const appInfo = info?.app || {};
  const serverInfo = info?.server || {};
  const cacheInfo = info?.cache || {};
  const updateInfo = info?.updates || {};
  const active = `extra-${kind}`;
  if (kind === "app") {
    adminShell("Application Information", `<div class="admin-panel">${table(["Item", "Value"], [
      ["Application", esc(appInfo.name || db.adminSettings.siteName)],
      ["Sajjulab Version", esc(appInfo.version || "5.0")],
      ["Backend", esc(appInfo.backend || "Node.js")],
      ["Node Version", esc(appInfo.node || "-")],
      ["Environment", esc(appInfo.environment || "development")],
      ["Timezone", esc(appInfo.timezone || "Local")],
      ["Data Store", esc(appInfo.dataStore || "Local JSON backend")]
    ], "admin-table")}</div>`, active);
    return;
  }
  if (kind === "server") {
    adminShell("Server Information", `<div class="admin-panel">${table(["Item", "Value"], [
      ["Server Software", esc(serverInfo.software || "Node.js HTTP Server")],
      ["Server Host", esc(serverInfo.host || "127.0.0.1")],
      ["Server Port", esc(serverInfo.port || "5177")],
      ["Server Protocol", esc(serverInfo.protocol || "HTTP/1.1")],
      ["Server IP Address", esc(serverInfo.address || "127.0.0.1")],
      ["Memory Usage", `${esc(serverInfo.memoryMB || 0)} MB`],
      ["Platform", esc(serverInfo.platform || "-")]
    ], "admin-table")}</div>`, active);
    return;
  }
  if (kind === "cache") {
    adminShell("Clear System Cache", `<div class="admin-panel cache-panel">
      ${["Price feed cache will be cleared", "Rate-limit buckets will be cleared", "Runtime backend cache will be refreshed", "System action will be logged", "Frontend should be hard-refreshed after clearing"].map(text => `<div class="cache-row"><span class="check-mark">&#10003;</span> ${esc(text)}</div>`).join("")}
      <button class="admin-btn fill cache-clear-btn" onclick="clearSystemCache()">Click to clear</button>
      <p>Last cache age: ${Number(cacheInfo.priceCacheAgeMs || 0)} ms | Rate buckets: ${Number(cacheInfo.rateBuckets || 0)}</p>
    </div>`, active);
    return;
  }
  adminShell("System Updates", `<div class="admin-actions"><button class="admin-btn" onclick="checkSystemUpdate()">Update Log</button></div>
    <div class="admin-panel update-card"><strong>${esc(updateInfo.currentVersion || "5.0")}</strong><span>Your Version</span><p>${esc(updateInfo.status || "Current")} - latest version ${esc(updateInfo.latestVersion || "5.0")}.</p></div>
    <div class="admin-panel">${table(["Date", "Version", "Status", "Detail"], (updateInfo.logs || []).map(log => [esc(log.date), esc(log.version), esc(log.status), esc(log.detail)]), "admin-table")}</div>`, active);
}

async function clearSystemCache() {
  try {
    const data = await API.post("/api/admin/system/cache-clear", {});
    toast(data.message || "Cache cleared.", "System");
    await loadState();
    render();
  } catch (err) {
    toast(err.message, "Error");
  }
}

async function checkSystemUpdate() {
  try {
    await API.post("/api/admin/system/update-check", {});
    toast("System update checked.", "System");
    await loadState();
    render();
  } catch (err) {
    toast(err.message, "Error");
  }
}

function adminTickets(kind = "Support Tickets", status = "", active = "tickets-all") {
  const rows = (db.tickets || []).filter(t => !status || (t.status || "Open") === status).map(t => [esc(t.subject || "Support Request"), esc(t.user), statusPill(t.status || "Open"), esc(t.priority || "Normal"), `${Number(t.messages || 0)} messages`, `<button class='admin-btn' onclick="replyTicket('${t.id}')">Reply</button> <button class='admin-btn' onclick="closeTicket('${t.id}')">Close</button> <button class='admin-btn danger' onclick="deleteTicket('${t.id}')">Delete</button>`]);
  adminTable(kind, ["Subject", "Submitted By", "Status", "Priority", "Last Reply", "Action"], rows, active);
}

function adminChat() {
  adminTable("Live Support Chat", ["User", "Username", "Action"], db.tickets.map(t => [esc(t.user), esc(t.username), `<button class='admin-btn' onclick="replyTicket('${t.id}')">Chat <span class='pill bad'>${t.messages}</span></button> <button class='admin-btn danger' onclick="deleteTicket('${t.id}')">Delete</button>`]), "chat");
}

function adminSubscribers() {
  const subscribers = db.subscribers || [];
  const rows = subscribers.map((item, index) => [index + 1, esc(item.email || item), esc(item.date || "-"), statusPill(item.status || "Active"), `<button class="admin-btn danger" onclick="deleteSubscriber('${esc(item.id || item.email || item)}')">Delete</button>`]);
  adminTable("Subscribers", ["S.N.", "Email", "Date", "Status", "Action"], rows, "subscribers");
}

function adminNotificationsReport() {
  const history = db.notificationHistory?.length ? db.notificationHistory : db.notifications || [];
  const rows = history.map(n => [esc(n.date), esc(n.channel || "app"), esc(n.to), esc(n.subject), esc(n.msg), statusPill(n.status || (n.read ? "Read" : "Unread"))]);
  adminTable("Notification History", ["Date", "Channel", "Sent To", "Subject", "Message", "Status"], rows, "notification-history");
}

async function deleteSubscriber(id) {
  if (!confirm("Delete this subscriber?")) return;
  try {
    await API.delete(`/api/admin/subscribers/${encodeURIComponent(id)}`);
    await loadState();
    toast("Subscriber deleted.", "Admin");
    render();
  } catch (err) {
    toast(err.message, "Error");
  }
}

function adminAudit(title = "Audit Logs", active = "audit") {
  const rows = (db.auditLogs || []).map(log => [esc(log.date), esc(log.actor), esc(log.action), esc(log.entity), esc(JSON.stringify(log.detail || {}))]);
  adminTable(title, ["Date", "Actor", "Action", "Entity", "Detail"], rows, active);
}

function filterVisibleTable(inputId) {
  const term = String(document.querySelector(`#${inputId}`)?.value || "").trim().toLowerCase();
  const rows = Array.from(document.querySelectorAll(".table-wrap tbody tr"));
  let visible = 0;
  rows.forEach(row => {
    const match = !term || row.textContent.toLowerCase().includes(term);
    row.style.display = match ? "" : "none";
    if (match) visible += 1;
  });
  toast(`${visible} row${visible === 1 ? "" : "s"} found.`, "Search");
}

function clearVisibleTableFilter(inputId) {
  const input = document.querySelector(`#${inputId}`);
  if (input) input.value = "";
  document.querySelectorAll(".table-wrap tbody tr").forEach(row => row.style.display = "");
}

async function adminAction(url, payload, ok = "Saved.") {
  try {
    await API.post(url, payload);
    await loadState();
    toast(ok, "Admin");
    render();
  } catch (err) {
    toast(err.message, "Error");
  }
}

function showAdminModal(title, body, onSubmit) {
  document.querySelector(".admin-modal-backdrop")?.remove();
  document.body.insertAdjacentHTML("beforeend", `<div class="admin-modal-backdrop"><form class="admin-modal" id="adminModalForm">
    <div class="admin-modal-head"><b>${esc(title)}</b><button type="button" onclick="closeAdminModal()">x</button></div>
    <div class="admin-modal-body">${body}</div>
    <div class="admin-actions"><button type="button" class="admin-btn" onclick="closeAdminModal()">Cancel</button><button class="admin-btn fill">Save</button></div>
  </form></div>`);
  $("#adminModalForm").onsubmit = async e => {
    e.preventDefault();
    try {
      await onSubmit();
      closeAdminModal();
    } catch (err) {
      toast(err.message, "Error");
    }
  };
}

function closeAdminModal() {
  document.querySelector(".admin-modal-backdrop")?.remove();
}

async function markNotification(id) {
  try {
    await API.post(`/api/notifications/${id}`, {});
    await loadState();
    render();
  } catch (err) {
    toast(err.message, "Error");
  }
}

function addCoin() {
  showAdminModal("Add Crypto Currency", `<div class="admin-form-3"><label>Symbol<input id="coinSymbol" class="plain-input light-input" required placeholder="BTC"></label><label>Name<input id="coinName" class="plain-input light-input" required placeholder="Bitcoin"></label><label>Icon Text<input id="coinIcon" class="plain-input light-input" maxlength="3" value="B"></label></div><label>Color<input id="coinColor" class="plain-input light-input" type="color" value="#149cff"></label>`, async () => {
    await adminAction("/api/admin/coins", { symbol: $("#coinSymbol").value, name: $("#coinName").value, color: $("#coinColor").value, icon: $("#coinIcon").value }, "Coin added.");
  });
}

function editCoin(symbol) {
  const coin = db.coins.find(c => c[0] === symbol);
  if (!coin) return;
  showAdminModal(`Edit ${symbol}`, `<div class="admin-form-3"><label>Name<input id="coinName" class="plain-input light-input" required value="${esc(coin[1])}"></label><label>Icon Text<input id="coinIcon" class="plain-input light-input" maxlength="3" value="${esc(coin[3])}"></label><label>Color<input id="coinColor" class="plain-input light-input" type="color" value="${esc(coin[2])}"></label></div>`, async () => {
    await adminAction(`/api/admin/coins/${encodeURIComponent(symbol)}`, { name: $("#coinName").value, icon: $("#coinIcon").value, color: $("#coinColor").value }, "Coin updated.");
  });
}

function toggleCoin(symbol, action) {
  adminAction(`/api/admin/coins/${encodeURIComponent(symbol)}`, { action }, "Coin status updated.");
}

function deleteCoin(symbol) {
  if (confirm(`Delete ${symbol}?`)) adminAction(`/api/admin/coins/${encodeURIComponent(symbol)}`, { action: "delete" }, "Coin deleted.");
}

function addDuration() {
  showAdminModal("Add Trade Time", `<div class="admin-form-3"><label>Seconds<input id="durationSeconds" class="plain-input light-input" type="number" min="10" required value="180"></label><label>Label<input id="durationLabel" class="plain-input light-input" required value="3 minutes"></label><label>Unit<input class="plain-input light-input" readonly value="Server timer"></label></div>`, async () => {
    await adminAction("/api/admin/trade-durations", { label: $("#durationLabel").value, seconds: Number($("#durationSeconds").value) }, "Trade time added.");
  });
}

function editDuration(index) {
  const item = db.tradeDurations[index];
  if (!item) return;
  showAdminModal("Edit Trade Time", `<div class="admin-form-3"><label>Seconds<input id="durationSeconds" class="plain-input light-input" type="number" min="10" required value="${Number(item.seconds)}"></label><label>Label<input id="durationLabel" class="plain-input light-input" required value="${esc(item.label)}"></label><label>Unit<input class="plain-input light-input" readonly value="Server timer"></label></div>`, async () => {
    await adminAction(`/api/admin/trade-durations/${index}`, { label: $("#durationLabel").value, seconds: Number($("#durationSeconds").value) }, "Trade time updated.");
  });
}

function deleteDuration(index) {
  if (confirm("Delete this trade time?")) adminAction(`/api/admin/trade-durations/${index}`, { action: "delete" }, "Trade time deleted.");
}

function addSignal() {
  go("/admin/signals/new");
}

function editSignal(id) {
  go(`/admin/signals/edit/${id}`);
}

function deleteSignal(id) {
  if (confirm("Delete this signal?")) adminAction(`/api/admin/signals/${id}`, { action: "delete" }, "Signal deleted.");
}

function editUser(key) {
  const user = [{ key: db.user.id, name: db.user.name, email: db.user.email }, ...db.users.map(u => ({ key: u[1], name: u[0], email: u[2], country: u[3] }))].find(u => u.key === key);
  if (!user) return;
  showAdminModal("Edit User", `<div class="admin-form-3"><label>Name<input id="userName" class="plain-input light-input" required value="${esc(user.name)}"></label><label>Email<input id="userEmail" class="plain-input light-input" type="email" value="${esc(user.email || "")}"></label><label>Country<input id="userCountry" class="plain-input light-input" value="${esc(user.country || "PK")}"></label></div>`, async () => {
    await adminAction(`/api/admin/users/${encodeURIComponent(key)}`, { name: $("#userName").value, email: $("#userEmail").value, country: $("#userCountry").value }, "User updated.");
  });
}

function toggleUser(key, action) {
  adminAction(`/api/admin/users/${encodeURIComponent(key)}`, { action }, "User status updated.");
}

function deleteUser(key) {
  if (confirm("Delete this user?")) adminAction(`/api/admin/users/${encodeURIComponent(key)}`, { action: "delete" }, "User deleted.");
}

function addGateway(type) {
  showAdminModal(`Add ${type === "automatic" ? "Automatic" : "Manual"} Gateway`, `<div class="admin-form-3"><label>Name<input id="gatewayName" class="plain-input light-input" required placeholder="EasyPaisa"></label><label>Type<input class="plain-input light-input" readonly value="${esc(type)}"></label><label>Currency<input class="plain-input light-input" readonly value="PKR only"></label></div>`, async () => {
    await adminAction("/api/admin/gateways", { name: $("#gatewayName").value, type }, "Gateway added.");
  });
}

function editGateway(name) {
  showAdminModal("Edit Gateway", `<div class="admin-form-3"><label>Name<input id="gatewayName" class="plain-input light-input" required value="${esc(name)}"></label><label>Currency<input class="plain-input light-input" readonly value="PKR"></label><label>Status<input class="plain-input light-input" readonly value="${esc(db.gatewayStatuses?.[name] || "Enabled")}"></label></div>`, async () => {
    await adminAction(`/api/admin/gateways/${encodeURIComponent(name)}`, { newName: $("#gatewayName").value }, "Gateway updated.");
  });
}

function toggleGateway(name, action) {
  adminAction(`/api/admin/gateways/${encodeURIComponent(name)}`, { action }, "Gateway status updated.");
}

function deleteGateway(name) {
  if (confirm(`Delete gateway ${name}?`)) adminAction(`/api/admin/gateways/${encodeURIComponent(name)}`, { action: "delete" }, "Gateway deleted.");
}

function replyTicket(id) {
  showAdminModal("Reply Ticket", `<label>Reply Message<textarea id="ticketReply" class="light-input" required placeholder="Write admin reply..."></textarea></label><label>Status<select id="ticketStatus" class="plain-input light-input"><option>Answered</option><option>Open</option><option>Closed</option></select></label>`, async () => {
    await adminAction(`/api/admin/tickets/${id}`, { reply: $("#ticketReply").value, status: $("#ticketStatus").value }, "Ticket replied.");
  });
}

function closeTicket(id) {
  adminAction(`/api/admin/tickets/${id}`, { action: "close" }, "Ticket closed.");
}

function deleteTicket(id) {
  if (confirm("Delete this ticket?")) adminAction(`/api/admin/tickets/${id}`, { action: "delete" }, "Ticket deleted.");
}

function drawCharts() {
  const sizeCanvas = canvas => {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(360, Math.floor(rect.width || 760));
    const height = Math.max(220, Math.floor(rect.height || Number(canvas.getAttribute("height")) || 260));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return { ctx, width, height };
  };
  const lastDays = count => Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.now() - (count - 1 - index) * 86400000);
    return { key: date.toISOString().slice(0, 10), label: date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) };
  });
  const byDay = (items, days, field = "amount") => {
    const map = Object.fromEntries(days.map(day => [day.key, 0]));
    (items || []).forEach(item => {
      const key = String(item.date || item.createdAt || "").slice(0, 10);
      if (map[key] !== undefined) map[key] += Number(item[field] || 0);
    });
    return days.map(day => map[day.key]);
  };
  const days = lastDays(14);
  const deposits = byDay((db.deposits || []).filter(item => ["Approved", "Successful"].includes(item.status)), days);
  const withdrawals = byDay((db.withdrawals || []).filter(item => item.status === "Approved"), days);
  const transactionsPlus = byDay((db.transactions || []).filter(item => Number(item.amount || 0) >= 0), days);
  const transactionsMinus = byDay((db.transactions || []).filter(item => Number(item.amount || 0) < 0).map(item => ({ ...item, amount: Math.abs(Number(item.amount || 0)) })), days);

  const barCanvas = sizeCanvas($("#dashBar"));
  if (barCanvas) {
    const { ctx, width, height } = barCanvas;
    const pad = { left: 58, right: 20, top: 28, bottom: 46 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const max = Math.max(1000, ...deposits, ...withdrawals);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#edf0f6";
    ctx.fillStyle = "#74819b";
    ctx.font = "11px Trebuchet MS, Arial";
    for (let i = 0; i <= 4; i += 1) {
      const y = pad.top + (plotH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      ctx.fillText(Math.round(max - (max / 4) * i).toLocaleString("en-PK"), 6, y + 4);
    }
    const groupW = plotW / days.length;
    days.forEach((day, index) => {
      const x = pad.left + index * groupW + groupW * .25;
      const depH = (deposits[index] / max) * plotH;
      const wdH = (withdrawals[index] / max) * plotH;
      ctx.fillStyle = "#0fcf82";
      ctx.fillRect(x, pad.top + plotH - depH, Math.max(5, groupW * .16), depH);
      ctx.fillStyle = "#e3262f";
      ctx.fillRect(x + Math.max(8, groupW * .18), pad.top + plotH - wdH, Math.max(5, groupW * .16), wdH);
      if (index % 2 === 0) {
        ctx.save();
        ctx.translate(pad.left + index * groupW + groupW * .45, height - 12);
        ctx.rotate(-0.08);
        ctx.fillStyle = "#8190a8";
        ctx.fillText(day.label, -18, 0);
        ctx.restore();
      }
    });
    ctx.fillStyle = "#0fcf82";
    ctx.fillRect(width / 2 - 70, height - 25, 8, 8);
    ctx.fillStyle = "#74819b";
    ctx.fillText("Deposited", width / 2 - 56, height - 17);
    ctx.fillStyle = "#e3262f";
    ctx.fillRect(width / 2 + 24, height - 25, 8, 8);
    ctx.fillStyle = "#74819b";
    ctx.fillText("Withdrawn", width / 2 + 38, height - 17);
  }

  const lineCanvas = sizeCanvas($("#dashLine"));
  if (lineCanvas) {
    const { ctx, width, height } = lineCanvas;
    const pad = { left: 58, right: 24, top: 28, bottom: 46 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const max = Math.max(1000, ...transactionsPlus, ...transactionsMinus);
    const drawSeries = (values, color, fill) => {
      const points = values.map((value, index) => ({
        x: pad.left + (plotW / Math.max(1, values.length - 1)) * index,
        y: pad.top + plotH - (value / max) * plotH
      }));
      const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
      gradient.addColorStop(0, fill);
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.beginPath();
      points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.lineTo(points.at(-1).x, pad.top + plotH);
      ctx.lineTo(points[0].x, pad.top + plotH);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.beginPath();
      points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.stroke();
    };
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#edf0f6";
    ctx.fillStyle = "#74819b";
    ctx.font = "11px Trebuchet MS, Arial";
    for (let i = 0; i <= 4; i += 1) {
      const y = pad.top + (plotH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      ctx.fillText(Math.round(max - (max / 4) * i).toLocaleString("en-PK"), 6, y + 4);
    }
    drawSeries(transactionsPlus, "#00dfa2", "rgba(0,223,162,.30)");
    drawSeries(transactionsMinus, "#ff6d72", "rgba(255,109,114,.16)");
    days.forEach((day, index) => {
      if (index % 2 === 0) ctx.fillText(day.label, pad.left + (plotW / Math.max(1, days.length - 1)) * index - 16, height - 14);
    });
  }

  const drawDonut = (id, values, colors) => {
    const canvas = sizeCanvas($("#" + id));
    if (!canvas) return;
    const { ctx, width, height } = canvas;
    const cx = width / 2;
    const cy = height * .58;
    const radius = Math.min(width, height) * .37;
    const line = Math.max(42, radius * .42);
    const total = values.reduce((sum, value) => sum + Number(value || 0), 0) || 1;
    let angle = -Math.PI / 2;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    values.forEach((value, index) => {
      const slice = (Number(value || 0) / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, angle, angle + slice);
      ctx.strokeStyle = colors[index % colors.length];
      ctx.lineWidth = line;
      ctx.lineCap = "butt";
      ctx.stroke();
      angle += slice;
    });
    ctx.beginPath();
    ctx.arc(cx, cy, radius - line / 2, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
  };
  const users = [{ country: db.user.country || "PK" }, ...db.users.map(user => ({ country: user[3] || "PK" }))];
  drawDonut("browserDonut", [Math.max(1, users.length - 2), 1], ["#ff6d72", "#6955e8"]);
  drawDonut("osDonut", [Math.max(1, users.length - 3), 2, 1], ["#ff6d72", "#6955e8", "#ffa629"]);
  drawDonut("countryDonut", [Math.max(1, users.filter(user => user.country === "PK").length), Math.max(1, users.filter(user => user.country !== "PK").length)], ["#ff6d72", "#6955e8"]);
}

async function loadState() {
  db = await API.getState();
  initSocket();
}

async function render() {
  clearInterval(refreshTimer);
  clearInterval(countdownTimer);
  if (!db) await loadState();
  applyCustomCss();
  const r = route();
  if (r === "/home") return dashboard();
  if (r === "/contact") return publicPage("contact");
  if (r === "/terms-of-use") return publicPage("termsOfUse");
  if (r === "/terms-of-service") return publicPage("termsOfService");
  if (r === "/privacy-policy") return publicPage("privacyPolicy");
  if (r === "/risk-disclaimer") return publicPage("riskDisclaimer");
  if (r === "/login") return auth("login");
  if (r === "/register") return auth("register");
  if (r === "/reset") return auth("reset");
  if (r === "/admin/login") return adminLogin();
  if (r.startsWith("/admin") && !adminToken()) {
    go("/admin/login");
    return;
  }
  if (r === "/dashboard") return dashboard();
  if (r === "/practice") return practice();
  if (r.startsWith("/trade/")) return trade(r.split("/").pop());
  if (r === "/deposit") return deposit();
  if (r === "/withdraw") return withdrawPage();
  if (r === "/kyc") return kyc();
  if (r === "/profile") return profilePage();
  if (r === "/ticket") return supportTicketPage();
  if (r === "/password") return passwordPage();
  if (r === "/2fa") return twoFactorPage();
  if (r === "/notifications") return notificationsPage();
  if (r === "/trade-log") return logPage("Practice Trade Log", ["S.L", "Crypto", "Amount", "Trade Time", "Up/Down", "Result", "Status", "Date"], db.trades.map((t, i) => [i + 1, esc(t.crypto), pkr(t.amount), `${t.seconds}s`, esc(t.direction), esc(t.result || "Waiting"), statusPill(t.status), esc(t.createdAt)]));
  if (r === "/deposit-history") return logPage("Deposit History", ["Gateway | Transaction", "Initiated", "Amount", "Conversion", "Status", "Details"], db.deposits.map(d => [esc(d.gateway), esc(d.date), pkr(d.amount), "PKR1.00 PKR = 1.00 PKR", statusPill(d.status), "Details"]));
  if (r === "/referral") return logPage("Referral Log", ["S.N.", "Name", "Username", "Date"], (db.referrals || []).map((ref, i) => [i + 1, esc(ref.name || ref.user || "-"), esc(ref.username || ref.code || "-"), esc(ref.date || "-")]));
  if (r === "/transactions") return logPage("Transactions", ["Trx", "Transacted", "Amount", "Post Balance", "Detail"], (db.transactions || []).filter(t => !t.userId || t.userId === db.user.id).map(t => [esc(t.id), esc(t.date), pkr(t.amount), pkr(t.balanceAfter), esc(t.remark || t.type)]));
  if (r === "/admin" || r === "/admin/dashboard") return adminDashboard();
  if (r.startsWith("/admin/search/")) return adminSearchPage(r.replace("/admin/search/", ""));
  if (r === "/admin/crypto") return adminCrypto();
  if (r === "/admin/settings") return adminSettings();
  if (r === "/admin/signals/new") return adminSignalForm();
  if (r.startsWith("/admin/signals/edit/")) return adminSignalForm(r.split("/").pop());
  if (r === "/admin/signals") return adminSignals();
  if (r === "/admin/trades") return adminTrades("", "trades-all", "Trade Log");
  if (r === "/admin/trades/winning") return adminTrades("Win", "trades-winning", "Win Trade Log");
  if (r === "/admin/trades/losing") return adminTrades("Loss", "trades-losing", "Loss Trade Log");
  if (r === "/admin/trades/draw") return adminTrades("Draw", "trades-draw", "Draw Trade Log");
  if (r === "/admin/practice-trades") return adminTrades("", "practice-all", "Practice Trade Log");
  if (r === "/admin/practice-trades/winning") return adminTrades("Win", "practice-winning", "Practice Win Trade Log");
  if (r === "/admin/practice-trades/losing") return adminTrades("Loss", "practice-losing", "Practice Loss Trade Log");
  if (r === "/admin/practice-trades/draw") return adminTrades("Draw", "practice-draw", "Practice Draw Trade Log");
  if (r === "/admin/users" || r === "/admin/users/active") return adminUsers("Active Users", "active", "users-active");
  if (r === "/admin/users/banned") return adminUsers("Banned Users", "banned", "users-banned");
  if (r === "/admin/users/email-unverified") return adminUsers("Email Unverified Users", "email-unverified", "users-email");
  if (r === "/admin/users/mobile-unverified") return adminUsers("Mobile Unverified Users", "mobile-unverified", "users-mobile");
  if (r === "/admin/users/kyc-unverified") return adminUsers("KYC Unverified Users", "kyc-unverified", "users-kyc");
  if (r === "/admin/users/kyc-pending") return adminKyc("Pending", "KYC Pending Users", "users-kyc-pending");
  if (r === "/admin/users/with-balance") return adminUsers("Users With Balance", "balance", "users-balance");
  if (r === "/admin/users/all") return adminUsers("All Users", "all", "users-all");
  if (r === "/admin/notify") return adminNotify();
  if (r === "/admin/deposits" || r === "/admin/deposits/all") return adminDeposits("All Deposits", "", "deposits-all");
  if (r === "/admin/deposits/pending") return adminDeposits("Pending Deposits", "Pending", "deposits-pending");
  if (r === "/admin/deposits/approved") return adminDeposits("Approved Deposits", "Approved", "deposits-approved");
  if (r === "/admin/deposits/successful") return adminDeposits("Successful Deposits", "Successful", "deposits-successful");
  if (r === "/admin/deposits/rejected") return adminDeposits("Rejected Deposits", "Rejected", "deposits-rejected");
  if (r === "/admin/deposits/initiated") return adminDeposits("Initiated Deposits", "Initiated", "deposits-initiated");
  if (r === "/admin/withdrawals" || r === "/admin/withdrawals/all") return adminWithdrawals("All Withdrawals", "", "withdrawals-all");
  if (r === "/admin/withdrawals/pending") return adminWithdrawals("Pending Withdrawals", "Pending", "withdrawals-pending");
  if (r === "/admin/withdrawals/approved") return adminWithdrawals("Approved Withdrawals", "Approved", "withdrawals-approved");
  if (r === "/admin/withdrawals/rejected") return adminWithdrawals("Rejected Withdrawals", "Rejected", "withdrawals-rejected");
  if (r === "/admin/kyc") return adminKyc();
  if (r === "/admin/transactions") return adminTransactions();
  if (r === "/admin/adjust") return adminAdjustments();
  if (r === "/admin/tickets") return adminTickets("Support Tickets", "", "tickets-all");
  if (r === "/admin/tickets/pending") return adminTickets("Pending Tickets", "Open", "tickets-pending");
  if (r === "/admin/tickets/closed") return adminTickets("Closed Tickets", "Closed", "tickets-closed");
  if (r === "/admin/tickets/answered") return adminTickets("Answered Tickets", "Answered", "tickets-answered");
  if (r === "/admin/chat") return adminChat();
  if (r === "/admin/profile") return adminProfilePage();
  if (r === "/admin/password") return adminPasswordPage();
  if (r === "/admin/system") return adminSystem();
  if (r === "/admin/extra/application" || r === "/admin/system/info") return adminExtra("app");
  if (r === "/admin/extra/server" || r === "/admin/system/server-info") return adminExtra("server");
  if (r === "/admin/extra/cache" || r === "/admin/system/optimize") return adminExtra("cache");
  if (r === "/admin/extra/update" || r === "/admin/system/system-update") return adminExtra("update");
  if (r === "/admin/extra-app") return adminExtra("app");
  if (r === "/admin/extra-server") return adminExtra("server");
  if (r === "/admin/extra-cache") return adminExtra("cache");
  if (r === "/admin/extra-update") return adminExtra("update");
  if (r.startsWith("/admin/system/")) return adminSystemSection(r.replace("/admin/system/", ""));
  if (r === "/admin/gateways") return adminGateways();
  if (r === "/admin/subscribers") return adminSubscribers();
  if (r === "/admin/notifications-report") return adminNotificationsReport();
  if (r === "/admin/login-history") return adminAudit("Login History", "login-history");
  if (r === "/admin/audit") return adminAudit();
  return dashboard();
}

function showLoadError(err) {
  if (/admin login required/i.test(err.message || "")) {
    localStorage.removeItem("tv_admin_token");
    localStorage.removeItem("tv_admin_role");
    go("/admin/login");
    return render();
  }
  app.innerHTML = `<main class="auth-page"><div class="auth-card"><h2>Backend not running</h2><p>${esc(err.message)}</p><p>Start the backend with: node server.js</p></div></main>`;
}

window.addEventListener("hashchange", async () => {
  try {
    await loadState();
    render();
  } catch (err) {
    showLoadError(err);
  }
});
window.setTradeResult = setTradeResult;
window.setDepositStatus = setDepositStatus;
window.setWithdrawalStatus = setWithdrawalStatus;
window.setKycStatus = setKycStatus;
window.startTrade = startTrade;
window.go = go;
window.logoutUser = logoutUser;
window.logoutAdmin = logoutAdmin;
Object.assign(window, {
  addCoin, editCoin, toggleCoin, deleteCoin,
  addDuration, editDuration, deleteDuration,
  addSignal, editSignal, deleteSignal,
  editUser, toggleUser, deleteUser,
  addGateway, editGateway, toggleGateway, deleteGateway,
  replyTicket, closeTicket, deleteTicket,
  clearSystemCache, checkSystemUpdate,
  newsletterKey, subscribeNewsletter, copyReferral,
  adminGlobalSearchKey, filterSettingsCards,
  selectNotifyChannel, deleteSubscriber
});
window.filterVisibleTable = filterVisibleTable;
window.clearVisibleTableFilter = clearVisibleTableFilter;
window.closeAdminModal = closeAdminModal;
window.fillCaptcha = fillCaptcha;
window.markNotification = markNotification;
window.toggleAdminProfileMenu = toggleAdminProfileMenu;
window.closeAdminProfileMenu = closeAdminProfileMenu;

document.addEventListener("click", event => {
  if (!event.target?.closest?.(".admin-profile")) closeAdminProfileMenu();
});

loadState().then(render).catch(showLoadError);

