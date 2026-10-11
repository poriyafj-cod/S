"""
═══════════════════════════════════════════════════════════
  CHAAM RetailOS — Excel Connector (v2)
  دقیقاً مطابق فایل واقعی CHAAM_system.xlsx
═══════════════════════════════════════════════════════════
نصب:
    pip install flask flask-cors openpyxl

اجرا:
    python connector.py

دسترسی:
    ویندوز : http://localhost:8787
    موبایل : http://[IP-کامپیوتر]:8787
═══════════════════════════════════════════════════════════
"""

from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
from datetime import datetime
from functools import wraps
import openpyxl
from openpyxl.utils import get_column_letter
import os, shutil, threading, time, json, hmac, hashlib, secrets, base64

# ═══════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
EXCEL_FILE = os.path.join(BASE_DIR, "CHAAM_system.xlsx")   # ← فایل اصلی خودتان
BACKUP_DIR = os.path.join(BASE_DIR, "backups")
AUTH_FILE  = os.path.join(BASE_DIR, "auth_users.json")     # فقط هش رمزها — نه خود رمز
SECRET_FILE= os.path.join(BASE_DIR, ".auth_secret")
PORT       = 8787

os.makedirs(BACKUP_DIR, exist_ok=True)
_lock = threading.Lock()

app = Flask(__name__, static_folder=BASE_DIR)
CORS(app)

if not os.path.exists(EXCEL_FILE):
    raise SystemExit(
        f"\n❌ فایل {EXCEL_FILE} پیدا نشد.\n"
        f"   فایل CHAAM_system.xlsx را در همین پوشه کنار connector.py بگذارید.\n"
    )

# ═══════════════════════════════════════════════
# SHEET / COLUMN MAP — exactly as in CHAAM_system.xlsx
# ═══════════════════════════════════════════════
SH_LOG   = "لاگ_فاکتور"        # invoice line-item log
SH_CAT   = "کاتالوگ_محصولات"   # product catalog
SH_PER   = "اطلاعات_پرسنل"     # personnel
SH_SET   = "تنظیمات_سیستم"     # settings
SH_KPI   = "KPI_روزانه"        # daily KPI
SH_ACC   = "حسابداری"          # accounting

# لاگ_فاکتور: data rows 3..1974, headers row 2, columns A..U (1..21) are input,
# columns V..AD (22..30) are PRE-FILLED FORMULAS per row — never touch them.
LOG_DATA_FIRST_ROW = 3
LOG_DATA_LAST_ROW  = 1622   # به‌صورت خودکار از روی آخرین ردیف فرمول‌دار تنظیم می‌شود (پایین‌تر)
LOG_COLS = {
    "invoiceNo":1, "date":2, "personnelId":3, "personnelName":4, "shift":5,
    "paymentMethod":6, "customerType":7, "channel":8,
    "sku":9, "productInput":10, "productName":11,
    "qty":12, "unitPrice":13, "discount":14, "lineTotal":15,
    "customerFirst":16, "customerLast":17, "customerPhone":18,
    "birthDay":19, "birthMonth":20, "notes":21,
}

# کاتالوگ_محصولات: headers row 3, data rows 4..303
CAT_FIRST_ROW = 4
CAT_LAST_ROW  = 303
CAT_COLS = {
    "sku":1, "barcode":2, "name":3, "category":4, "fabric":5, "season":6,
    "cost":7, "price":8, "openStock":9, "sold":10, "stock":11, "status":12,
}

# اطلاعات_پرسنل: headers row 3, data rows 4..63
PER_FIRST_ROW = 4
PER_LAST_ROW  = 63
PER_COLS = {
    "id":1, "first":2, "last":3, "full":4, "role":5, "shift":6,
    "hire":7, "salary":8, "commission":9, "status":10, "phone":11,
}

# تنظیمات_سیستم: key/value pairs at fixed rows, column C = value
SETTINGS_MAP = {
    "monthlyTarget":        4,   # C4
    "workingDays":          5,   # C5
    "defaultCommission":    6,   # C6
    "stockAlertMin":        7,   # C7
    "reportYear":          13,   # C13
    "minUPT":              14,   # C14
    "minATV":              15,   # C15
    "repeatTarget":        16,   # C16
    "conversionTarget":    17,   # C17
}

# ═══════════════════════════════════════════════
# LOAD / SAVE
# ═══════════════════════════════════════════════

FA_MONTHS = ["فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور",
             "مهر","آبان","آذر","دی","بهمن","اسفند"]

def parse_fa_date(s):
    """'1405/06/25' -> (1405, 6, 25) یا None"""
    try:
        y, m, d = str(s).strip().split("/")
        return int(y), int(m), int(d)
    except Exception:
        return None

def load_wb():
    """برای WRITE — فرمول‌ها دست‌نخورده باقی می‌مانند"""
    return openpyxl.load_workbook(EXCEL_FILE)

# ── کش کوتاه‌مدت برای خواندن‌های همزمان (چند endpoint در یک لحظه) ──
_read_cache = {"wb": None, "ts": 0.0}
_CACHE_TTL = 3.0  # ثانیه

def load_wb_values():
    """برای READ — مقادیر کش‌شده فرمول‌ها (آخرین محاسبه Excel).
    برای جلوگیری از خواندن کامل فایل در هر فراخوانی، ۳ ثانیه کش می‌شود
    و بلافاصله بعد از هر ثبت (save_wb) باطل می‌شود."""
    now = time.time()
    if _read_cache["wb"] is not None and (now - _read_cache["ts"]) < _CACHE_TTL:
        return _read_cache["wb"]
    wb = openpyxl.load_workbook(EXCEL_FILE, data_only=True)
    _read_cache["wb"] = wb
    _read_cache["ts"] = now
    return wb

