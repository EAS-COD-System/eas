import os, shutil
from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash
from models import db, Country, User

DEFAULT_COUNTRIES = [
    ("CN", "China"),
    ("KE", "Kenya"),
    ("UG", "Uganda"),
    ("TZ", "Tanzania"),
    ("ZM", "Zambia"),
    ("ZW", "Zimbabwe"),
]

def seed_defaults():
    for code, name in DEFAULT_COUNTRIES:
        if not Country.query.get(code):
            db.session.add(Country(code=code, name=name))
    if not User.query.filter_by(username="eas").first():
        db.session.add(User(username="eas",
                            pw_hash=generate_password_hash("easnew")))
    db.session.commit()

# --------- SQLite backup/restore helpers ----------
DB_FILE = "cod_system.db"
BACKUP_DIR = "backups"

def ensure_backup_dir():
    os.makedirs(BACKUP_DIR, exist_ok=True)

def db_path():
    return DB_FILE  # relative works on Render persistent disk

def make_backup(tag: str | None = None):
    """Copy the SQLite file into /backups with timestamp."""
    ensure_backup_dir()
    ts = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    name = f"{ts}{('-'+tag) if tag else ''}.sqlite"
    src = db_path()
    dst = os.path.join(BACKUP_DIR, name)
    if os.path.exists(src):
        shutil.copy2(src, dst)
    return dst

def restore_nearest(minutes: int):
    """Restore to the nearest backup not newer than now-minutes."""
    ensure_backup_dir()
    cutoff = datetime.utcnow() - timedelta(minutes=minutes)
    candidates = []
    for f in os.listdir(BACKUP_DIR):
        if f.endswith(".sqlite"):
            try:
                ts = datetime.strptime(f.split(".")[0].split("-")[0], "%Y%m%d")
            except Exception:
                continue
        # filenames are YYYYMMDD-HHMMSS.sqlite — parse more robustly
        try:
            ts = datetime.strptime(f[:15], "%Y%m%d-%H%M%S")
        except Exception:
            continue
        if ts <= cutoff:
            candidates.append((ts, f))
    if not candidates:
        return None
    candidates.sort(reverse=True)
    chosen = candidates[0][1]
    shutil.copy2(os.path.join(BACKUP_DIR, chosen), db_path())
    return chosen