def invalidate_read_cache():
    _read_cache["wb"] = None
    _read_cache["ts"] = 0.0

def save_wb(wb):
    today = datetime.now().strftime("%Y%m%d")
    bk = os.path.join(BACKUP_DIR, f"CHAAM_{today}.xlsx")
    if not os.path.exists(bk):
        try: shutil.copy2(EXCEL_FILE, bk)
        except: pass
    # force Excel to recalculate all formulas when reopened
    try:
        wb.calculation.fullCalcOnLoad = True
    except Exception:
        pass
    wb.save(EXCEL_FILE)
    invalidate_read_cache()

def _detect_log_last_row():
    """آخرین ردیفی که فرمول‌های V..AD را دارد — نوشتن بعد از آن، فاکتور را از گزارش‌ها حذف می‌کند"""
    try:
        ws = openpyxl.load_workbook(EXCEL_FILE)[SH_LOG]
        last = LOG_DATA_FIRST_ROW
        for r in range(LOG_DATA_FIRST_ROW, ws.max_row + 1):
            v = ws.cell(r, 22).value
            if isinstance(v, str) and v.startswith("="):
                last = r
        return last
    except Exception:
        return LOG_DATA_LAST_ROW

def find_next_empty_log_row(ws):
    """اولین ردیف خالی در بازه از پیش آماده‌شده (فرمول‌های V..AD دارد)"""
    for r in range(LOG_DATA_FIRST_ROW, LOG_DATA_LAST_ROW + 1):
        if ws.cell(r, 1).value in (None, ""):
            return r
    return None  # ظرفیت تمام شده

def cat_rows(ws):
    for r in range(CAT_FIRST_ROW, CAT_LAST_ROW + 1):
        name = ws.cell(r, CAT_COLS["name"]).value
        if name not in (None, ""):
            yield r

def sku_of(row):
    """SKU مطابق فرمول اکسل: ="SKU-"&TEXT(ROW()-3,"0000") — مستقل از کش"""
    return f"SKU-{row - CAT_FIRST_ROW + 1:04d}"

def per_rows(ws):
    for r in range(PER_FIRST_ROW, PER_LAST_ROW + 1):
        pid = ws.cell(r, PER_COLS["id"]).value
        first = ws.cell(r, PER_COLS["first"]).value
        # ردیف‌های خالی قالب (فقط کد پرسنل بدون نام) نادیده گرفته می‌شوند
        if pid not in (None, "") and first not in (None, ""):
            yield r

def log_rows(ws):
    for r in range(LOG_DATA_FIRST_ROW, LOG_DATA_LAST_ROW + 1):
        no = ws.cell(r, LOG_COLS["invoiceNo"]).value
        if no not in (None, ""):
            yield r

def get_settings():
    ws = load_wb_values()[SH_SET]
    out = {}
    for k, row in SETTINGS_MAP.items():
        v = ws.cell(row, 3).value
        if isinstance(v, str) and v.startswith("="):
            v = None
        out[k] = v
    return out

# ═══════════════════════════════════════════════
# AUTH — ورود با رمز، سه نقش، توکن امضاشده
# ═══════════════════════════════════════════════
# store  = فروشگاه     : صندوق، فاکتور، بستن روز — بدون سود/بهای تمام‌شده/OKR/خروجی
# brand  = مالک برند   : همه گزارش‌ها + سود + OKR + خروجی اکسل
# system = مالک سیستم  : همه چیز + ثبت KPI + مدیریت رمزها
ROLE_RANK = {"store": 1, "brand": 2, "system": 3}
ROLE_FA   = {"store": "فروشگاه", "brand": "مالک برند", "system": "مالک سیستم"}
TOKEN_TTL = {"store": 14*3600, "brand": 7*86400, "system": 7*86400}

def _secret():
    if not os.path.exists(SECRET_FILE):
        with open(SECRET_FILE, "w") as f: f.write(secrets.token_hex(32))
    with open(SECRET_FILE) as f: return f.read().strip().encode()
SECRET = _secret()

def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 200_000).hex()
    return f"pbkdf2${salt}${h}"

def check_pw(pw, stored):
    try:
        _, salt, h = stored.split("$")
        return hmac.compare_digest(hash_pw(pw, salt).split("$")[2], h)
    except Exception:
        return False

def load_users():
    if not os.path.exists(AUTH_FILE):
        return []
    with open(AUTH_FILE, encoding="utf-8") as f:
        return json.load(f).get("users", [])

def _b64(b): return base64.urlsafe_b64encode(b).decode().rstrip("=")
def _unb64(s): return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

def make_token(uid, role):
    body = _b64(json.dumps({"u": uid, "r": role, "exp": int(time.time()) + TOKEN_TTL[role]}).encode())
    sig = _b64(hmac.new(SECRET, body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"

def read_token(tok):
    try:
        body, sig = tok.split(".")
        good = _b64(hmac.new(SECRET, body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, good): return None
        d = json.loads(_unb64(body))
        if d["exp"] < time.time(): return None
        u = next((x for x in load_users() if x["id"] == d["u"] and x.get("active", True)), None)
        if not u or u["role"] != d["r"]: return None     # رمز غیرفعال/حذف شده → توکن باطل
        return {"id": u["id"], "role": u["role"], "label": u.get("label", "")}
    except Exception:
        return None

_fails = {}   # ip -> [count, until]
def _blocked(ip):
    c, until = _fails.get(ip, [0, 0])
    return until > time.time()
def _fail(ip):
    c, until = _fails.get(ip, [0, 0])
    c += 1
    _fails[ip] = [c, time.time() + 300] if c >= 5 else [c, 0]
    if c >= 5: _fails[ip] = [0, time.time() + 300]

def current_user():
    hdr = request.headers.get("Authorization", "")
    tok = hdr[7:].strip() if hdr.startswith("Bearer ") else (request.args.get("t") or "")
    return read_token(tok) if tok else None

def auth(min_role="store"):
    """هر endpoint حداقل نقش لازم را مشخص می‌کند — GET هم دیگر بدون رمز باز نیست"""
    if callable(min_role):            # @auth بدون آرگومان
        return auth("store")(min_role)
    def deco(f):
        @wraps(f)
        def wrapper(*a, **kw):
            u = current_user()
            if not u:
                return jsonify({"error": "unauthorized", "message": "ابتدا وارد شوید"}), 401
            if ROLE_RANK[u["role"]] < ROLE_RANK[min_role]:
                return jsonify({"error": "forbidden", "message": "دسترسی این نقش کافی نیست"}), 403
            request.user = u
            return f(*a, **kw)
        return wrapper
    return deco

def is_store():
    return getattr(request, "user", {}).get("role") == "store"

@app.route("/api/auth/login", methods=["POST"])
def login():
    ip = request.remote_addr or "?"
    if _blocked(ip):
        return jsonify({"success": False, "error": "به‌خاطر تلاش ناموفق زیاد، ۵ دقیقه صبر کنید"}), 429
    pw = str((request.json or {}).get("password", "")).strip()
    # تبدیل ارقام فارسی/عربی به انگلیسی
    pw = pw.translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"))
    for u in load_users():
        if u.get("active", True) and check_pw(pw, u["hash"]):
            _fails.pop(ip, None)
            return jsonify({"success": True, "token": make_token(u["id"], u["role"]),
                            "role": u["role"], "roleFa": ROLE_FA[u["role"]], "label": u.get("label", "")})
    _fail(ip)
    time.sleep(0.4)
    return jsonify({"success": False, "error": "رمز اشتباه است"}), 401

@app.route("/api/auth/me")
@auth
def me():
    u = request.user
    return jsonify({**u, "roleFa": ROLE_FA[u["role"]]})

@app.route("/api/auth/users")
@auth("system")
def list_users():
    return jsonify({"users": [{k: v for k, v in u.items() if k != "hash"} for u in load_users()]})

@app.route("/api/auth/users/<uid>/active", methods=["POST"])
@auth("system")
def set_user_active(uid):
    with _lock:
        with open(AUTH_FILE, encoding="utf-8") as f: data = json.load(f)
        hit = False
        for u in data["users"]:
            if u["id"] == uid:
                u["active"] = bool((request.json or {}).get("active", False)); hit = True
        if not hit: return jsonify({"success": False, "error": "یافت نشد"}), 404
        with open(AUTH_FILE, "w", encoding="utf-8") as f: json.dump(data, f, ensure_ascii=False, indent=1)
    return jsonify({"success": True})

# ═══════════════════════════════════════════════
# STATIC (serves the PWA)
# ═══════════════════════════════════════════════
@app.route("/")
def root():
    return send_from_directory(BASE_DIR, "index.html")

PUBLIC_FILES = {"index.html", "app.js", "sw.js", "manifest.json",
                "icon-192.png", "icon-512.png", "apple-touch-icon.png"}

@app.route("/<path:p>")
def static_files(p):
    if p.startswith("api/"):                       # مسیر API ناشناخته → 404 واقعی، نه صفحه اپ
        return jsonify({"error": "not_found", "path": "/" + p}), 404
    if p in PUBLIC_FILES:                          # اکسل، کد سرور، بکاپ‌ها و رمزها دیگر قابل دانلود نیستند
        return send_from_directory(BASE_DIR, p)
    return send_from_directory(BASE_DIR, "index.html")

# ═══════════════════════════════════════════════
# API
# ═══════════════════════════════════════════════
@app.route("/api/health")
def health():
    return jsonify({
        "status": "ok", "excel": os.path.exists(EXCEL_FILE),
        "file": os.path.basename(EXCEL_FILE),
        "version": "2.1.0-auth", "authUsers": len(load_users()), "time": datetime.now().isoformat(),
    })

@app.route("/api/products")
@auth
def products():
    q = (request.args.get("query") or "").strip().lower()
    only_stock = request.args.get("onlyInStock") == "true"
    wbv = load_wb_values()
    by_sku, _ = _price_map(wbv[SH_CAT], wbv[SH_LOG])
    lvl = int(get_settings().get("stockAlertMin") or 3)   # یک بار خارج از حلقه خوانده می‌شود
    out = []
    for sku, p in by_sku.items():
        if not p["name"]:
            continue
        status = "🔴 تمام" if p["stock"] <= 0 else "🟠 کم" if p["stock"] <= lvl else "🟢 OK"
        row = {
            "sku": sku, "name": p["name"], "category": p["category"],
            "unitCost": 0 if is_store() else p["cost"], "unitPrice": p["price"],
            "openStock": p["openStock"], "sold": p["sold"], "stock": p["stock"],
            "status": status,
        }
        if only_stock and row["stock"] <= 0:
            continue
        if q and not (q in row["name"].lower() or q in sku.lower() or q in row["category"].lower()):
            continue
        out.append(row)
    return jsonify({"products": out, "total": len(out)})

def _personnel_conversion(ws_kpi):
    """میانگین نرخ تبدیل هر پرسنل از KPI_روزانه"""
    agg = {}
    for r in range(5, 105):
        name = str(ws_kpi.cell(r, 3).value or "").strip()
        cv = ws_kpi.cell(r, 11).value
        if name and isinstance(cv, (int, float)):
            agg.setdefault(name, []).append(cv)
    return {name: sum(vals)/len(vals) for name, vals in agg.items()}

def _personnel_invoice_count(ws_log):
    """تعداد فاکتور یکتای هر پرسنل از لاگ_فاکتور"""
    agg = {}
    for r in log_rows(ws_log):
        name = str(ws_log.cell(r, LOG_COLS["personnelName"]).value or "").strip()
        no = str(ws_log.cell(r, 1).value)
        if name:
            agg.setdefault(name, set()).add(no)
    return {name: len(s) for name, s in agg.items()}

@app.route("/api/personnel")
@auth
def personnel():
    wbv = load_wb_values()
    ws = wbv[SH_PER]
    conv_map = _personnel_conversion(wbv[SH_KPI])
    inv_map  = _personnel_invoice_count(wbv[SH_LOG])
    out = []
    for r in per_rows(ws):
        status = str(ws.cell(r, PER_COLS["status"]).value or "")
        if request.args.get("active") == "true" and status != "فعال":
            continue
        first = str(ws.cell(r, PER_COLS["first"]).value or "").strip()
        last  = str(ws.cell(r, PER_COLS["last"]).value or "").strip()
        full  = (first + " " + last).strip()
        comm = ws.cell(r, PER_COLS["commission"]).value or 0
        raw_id = ws.cell(r, PER_COLS["id"]).value
        out.append({
            "id": str(raw_id) if raw_id is not None else "",
            "name": full,
            "role": str(ws.cell(r, PER_COLS["role"]).value or ""),
            "shift": str(ws.cell(r, PER_COLS["shift"]).value or ""),
            "commissionRate": float(comm) if isinstance(comm,(int,float)) else 0,
            "active": status == "فعال",
            "phone": str(ws.cell(r, PER_COLS["phone"]).value or ""),
            "conversionRate": conv_map.get(full, 0),
            "invoiceCount": inv_map.get(full, 0),
        })
    return jsonify({"personnel": out})

@app.route("/api/invoice/next")
@auth
def next_invoice():
    ws = load_wb_values()[SH_LOG]
    nums = []
    for r in log_rows(ws):
        s = str(ws.cell(r, 1).value or "")
        if s.startswith("INV-"):
            try: nums.append(int(s[4:]))
            except: pass
    n = (max(nums) + 1) if nums else 1
    return jsonify({"invoiceNo": f"INV-{n:04d}"})

def _sold_by_sku(ws_log):
    """جمع فروش هر SKU از لاگ_فاکتور — همیشه زنده و دقیق، مستقل از کش اکسل"""
    sold = {}
    for r in log_rows(ws_log):
        sku = str(ws_log.cell(r, LOG_COLS["sku"]).value or "")
        q = ws_log.cell(r, LOG_COLS["qty"]).value or 0
        if sku:
            sold[sku] = sold.get(sku, 0) + (q if isinstance(q,(int,float)) else 0)
    return sold

def _sold_by_name(ws_log):
    """جمع فروش هر نام محصول از لاگ_فاکتور — فاکتورهای واقعی SKU ندارند"""
    sold = {}
    for r in log_rows(ws_log):
        name = str(ws_log.cell(r, LOG_COLS["productName"]).value or "").strip()
        q = ws_log.cell(r, LOG_COLS["qty"]).value or 0
        if name:
            sold[name] = sold.get(name, 0) + (q if isinstance(q,(int,float)) else 0)
    return sold

def _price_map(ws_cat, ws_log=None):
    """قیمت/بها از کاتالوگ (کش‌شده)، موجودی زنده از لاگ_فاکتور محاسبه می‌شود.
    دو ایندکس ساخته می‌شود: بر اساس SKU و بر اساس نام دقیق محصول —
    چون فاکتورهای واقعی ثبت‌شده در سیستم قبلی فقط نام محصول را ذخیره کرده‌اند."""
    sold_sku  = _sold_by_sku(ws_log)  if ws_log is not None else {}
    sold_name = _sold_by_name(ws_log) if ws_log is not None else {}
    by_sku = {}; by_name = {}
    for r in cat_rows(ws_cat):
        sku = sku_of(r)
        name = str(ws_cat.cell(r, CAT_COLS["name"]).value or "").strip()
        open_stock = ws_cat.cell(r, CAT_COLS["openStock"]).value or 0
        open_stock = open_stock if isinstance(open_stock,(int,float)) else 0
        sold = max(sold_sku.get(sku, 0), sold_name.get(name, 0))
        rec = {
            "sku": sku, "name": name,
            "category": str(ws_cat.cell(r, CAT_COLS["category"]).value or ""),
            "cost": float(ws_cat.cell(r, CAT_COLS["cost"]).value or 0),
            "price": float(ws_cat.cell(r, CAT_COLS["price"]).value or 0),
            "openStock": open_stock, "sold": sold,
            "stock": max(0, open_stock - sold),
        }
        by_sku[sku] = rec
        if name:
            by_name[name] = rec
    return by_sku, by_name

def resolve_product(by_sku, by_name, sku="", name_hint=""):
    """محصول را ابتدا با SKU، سپس با نام پیدا می‌کند"""
    if sku and sku in by_sku:
        return by_sku[sku]
    if name_hint and name_hint in by_name:
        return by_name[name_hint]
    return {}

@app.route("/api/invoice/preview", methods=["POST"])
@auth
def preview():
    d = request.json or {}
    wbv = load_wb_values()
    by_sku, by_name = _price_map(wbv[SH_CAT], wbv[SH_LOG])
    gross = disc = cost = qty = 0
    items = []; warns = []
    for it in d.get("items", []):
        p = resolve_product(by_sku, by_name, it.get("sku",""), it.get("productName",""))
        q = int(it.get("qty", 0)); dd = float(it.get("discount", 0))
        price = p.get("price", 0); uc = p.get("cost", 0)
        line = q * price - dd
        after = p.get("stock", 0) - q
        st = "NEGATIVE" if after < 0 else "LOW" if after <= 3 else "OK"
        if st != "OK":
            warns.append(f'{p.get("name","?")}: موجودی {"کافی نیست" if after<0 else "کم است"}')
        items.append({"sku": it.get("sku"), "productName": p.get("name", ""),
            "category": p.get("category", ""), "qty": q, "unitPrice": price, "unitCost": uc,
            "netLine": line, "stockAfter": after, "status": st})
        gross += q*price; disc += dd; cost += q*uc; qty += q
    net = gross - disc
    if is_store():
        cost = net
        for i in items: i["unitCost"] = 0
    return jsonify({
        "invoiceNo": d.get("invoiceNo"), "grossTotal": gross, "discountTotal": disc,
        "netTotal": net, "costTotal": cost, "grossProfit": net - cost, "itemsQty": qty,
        "balance": float(d.get("receivedAmount", 0)) - net,
        "items": items, "warnings": warns,
    })

@app.route("/api/invoice/register", methods=["POST"])
@auth
def register():
    d = request.json or {}
    inv_no = d.get("invoiceNo")
    if not inv_no: return jsonify({"success": False, "error": "شماره فاکتور الزامی است"}), 400
    if not d.get("personnelId"): return jsonify({"success": False, "error": "پرسنل الزامی است"}), 400
    if not d.get("items"): return jsonify({"success": False, "error": "حداقل یک قلم الزامی است"}), 400

    with _lock:
        wb = load_wb()
        ws_log = wb[SH_LOG]

        # duplicate guard
        for r in log_rows(ws_log):
            if str(ws_log.cell(r, 1).value) == inv_no:
                return jsonify({"success": False, "error": f"فاکتور {inv_no} قبلاً ثبت شده"}), 409

        wbv = load_wb_values()
        by_sku, by_name = _price_map(wbv[SH_CAT], wbv[SH_LOG])
        gross = disc = cost = qty = 0
        written = 0

        for it in d.get("items", []):
            q = int(it.get("qty", 0))
            if q <= 0: continue
            row = find_next_empty_log_row(ws_log)
            if row is None:
                return jsonify({"success": False,
                    "error": f"ظرفیت لاگ فاکتور ({LOG_DATA_LAST_ROW} ردیف) پر شده — فرمول‌های ستون V تا AD را در اکسل به پایین بکشید"}), 507

            p = resolve_product(by_sku, by_name, it.get("sku",""), it.get("productName",""))
            dd = float(it.get("discount", 0))
            price = p.get("price", 0); uc = p.get("cost", 0)
            line = q * price - dd
            gross += q*price; disc += dd; cost += q*uc; qty += q

            vals = {
                "invoiceNo": inv_no, "date": d.get("date",""),
                "personnelId": d.get("personnelId",""), "personnelName": d.get("personnelName",""),
                "shift": d.get("shift",""), "paymentMethod": d.get("paymentMethod",""),
                "customerType": d.get("customerType",""), "channel": d.get("channel",""),
                "sku": it.get("sku",""), "productInput": it.get("sku",""),
                "productName": p.get("name",""),
                "qty": q, "unitPrice": price, "discount": dd, "lineTotal": line,
                "customerFirst": d.get("customerFirst",""), "customerLast": d.get("customerLast",""),
                "customerPhone": d.get("customerPhone",""),
                "birthDay": d.get("birthDay",""), "birthMonth": d.get("birthMonth",""),
                "notes": d.get("notes",""),
            }
            for key, col in LOG_COLS.items():
                ws_log.cell(row, col, vals.get(key, ""))
            # V..AD (22..30) already contain formulas from the template — untouched
            written += 1

        if written == 0:
            return jsonify({"success": False, "error": "هیچ قلم معتبری برای ثبت نبود"}), 400

        save_wb(wb)

    net = gross - disc
    bal = float(d.get("receivedAmount", 0)) - net
    if is_store(): cost = net          # سود برای نقش فروشگاه نمایش داده نمی‌شود
    return jsonify({
        "success": True, "invoiceNo": inv_no,
        "grossTotal": gross, "discountTotal": disc, "netTotal": net,
        "grossProfit": net - cost, "itemsQty": qty, "balance": bal,
        "note": "فرمول‌های موجودی/داشبورد هنگام باز کردن فایل در Excel خودکار محاسبه می‌شوند",
    })

@app.route("/api/dashboard/kpis")
@auth
def kpis():
    s = get_settings()
    target = float(s.get("monthlyTarget") or 1_000_000_000)

    wbv = load_wb_values()
    ws = wbv[SH_LOG]
    by_sku, by_name = _price_map(wbv[SH_CAT], ws)

    # فقط ماه جاری (یا ?month=1405/07) — قبلاً کل تاریخچه با هدف «ماهانه» مقایسه می‌شد
    months_all = sorted({f"{d[0]:04d}/{d[1]:02d}" for d in
                         (parse_fa_date(ws.cell(r, 2).value) for r in log_rows(ws)) if d})
    month = request.args.get("month") or (months_all[-1] if months_all else "")

    invoices = {}
    prod_map = {}; pers_map = {}; cat_map = {}
    cust_type = {}; cust_seen = {}
    for r in log_rows(ws):
        d_ = parse_fa_date(ws.cell(r, 2).value)
        if month and (not d_ or f"{d_[0]:04d}/{d_[1]:02d}" != month):
            continue
        no = str(ws.cell(r, 1).value)
        sku = str(ws.cell(r, LOG_COLS["sku"]).value or "")
        pname = str(ws.cell(r, LOG_COLS["productName"]).value or "").strip()
        prod = resolve_product(by_sku, by_name, sku, pname)
        q = ws.cell(r, LOG_COLS["qty"]).value or 0
        q = q if isinstance(q,(int,float)) else 0
        line = ws.cell(r, LOG_COLS["lineTotal"]).value or 0
        line = line if isinstance(line,(int,float)) else 0
        uc = prod.get("cost", 0)
        cat = prod.get("category", "") or "سایر"
        pers = str(ws.cell(r, LOG_COLS["personnelName"]).value or "")

        if no not in invoices:
            invoices[no] = {"net": 0, "qty": 0, "profit": 0, "date": str(ws.cell(r,2).value or "")}
            cust_type[no] = str(ws.cell(r, LOG_COLS["customerType"]).value or "")
        invoices[no]["net"] += line
        invoices[no]["qty"] += q
        invoices[no]["profit"] += line - q*uc

        if pname:
            prod_map.setdefault(pname, {"name": pname, "qty": 0, "sales": 0})
            prod_map[pname]["qty"] += q; prod_map[pname]["sales"] += line
        if pers:
            pers_map.setdefault(pers, {"name": pers, "sales": 0, "invSet": set()})
            pers_map[pers]["sales"] += line; pers_map[pers]["invSet"].add(no)
        cat_map[cat] = cat_map.get(cat, 0) + line

    net_sales = sum(i["net"] for i in invoices.values())
    profit    = sum(i["profit"] for i in invoices.values())
    inv_count = len(invoices)
    items_qty = sum(i["qty"] for i in invoices.values())

    lvl = int(s.get("stockAlertMin") or 3)
    neg = sum(1 for p in by_sku.values() if p["stock"] < 0)
    crit = sum(1 for p in by_sku.values() if 0 < p["stock"] <= lvl)

    dates = sorted({i["date"] for i in invoices.values() if i["date"]})[-7:]
    trend = [sum(i["net"] for i in invoices.values() if i["date"]==dt) for dt in dates]
    while len(trend) < 7: trend.insert(0, 0)

    top_p = sorted(prod_map.values(), key=lambda x: -x["sales"])[:5]
    top_s = sorted(
        [{"name": v["name"], "sales": v["sales"], "count": len(v["invSet"])} for v in pers_map.values()],
        key=lambda x: -x["sales"])[:5]

    # نرخ تبدیل / مرجوعی / اپ‌سل واقعی از KPI_روزانه (قبلاً عدد ثابت ساختگی بود)
    ws_kpi = wbv[SH_KPI]
    foot = kinv = rets = ups = 0
    for r in range(5, 105):
        d_ = parse_fa_date(ws_kpi.cell(r, 1).value)
        if not d_ or (month and f"{d_[0]:04d}/{d_[1]:02d}" != month): continue
        num = lambda c: ws_kpi.cell(r, c).value if isinstance(ws_kpi.cell(r, c).value, (int, float)) else 0
        foot += num(4); kinv += num(6); rets += num(9); ups += num(10)
    returning = sum(i["net"] for n, i in invoices.items()
                    if any(k in cust_type.get(n, "") for k in ("بازگشتی", "برگشتی", "وفادار", "VIP")))
    vip = sum(i["net"] for n, i in invoices.items() if "VIP" in cust_type.get(n, ""))

    if is_store():
        profit = 0
    return jsonify({
        "netSales": net_sales, "grossProfit": profit,
        "marginPercent": profit/net_sales if net_sales else 0,
        "achievementPercent": net_sales/target if target else 0,
        "invoiceCount": inv_count, "itemsQty": items_qty,
        "ATV": net_sales/inv_count if inv_count else 0,
        "UPT": items_qty/inv_count if inv_count else 0,
        "month": month, "monthsAvailable": months_all,
        "returnRate": rets/kinv if kinv else 0, "upsellRate": ups/kinv if kinv else 0,
        "conversionRate": kinv/foot if foot else 0,
        "negativeStockCount": neg, "reorderCriticalCount": crit,
        "returningCustomerSalesShare": returning/net_sales if net_sales else 0,
        "vipCustomerSales": vip,
        "topProducts": top_p, "topPersonnel": top_s, "trend": trend,
        "categorySales": [{"category": k, "amount": v} for k, v in
                           sorted(cat_map.items(), key=lambda kv: -kv[1])],
    })

@app.route("/api/dashboard/trend")
@auth("brand")
def trend():
    """روند فروش ماهانه — قابل انتخاب تعداد ماه و سال پایه"""
    months_n = int(request.args.get("months", 6))
    year_filter = request.args.get("year")  # مثال: "1405" یا خالی = همه سال‌ها

    ws = load_wb_values()[SH_LOG]
    monthly = {}  # "1405/06" -> amount
    for r in log_rows(ws):
        d = parse_fa_date(ws.cell(r, 2).value)
        if not d: continue
        y, m, _ = d
        if year_filter and str(y) != str(year_filter): continue
        line = ws.cell(r, LOG_COLS["lineTotal"]).value or 0
        line = line if isinstance(line,(int,float)) else 0
        key = f"{y:04d}/{m:02d}"
        monthly[key] = monthly.get(key, 0) + line

    ordered = sorted(monthly.keys())[-months_n:]
    labels = []
    values = []
    for key in ordered:
        y, m = key.split("/")
        labels.append(FA_MONTHS[int(m)-1])
        values.append(monthly[key])

    # pad to requested length with leading zero-months if history is short
    while len(values) < months_n:
        values.insert(0, 0)
        labels.insert(0, "")

    years_available = sorted({parse_fa_date(ws.cell(r,2).value)[0]
                               for r in log_rows(ws) if parse_fa_date(ws.cell(r,2).value)})

    return jsonify({"labels": labels, "values": values,
                     "yearsAvailable": years_available, "months": months_n})

@app.route("/api/warnings")
@auth
def warnings():
    wbv = load_wb_values()
    by_sku, _ = _price_map(wbv[SH_CAT], wbv[SH_LOG])
    lvl = int(get_settings().get("stockAlertMin") or 3)
    out = []
    for sku, p in by_sku.items():
        if not p["name"]: continue
        st = p["stock"]
        if st < 0:
            out.append({"severity":"critical","type":"negative_stock","title":"موجودی منفی",
                        "detail":f"{p['name']} — موجودی: {st}","count":1,"action":"inventory"})
        elif st == 0:
            out.append({"severity":"critical","type":"out_of_stock","title":"اتمام موجودی",
                        "detail":f"{p['name']} — نیاز به سفارش فوری","count":1,"action":"inventory"})
        elif st <= lvl:
            out.append({"severity":"warning","type":"reorder","title":"سفارش مجدد",
                        "detail":f"{p['name']} — موجودی: {st}","count":1,"action":"inventory"})
    return jsonify({"warnings": out, "total": len(out)})

@app.route("/api/daily-closure")
@auth
def closure():
    date = request.args.get("date", "")
    wbv = load_wb_values(); ws = wbv[SH_LOG]
    by_sku, by_name = _price_map(wbv[SH_CAT], ws)
    invoices = {}; pay = {}
    for r in log_rows(ws):
        d_ = str(ws.cell(r,2).value or "")
        if date and d_ != date: continue
        no = str(ws.cell(r,1).value)
        if no not in invoices:
            invoices[no] = {"invoiceNo": no, "date": d_,
                "personnelName": str(ws.cell(r, LOG_COLS["personnelName"]).value or ""),
                "paymentMethod": str(ws.cell(r, LOG_COLS["paymentMethod"]).value or ""),
                "netTotal": 0, "itemsQty": 0, "grossProfit": 0}
        q = int(ws.cell(r, LOG_COLS["qty"]).value or 0)
        line = float(ws.cell(r, LOG_COLS["lineTotal"]).value or 0)
        sku = str(ws.cell(r, LOG_COLS["sku"]).value or "")
        pname = str(ws.cell(r, LOG_COLS["productName"]).value or "").strip()
        uc = resolve_product(by_sku, by_name, sku, pname).get("cost", 0)
        invoices[no]["netTotal"] += line
        invoices[no]["itemsQty"] += q
        invoices[no]["grossProfit"] += line - q*uc
    for inv in invoices.values():
        pay[inv["paymentMethod"]] = pay.get(inv["paymentMethod"], 0) + inv["netTotal"]
    lst = list(invoices.values())
    if is_store():
        for i in lst: i["grossProfit"] = 0
    return jsonify({
        "date": date, "netSales": sum(i["netTotal"] for i in lst),
        "invoiceCount": len(lst), "itemsQty": sum(i["itemsQty"] for i in lst),
        "grossProfit": sum(i["grossProfit"] for i in lst),
        "paymentBreakdown": [{"method": k, "amount": v} for k, v in pay.items()],
        "invoices": lst,
    })

@app.route("/api/invoice/<inv_no>/print/<fmt>")
@auth
def print_invoice(inv_no, fmt):
    ws = load_wb_values()[SH_LOG]
    rows = [r for r in log_rows(ws) if str(ws.cell(r,1).value) == inv_no]
    if not rows: return jsonify({"error": "فاکتور یافت نشد"}), 404
    h = rows[0]
    return jsonify({
        "format": fmt, "invoiceNo": inv_no,
        "date": str(ws.cell(h,2).value or ""),
        "personnel": str(ws.cell(h, LOG_COLS["personnelName"]).value or ""),
        "payment": str(ws.cell(h, LOG_COLS["paymentMethod"]).value or ""),
        "customer": f"{ws.cell(h, LOG_COLS['customerFirst']).value or ''} {ws.cell(h, LOG_COLS['customerLast']).value or ''}".strip(),
        "phone": str(ws.cell(h, LOG_COLS["customerPhone"]).value or ""),
        "items": [{"name": str(ws.cell(r, LOG_COLS["productName"]).value or ""),
                    "qty": int(ws.cell(r, LOG_COLS["qty"]).value or 0),
                    "price": float(ws.cell(r, LOG_COLS["unitPrice"]).value or 0),
                    "discount": float(ws.cell(r, LOG_COLS["discount"]).value or 0),
                    "total": float(ws.cell(r, LOG_COLS["lineTotal"]).value or 0)} for r in rows],
        "netTotal": sum(float(ws.cell(r, LOG_COLS["lineTotal"]).value or 0) for r in rows),
    })

@app.route("/api/kpi/today")
@auth
def kpi_today():
    """KPI امروز — فروش/فاکتور از لاگ زنده، تبدیل/مرجوعی/اپ‌سل از KPI_روزانه"""
    date = request.args.get("date") or ""
    s = get_settings()

    wsv = load_wb_values()
    ws_log = wsv[SH_LOG]
    sales = 0; inv_set = set()
    for r in log_rows(ws_log):
        if str(ws_log.cell(r,2).value or "") != date: continue
        no = str(ws_log.cell(r,1).value)
        inv_set.add(no)
        line = ws_log.cell(r, LOG_COLS["lineTotal"]).value or 0
        sales += line if isinstance(line,(int,float)) else 0

    ws_kpi = wsv[SH_KPI]
    conv_vals = []; returns = 0; upsell = 0
    for r in range(5, 105):
        if str(ws_kpi.cell(r,1).value or "") != date: continue
        cv = ws_kpi.cell(r,11).value
        if isinstance(cv,(int,float)): conv_vals.append(cv)
        rv = ws_kpi.cell(r,9).value
        if isinstance(rv,(int,float)): returns += rv
        uv = ws_kpi.cell(r,10).value
        if isinstance(uv,(int,float)): upsell += uv

    conv_rate = sum(conv_vals)/len(conv_vals) if conv_vals else 0

    working_days = float(s.get("workingDays") or 30)
    monthly_target = float(s.get("monthlyTarget") or 1_000_000_000)
    min_atv = float(s.get("minATV") or 3_000_000)
    conv_target_raw = s.get("conversionTarget") or 25
    conv_target = conv_target_raw/100 if conv_target_raw > 1 else conv_target_raw

    daily_sales_target = monthly_target / working_days if working_days else 0
    daily_invoice_target = max(1, round(daily_sales_target / min_atv)) if min_atv else 5
    daily_return_max = max(1, round(daily_invoice_target * 0.15))
    daily_upsell_target = max(1, round(daily_invoice_target * 2.5))

    def status(actual, target, higher_better=True, tolerance=0.9):
        if higher_better:
            if actual >= target: return "excellent"
            if actual >= target*tolerance: return "close"
            return "behind"
        else:
            if actual <= target: return "excellent"
            if actual <= target*1.2: return "close"
            return "behind"

    return jsonify({
        "date": date,
        "sales": {"actual": sales, "target": daily_sales_target,
                   "status": status(sales, daily_sales_target)},
        "invoices": {"actual": len(inv_set), "target": daily_invoice_target,
                      "status": status(len(inv_set), daily_invoice_target)},
        "conversionRate": {"actual": conv_rate, "target": conv_target,
                             "status": status(conv_rate, conv_target)},
        "returns": {"actual": returns, "target": daily_return_max,
                     "status": status(returns, daily_return_max, higher_better=False)},
        "upsell": {"actual": upsell, "target": daily_upsell_target,
                    "status": status(upsell, daily_upsell_target)},
    })

@app.route("/api/kpi/daily", methods=["POST"])
@auth("brand")
def save_kpi():
    d = request.json or {}
    with _lock:
        wb = load_wb(); ws = wb[SH_KPI]
        r = None
        for rr in range(5, 105):
            if ws.cell(rr, 1).value in (None, ""):
                r = rr; break
        if r is None:
            return jsonify({"success": False, "error": "ظرفیت KPI_روزانه پر است"}), 507
        vals = [d.get("date",""), d.get("personnelId",""), d.get("personnelName",""),
                d.get("footfall",0), d.get("fittingRoom",0), d.get("invoiceCount",0),
                d.get("sales",0), d.get("discount",0), d.get("returns",0), d.get("upsell",0),
                d.get("conversionRate",0), d.get("ATV",0), d.get("UPT",0),
                d.get("complaints",0), d.get("events",""), d.get("notes","")]
        for j, v in enumerate(vals, 1): ws.cell(r, j, v)
        save_wb(wb)
    return jsonify({"success": True})

@app.route("/api/export")
@auth("brand")
def export():
    return send_file(EXCEL_FILE, as_attachment=True,
        download_name=f"CHAAM_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx")

# ═══════════════════════════════════════════════
if __name__ == "__main__":
    import socket
    print("\n" + "═"*54)
    print("   CHAAM RetailOS — Connector v2 (CHAAM_system.xlsx)")
    print("═"*54)
    print(f"✅ فایل: {EXCEL_FILE}")
    LOG_DATA_LAST_ROW = _detect_log_last_row()
    print(f"✅ ظرفیت لاگ_فاکتور تا ردیف: {LOG_DATA_LAST_ROW}")
    wb0 = load_wb_values()
    last = 0
    for r in log_rows(wb0[SH_LOG]): last = r
    print(f"✅ آخرین ردیف پر شده در لاگ_فاکتور: {last}")
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80)); ip = s.getsockname()[0]; s.close()
    except: ip = "127.0.0.1"
    print(f"\n   💻 ویندوز : http://localhost:{PORT}")
    print(f"   📱 موبایل : http://{ip}:{PORT}")
    print(f"   🔐 رمزهای فعال: {sum(1 for u in load_users() if u.get('active', True))}"
          + ("" if load_users() else "  ⚠️ فایل auth_users.json پیدا نشد — هیچ‌کس نمی‌تواند وارد شود"))
    print("═"*54 + "\n")
    app.run(host="0.0.0.0", port=PORT, debug=False, threaded=True)
