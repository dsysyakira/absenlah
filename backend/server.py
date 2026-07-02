"""
Absenlah - Enterprise Attendance Backend
FastAPI + MongoDB + JWT (bcrypt)
All routes prefixed with /api
"""

from fastapi import FastAPI, APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import math
import uuid
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Dict, Any
from datetime import datetime, timedelta, timezone, date, time as dtime
from passlib.context import CryptContext
from jose import jwt, JWTError

# ---------- Setup ----------
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ.get("JWT_SECRET", "absenlah-dev-secret-change-me")
JWT_ALG = "HS256"
JWT_EXPIRE_HOURS = 24 * 7  # 7 days

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

app = FastAPI(title="Absenlah API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("absenlah")

WIB = timezone(timedelta(hours=7))  # Asia/Jakarta


def now_wib() -> datetime:
    return datetime.now(WIB)


def today_wib_str() -> str:
    return now_wib().strftime("%Y-%m-%d")


def month_wib_str() -> str:
    return now_wib().strftime("%Y-%m")


# ---------- Password + JWT ----------
def hash_password(pwd: str) -> str:
    return pwd_context.hash(pwd)


def verify_password(pwd: str, hashed: str) -> bool:
    try:
        return pwd_context.verify(pwd, hashed)
    except Exception:
        return False


def create_token(user_id: str, username: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "username": username,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def get_current_user(token: Optional[str] = Depends(oauth2_scheme)) -> Dict[str, Any]:
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = payload.get("sub")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user or not user.get("active", True):
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


async def require_admin(user: Dict = Depends(get_current_user)) -> Dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user


async def require_supervisor_or_admin(user: Dict = Depends(get_current_user)) -> Dict:
    if user.get("role") not in ("admin", "supervisor"):
        raise HTTPException(status_code=403, detail="Supervisor or admin only")
    return user


# ---------- Models ----------
class LoginIn(BaseModel):
    username: str
    password: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


class UserCreate(BaseModel):
    username: str
    name: str
    password: str
    role: Literal["admin", "supervisor", "user"] = "user"
    position: Optional[str] = None
    division: Optional[str] = None
    warehouse_id: Optional[str] = None


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[Literal["admin", "supervisor", "user"]] = None
    position: Optional[str] = None
    division: Optional[str] = None
    warehouse_id: Optional[str] = None
    active: Optional[bool] = None


class WarehouseIn(BaseModel):
    name: str
    address: Optional[str] = ""
    latitude: float
    longitude: float
    radius_m: int = 100


class ConfigIn(BaseModel):
    # Times as "HH:MM" 24h
    shift_start: str = "10:00"
    shift_end: str = "20:00"
    lateness_start: str = "10:11"
    on_time_bonus: int = 20000
    # Late tiers: list of {from_min, to_min, fine} — minutes past shift_start
    late_tiers: List[Dict[str, Any]] = Field(default_factory=list)
    # Overtime tiers: list of {minutes_after_shift, amount}
    overtime_tiers: List[Dict[str, Any]] = Field(default_factory=list)
    overtime_step_min: int = 30
    overtime_step_amount: int = 10000
    shift_duration_hours: int = 10  # dynamic shift when checking in early
    early_departure_earliest: str = "17:00"  # 05:00 PM
    early_departure_monthly_limit: int = 3
    late_step_after_tiers_min: int = 30
    late_step_after_tiers_amount: int = 10000
    leave_min_hours_before_shift: int = 2
    manual_arrival_limit_hours: int = 2


class WarehouseUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    radius_m: Optional[int] = None


class RegulationsIn(BaseModel):
    content: str


class CheckInIn(BaseModel):
    latitude: float
    longitude: float


class CheckOutIn(BaseModel):
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class ManualAttendanceIn(BaseModel):
    user_id: str
    check_in_iso: str  # ISO datetime of arrival
    reason: str


class LeaveIn(BaseModel):
    date: str  # YYYY-MM-DD
    reason: str


# ---------- Seed ----------
DEFAULT_CONFIG = {
    "id": "global",
    "shift_start": "10:00",
    "shift_end": "20:00",
    "lateness_start": "10:11",
    "on_time_bonus": 20000,
    "shift_duration_hours": 10,
    "late_tiers": [
        # minutes from shift_start (10:00) — matches: 10:11-10:30 => 11..30
        {"from_min": 11, "to_min": 30, "fine": 5000, "label": "10:11-10:30"},
        {"from_min": 31, "to_min": 60, "fine": 10000, "label": "10:31-11:00"},
        {"from_min": 61, "to_min": 90, "fine": 15000, "label": "11:01-11:30"},
        {"from_min": 91, "to_min": 120, "fine": 20000, "label": "11:31-12:00"},
        {"from_min": 121, "to_min": 150, "fine": 30000, "label": "12:01-12:30"},
        {"from_min": 151, "to_min": 180, "fine": 40000, "label": "12:31-13:00"},
        {"from_min": 181, "to_min": 210, "fine": 50000, "label": "13:01-13:30"},
    ],
    "late_step_after_tiers_min": 30,
    "late_step_after_tiers_amount": 10000,
    "overtime_tiers": [
        {"minutes_after": 30, "amount": 5000},
        {"minutes_after": 60, "amount": 10000},
        {"minutes_after": 90, "amount": 15000},
        {"minutes_after": 120, "amount": 20000},
        {"minutes_after": 150, "amount": 30000},
        {"minutes_after": 180, "amount": 30000},
        {"minutes_after": 210, "amount": 40000},
        {"minutes_after": 240, "amount": 50000},
    ],
    "overtime_step_min": 30,
    "overtime_step_amount": 10000,
    "early_departure_earliest": "17:00",
    "early_departure_monthly_limit": 3,
    "leave_min_hours_before_shift": 2,
    "manual_arrival_limit_hours": 2,
    "updated_at": datetime.now(timezone.utc).isoformat(),
}


@app.on_event("startup")
async def startup_seed():
    # Seed admin
    admin = await db.users.find_one({"username": "administrator"})
    if not admin:
        await db.users.insert_one(
            {
                "id": str(uuid.uuid4()),
                "username": "administrator",
                "name": "Administrator",
                "password_hash": hash_password("admin123"),
                "role": "admin",
                "position": "System Administrator",
                "division": "IT",
                "warehouse_id": None,
                "must_change_password": True,
                "active": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        logger.info("Seeded default admin: administrator/admin123")

    # Seed config
    cfg = await db.config.find_one({"id": "global"})
    if not cfg:
        await db.config.insert_one(DEFAULT_CONFIG.copy())
        logger.info("Seeded default config")

    # Seed regulations
    reg = await db.regulations.find_one({"id": "global"})
    if not reg:
        await db.regulations.insert_one(
            {
                "id": "global",
                "content": (
                    "PERATURAN ABSENSI\n\n"
                    "1. Jam kerja: 10:00 - 20:00 WIB.\n"
                    "2. Keterlambatan dihitung mulai 10:11.\n"
                    "3. Bonus tepat waktu: Rp20.000 per hari.\n"
                    "4. Denda keterlambatan berlaku sesuai tier dinamis.\n"
                    "5. Pulang cepat maksimal 3x/bulan, tidak lebih awal dari 17:00.\n"
                    "6. Cuti wajib diajukan minimal 2 jam sebelum shift.\n"
                    "7. Absensi manual hanya untuk kurir darurat dengan persetujuan supervisor."
                ),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )

    # Seed a demo warehouse
    wh = await db.warehouses.find_one()
    if not wh:
        await db.warehouses.insert_one(
            {
                "id": str(uuid.uuid4()),
                "name": "Gudang Pusat Jakarta",
                "address": "Jl. Sudirman No.1, Jakarta",
                "latitude": -6.2088,
                "longitude": 106.8456,
                "radius_m": 200,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )

    # Seed 2 demo users
    demo_users = [
        {
            "username": "budi",
            "name": "Budi Santoso",
            "password": "budi123",
            "role": "user",
            "position": "Kurir",
            "division": "Logistik",
        },
        {
            "username": "siti",
            "name": "Siti Rahayu",
            "password": "siti123",
            "role": "supervisor",
            "position": "Supervisor Gudang",
            "division": "Logistik",
        },
    ]
    for d in demo_users:
        exists = await db.users.find_one({"username": d["username"]})
        if not exists:
            wh_doc = await db.warehouses.find_one({}, {"_id": 0, "id": 1})
            await db.users.insert_one(
                {
                    "id": str(uuid.uuid4()),
                    "username": d["username"],
                    "name": d["name"],
                    "password_hash": hash_password(d["password"]),
                    "role": d["role"],
                    "position": d["position"],
                    "division": d["division"],
                    "warehouse_id": wh_doc["id"] if wh_doc else None,
                    "must_change_password": False,
                    "active": True,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            )


# ---------- Helpers ----------
def parse_hhmm(s: str) -> dtime:
    hh, mm = s.split(":")
    return dtime(int(hh), int(mm))


def minutes_between(a: datetime, b: datetime) -> int:
    return int((b - a).total_seconds() // 60)


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    R = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


async def get_config() -> Dict[str, Any]:
    cfg = await db.config.find_one({"id": "global"}, {"_id": 0})
    return cfg or DEFAULT_CONFIG


def compute_late_fine(minutes_past_shift_start: int, cfg: Dict) -> Dict[str, Any]:
    """Given how many minutes past shift_start (positive = late), returns fine + label + late_minutes.
    Late begins from `lateness_start` — 10:11 => minute 11 from 10:00.
    """
    lateness_start_min = _minute_of_day(cfg["lateness_start"]) - _minute_of_day(cfg["shift_start"])
    if minutes_past_shift_start < lateness_start_min:
        return {"is_late": False, "late_minutes": max(0, minutes_past_shift_start), "fine": 0, "tier": None}
    # Match tier
    for tier in cfg.get("late_tiers", []):
        if tier["from_min"] <= minutes_past_shift_start <= tier["to_min"]:
            return {
                "is_late": True,
                "late_minutes": minutes_past_shift_start,
                "fine": tier["fine"],
                "tier": tier.get("label"),
            }
    # Beyond last tier: base = last tier fine, plus +step per step_min
    last_tier = cfg["late_tiers"][-1] if cfg.get("late_tiers") else {"to_min": 0, "fine": 0}
    extra_minutes = minutes_past_shift_start - last_tier["to_min"]
    steps = math.ceil(extra_minutes / cfg["late_step_after_tiers_min"])
    fine = last_tier["fine"] + steps * cfg["late_step_after_tiers_amount"]
    return {
        "is_late": True,
        "late_minutes": minutes_past_shift_start,
        "fine": fine,
        "tier": f">{last_tier['to_min']} min",
    }


def compute_overtime(minutes_after_shift_end: int, cfg: Dict) -> Dict[str, Any]:
    """Progressive overtime. Overtime starts 1 minute after shift end."""
    if minutes_after_shift_end < 1:
        return {"overtime_minutes": 0, "amount": 0}
    # find highest tier whose minutes_after <= minutes_after_shift_end
    tiers = sorted(cfg.get("overtime_tiers", []), key=lambda t: t["minutes_after"])
    matched = None
    for t in tiers:
        if minutes_after_shift_end >= t["minutes_after"]:
            matched = t
    if not matched:
        # not yet reached first tier (e.g., only 5-29 minutes of OT)
        return {"overtime_minutes": minutes_after_shift_end, "amount": 0}
    # Beyond last tier: +step_amount per step_min
    last_t = tiers[-1]
    if minutes_after_shift_end > last_t["minutes_after"]:
        extra = minutes_after_shift_end - last_t["minutes_after"]
        steps = extra // cfg["overtime_step_min"]
        amount = last_t["amount"] + steps * cfg["overtime_step_amount"]
        return {"overtime_minutes": minutes_after_shift_end, "amount": amount}
    return {"overtime_minutes": minutes_after_shift_end, "amount": matched["amount"]}


def _minute_of_day(hhmm: str) -> int:
    t = parse_hhmm(hhmm)
    return t.hour * 60 + t.minute


async def bump_user_stats(user_id: str, month: str, **increments):
    if not increments:
        return
    inc = {f"{k}": v for k, v in increments.items() if v}
    if not inc:
        return
    await db.user_stats.update_one(
        {"user_id": user_id, "month": month},
        {"$inc": inc, "$setOnInsert": {"user_id": user_id, "month": month}},
        upsert=True,
    )


async def notify_division(division: Optional[str], message: str, exclude_user_id: Optional[str] = None):
    if not division:
        return
    cursor = db.users.find({"division": division, "active": True}, {"_id": 0, "id": 1})
    async for u in cursor:
        if u["id"] == exclude_user_id:
            continue
        await db.notifications.insert_one(
            {
                "id": str(uuid.uuid4()),
                "user_id": u["id"],
                "division": division,
                "message": message,
                "read": False,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )


# ---------- Auth endpoints ----------
@api.post("/auth/login")
async def login(payload: LoginIn):
    user = await db.users.find_one({"username": payload.username})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Username atau password salah")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Akun dinonaktifkan")
    token = create_token(user["id"], user["username"], user["role"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "must_change_password": user.get("must_change_password", False),
        "user": {
            "id": user["id"],
            "username": user["username"],
            "name": user["name"],
            "role": user["role"],
            "position": user.get("position"),
            "division": user.get("division"),
            "warehouse_id": user.get("warehouse_id"),
            "must_change_password": user.get("must_change_password", False),
        },
    }


@api.post("/auth/change-password")
async def change_password(payload: ChangePasswordIn, user: Dict = Depends(get_current_user)):
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password baru minimal 6 karakter")
    doc = await db.users.find_one({"id": user["id"]})
    if not verify_password(payload.current_password, doc["password_hash"]):
        raise HTTPException(status_code=400, detail="Password lama tidak sesuai")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_password(payload.new_password), "must_change_password": False}},
    )
    return {"ok": True}


@api.get("/auth/me")
async def me(user: Dict = Depends(get_current_user)):
    return user


# ---------- Users (admin) ----------
@api.get("/users")
async def list_users(_: Dict = Depends(get_current_user)):
    cursor = db.users.find({}, {"_id": 0, "password_hash": 0})
    return [u async for u in cursor]


@api.post("/users")
async def create_user(payload: UserCreate, _: Dict = Depends(require_admin)):
    exists = await db.users.find_one({"username": payload.username})
    if exists:
        raise HTTPException(status_code=400, detail="Username sudah dipakai")
    doc = {
        "id": str(uuid.uuid4()),
        "username": payload.username,
        "name": payload.name,
        "password_hash": hash_password(payload.password),
        "role": payload.role,
        "position": payload.position,
        "division": payload.division,
        "warehouse_id": payload.warehouse_id,
        "must_change_password": True,
        "active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(doc)
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    return doc


@api.put("/users/{user_id}")
async def update_user(user_id: str, payload: UserUpdate, _: Dict = Depends(require_admin)):
    updates = {k: v for k, v in payload.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Tidak ada perubahan")
    result = await db.users.update_one({"id": user_id}, {"$set": updates})
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    doc = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return doc


@api.delete("/users/{user_id}")
async def delete_user(user_id: str, _: Dict = Depends(require_admin)):
    r = await db.users.delete_one({"id": user_id})
    return {"deleted": r.deleted_count}


@api.post("/users/{user_id}/reset-password")
async def reset_password(user_id: str, _: Dict = Depends(require_admin)):
    new = "reset123"
    r = await db.users.update_one(
        {"id": user_id},
        {"$set": {"password_hash": hash_password(new), "must_change_password": True}},
    )
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    return {"ok": True, "temporary_password": new}


# ---------- Warehouses (admin) ----------
@api.get("/warehouses")
async def list_warehouses(_: Dict = Depends(get_current_user)):
    return [w async for w in db.warehouses.find({}, {"_id": 0})]


@api.post("/warehouses")
async def create_warehouse(payload: WarehouseIn, _: Dict = Depends(require_admin)):
    doc = {
        "id": str(uuid.uuid4()),
        "name": payload.name,
        "address": payload.address or "",
        "latitude": payload.latitude,
        "longitude": payload.longitude,
        "radius_m": payload.radius_m,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.warehouses.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/warehouses/{wh_id}")
async def update_warehouse(wh_id: str, payload: WarehouseUpdate, _: Dict = Depends(require_admin)):
    updates = {k: v for k, v in payload.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Tidak ada perubahan")
    r = await db.warehouses.update_one({"id": wh_id}, {"$set": updates})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Warehouse tidak ditemukan")
    return await db.warehouses.find_one({"id": wh_id}, {"_id": 0})


@api.delete("/warehouses/{wh_id}")
async def delete_warehouse(wh_id: str, _: Dict = Depends(require_admin)):
    r = await db.warehouses.delete_one({"id": wh_id})
    return {"deleted": r.deleted_count}


# ---------- Config (dynamic rules) ----------
@api.get("/config")
async def get_config_endpoint(_: Dict = Depends(get_current_user)):
    return await get_config()


@api.put("/config")
async def update_config(payload: ConfigIn, _: Dict = Depends(require_admin)):
    updates = payload.dict()
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.config.update_one({"id": "global"}, {"$set": updates}, upsert=True)
    return await get_config()


# ---------- Regulations ----------
@api.get("/regulations")
async def get_regulations(_: Dict = Depends(get_current_user)):
    doc = await db.regulations.find_one({"id": "global"}, {"_id": 0})
    return doc or {"id": "global", "content": ""}


@api.put("/regulations")
async def update_regulations(payload: RegulationsIn, _: Dict = Depends(require_admin)):
    await db.regulations.update_one(
        {"id": "global"},
        {"$set": {"content": payload.content, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return await db.regulations.find_one({"id": "global"}, {"_id": 0})


# ---------- Attendance ----------
async def _validate_geofence(lat: float, lng: float, warehouse_id: Optional[str]) -> Dict[str, Any]:
    wh = None
    if warehouse_id:
        wh = await db.warehouses.find_one({"id": warehouse_id}, {"_id": 0})
    if not wh:
        # fall back to any warehouse (best effort)
        wh = await db.warehouses.find_one({}, {"_id": 0})
    if not wh:
        raise HTTPException(status_code=400, detail="Belum ada gudang terdaftar")
    dist = haversine_m(lat, lng, wh["latitude"], wh["longitude"])
    if dist > wh["radius_m"]:
        raise HTTPException(
            status_code=400,
            detail=f"Lokasi di luar radius gudang ({int(dist)}m > {wh['radius_m']}m)",
        )
    return {"warehouse": wh, "distance_m": dist}


@api.post("/attendance/check-in")
async def check_in(payload: CheckInIn, user: Dict = Depends(get_current_user)):
    today = today_wib_str()
    existing = await db.attendance.find_one({"user_id": user["id"], "date": today})
    if existing:
        raise HTTPException(status_code=400, detail="Anda sudah check-in hari ini")

    geo = await _validate_geofence(payload.latitude, payload.longitude, user.get("warehouse_id"))
    cfg = await get_config()

    now = now_wib()
    shift_start_t = parse_hhmm(cfg["shift_start"])
    shift_start_dt = now.replace(hour=shift_start_t.hour, minute=shift_start_t.minute, second=0, microsecond=0)

    # If check-in is before shift_start -> dynamic shift (10h from actual check-in)
    if now < shift_start_dt:
        effective_shift_end = now + timedelta(hours=cfg["shift_duration_hours"])
        is_early = True
        late_result = {"is_late": False, "late_minutes": 0, "fine": 0, "tier": None}
    else:
        # Fixed shift
        shift_end_t = parse_hhmm(cfg["shift_end"])
        effective_shift_end = now.replace(
            hour=shift_end_t.hour, minute=shift_end_t.minute, second=0, microsecond=0
        )
        is_early = False
        minutes_past = minutes_between(shift_start_dt, now)
        late_result = compute_late_fine(minutes_past, cfg)

    on_time_bonus = cfg["on_time_bonus"] if not late_result["is_late"] else 0

    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "date": today,
        "check_in_at": now.isoformat(),
        "check_in_lat": payload.latitude,
        "check_in_lng": payload.longitude,
        "warehouse_id": geo["warehouse"]["id"],
        "warehouse_name": geo["warehouse"]["name"],
        "distance_m": round(geo["distance_m"], 1),
        "effective_shift_end": effective_shift_end.isoformat(),
        "is_early_check_in": is_early,
        "is_late": late_result["is_late"],
        "late_minutes": late_result["late_minutes"],
        "penalty_amount": late_result["fine"],
        "late_tier": late_result["tier"],
        "on_time_bonus": on_time_bonus,
        "overtime_minutes": 0,
        "overtime_amount": 0,
        "check_out_at": None,
        "early_departure": False,
        "status": "checked_in",
        "manual": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.attendance.insert_one(doc)

    await bump_user_stats(
        user["id"],
        month_wib_str(),
        total_penalty=late_result["fine"],
        total_bonus=on_time_bonus,
    )
    doc.pop("_id", None)
    return doc


@api.post("/attendance/check-out")
async def check_out(payload: CheckOutIn, user: Dict = Depends(get_current_user)):
    today = today_wib_str()
    att = await db.attendance.find_one({"user_id": user["id"], "date": today})
    if not att:
        raise HTTPException(status_code=400, detail="Anda belum check-in hari ini")
    if att.get("check_out_at"):
        raise HTTPException(status_code=400, detail="Anda sudah check-out")

    cfg = await get_config()
    now = now_wib()
    effective_end = datetime.fromisoformat(att["effective_shift_end"])
    if effective_end.tzinfo is None:
        effective_end = effective_end.replace(tzinfo=WIB)

    # Early departure logic (only when NOT early check-in dynamic shift?)
    # Interpretation: early departure rule always applies to normal shift.
    early_departure = False
    early_departure_deduction = 0
    if not att.get("is_early_check_in"):
        earliest_t = parse_hhmm(cfg["early_departure_earliest"])
        earliest_dt = now.replace(hour=earliest_t.hour, minute=earliest_t.minute, second=0, microsecond=0)
        shift_end_t = parse_hhmm(cfg["shift_end"])
        shift_end_dt = now.replace(hour=shift_end_t.hour, minute=shift_end_t.minute, second=0, microsecond=0)
        if now < shift_end_dt:
            early_departure = True

    # Overtime: minutes after effective_shift_end
    ot_min = max(0, minutes_between(effective_end, now))
    ot = compute_overtime(ot_min, cfg)

    # If early departure — check monthly counter
    month = month_wib_str()
    if early_departure:
        stats = await db.user_stats.find_one({"user_id": user["id"], "month": month}) or {}
        current_count = stats.get("early_departure_count", 0)
        # Leaving before earliest permitted early departure time — always deduct bonus
        earliest_t = parse_hhmm(cfg["early_departure_earliest"])
        earliest_dt = now.replace(hour=earliest_t.hour, minute=earliest_t.minute, second=0, microsecond=0)
        if now < earliest_dt:
            early_departure_deduction = cfg["on_time_bonus"]
        elif current_count + 1 > cfg["early_departure_monthly_limit"]:
            early_departure_deduction = cfg["on_time_bonus"]

    updates = {
        "check_out_at": now.isoformat(),
        "check_out_lat": payload.latitude,
        "check_out_lng": payload.longitude,
        "overtime_minutes": ot["overtime_minutes"],
        "overtime_amount": ot["amount"],
        "early_departure": early_departure,
        "early_departure_deduction": early_departure_deduction,
        "status": "completed",
    }
    await db.attendance.update_one({"id": att["id"]}, {"$set": updates})

    # Update stats
    inc = {"total_overtime": ot["amount"]}
    if early_departure:
        inc["early_departure_count"] = 1
    if early_departure_deduction:
        inc["total_penalty"] = early_departure_deduction
        inc["total_bonus"] = -early_departure_deduction
    await bump_user_stats(user["id"], month, **inc)

    att.update(updates)
    att.pop("_id", None)
    return att


@api.post("/attendance/manual")
async def manual_attendance(payload: ManualAttendanceIn, actor: Dict = Depends(require_supervisor_or_admin)):
    cfg = await get_config()
    check_in_dt = datetime.fromisoformat(payload.check_in_iso)
    if check_in_dt.tzinfo is None:
        check_in_dt = check_in_dt.replace(tzinfo=WIB)
    now = now_wib()
    # 2-hour arrival limit — arrival must be within last 2 hours
    if abs((now - check_in_dt).total_seconds()) > cfg["manual_arrival_limit_hours"] * 3600:
        raise HTTPException(
            status_code=400,
            detail=f"Absensi manual hanya untuk kedatangan dalam {cfg['manual_arrival_limit_hours']} jam terakhir",
        )
    target = await db.users.find_one({"id": payload.user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    date_str = check_in_dt.strftime("%Y-%m-%d")
    existing = await db.attendance.find_one({"user_id": payload.user_id, "date": date_str})
    if existing:
        raise HTTPException(status_code=400, detail="User sudah punya absensi hari ini")

    shift_start_t = parse_hhmm(cfg["shift_start"])
    shift_start_dt = check_in_dt.replace(hour=shift_start_t.hour, minute=shift_start_t.minute, second=0, microsecond=0)
    if check_in_dt < shift_start_dt:
        effective_shift_end = check_in_dt + timedelta(hours=cfg["shift_duration_hours"])
        late_result = {"is_late": False, "late_minutes": 0, "fine": 0, "tier": None}
        is_early = True
    else:
        shift_end_t = parse_hhmm(cfg["shift_end"])
        effective_shift_end = check_in_dt.replace(hour=shift_end_t.hour, minute=shift_end_t.minute, second=0, microsecond=0)
        minutes_past = minutes_between(shift_start_dt, check_in_dt)
        late_result = compute_late_fine(minutes_past, cfg)
        is_early = False

    on_time_bonus = cfg["on_time_bonus"] if not late_result["is_late"] else 0

    doc = {
        "id": str(uuid.uuid4()),
        "user_id": payload.user_id,
        "date": date_str,
        "check_in_at": check_in_dt.isoformat(),
        "warehouse_id": target.get("warehouse_id"),
        "warehouse_name": None,
        "effective_shift_end": effective_shift_end.isoformat(),
        "is_early_check_in": is_early,
        "is_late": late_result["is_late"],
        "late_minutes": late_result["late_minutes"],
        "penalty_amount": late_result["fine"],
        "late_tier": late_result["tier"],
        "on_time_bonus": on_time_bonus,
        "overtime_minutes": 0,
        "overtime_amount": 0,
        "check_out_at": None,
        "early_departure": False,
        "status": "checked_in",
        "manual": True,
        "manual_reason": payload.reason,
        "approved_by": actor["id"],
        "approved_by_name": actor["name"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.attendance.insert_one(doc)
    await bump_user_stats(payload.user_id, month_wib_str(), total_penalty=late_result["fine"], total_bonus=on_time_bonus)
    doc.pop("_id", None)
    return doc


@api.get("/attendance/me")
async def my_attendance(limit: int = 30, user: Dict = Depends(get_current_user)):
    today = today_wib_str()
    today_doc = await db.attendance.find_one({"user_id": user["id"], "date": today}, {"_id": 0})
    cursor = db.attendance.find({"user_id": user["id"]}, {"_id": 0}).sort("date", -1).limit(limit)
    history = [d async for d in cursor]
    stats = await db.user_stats.find_one({"user_id": user["id"], "month": month_wib_str()}, {"_id": 0})
    return {"today": today_doc, "history": history, "month_stats": stats or {}}


@api.get("/attendance/reports")
async def reports(
    period: Literal["daily", "weekly", "monthly"] = "monthly",
    user: Dict = Depends(get_current_user),
):
    now = now_wib()
    if period == "daily":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "weekly":
        start = now - timedelta(days=7)
    else:
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    query = {"created_at": {"$gte": start.astimezone(timezone.utc).isoformat()}}
    if user["role"] not in ("admin", "supervisor"):
        query["user_id"] = user["id"]

    cursor = db.attendance.find(query, {"_id": 0})
    records = [r async for r in cursor]
    total_penalty = sum(r.get("penalty_amount", 0) + r.get("early_departure_deduction", 0) for r in records)
    total_bonus = sum(r.get("on_time_bonus", 0) for r in records)
    total_ot = sum(r.get("overtime_amount", 0) for r in records)
    late_count = sum(1 for r in records if r.get("is_late"))
    on_time_count = sum(1 for r in records if not r.get("is_late"))
    return {
        "period": period,
        "count": len(records),
        "on_time_count": on_time_count,
        "late_count": late_count,
        "total_penalty": total_penalty,
        "total_bonus": total_bonus,
        "total_overtime": total_ot,
        "records": records,
    }


# ---------- Leave ----------
@api.post("/leave")
async def create_leave(payload: LeaveIn, user: Dict = Depends(get_current_user)):
    cfg = await get_config()
    try:
        leave_date = datetime.strptime(payload.date, "%Y-%m-%d").replace(tzinfo=WIB)
    except ValueError:
        raise HTTPException(status_code=400, detail="Format tanggal salah (YYYY-MM-DD)")

    shift_start_t = parse_hhmm(cfg["shift_start"])
    shift_start_dt = leave_date.replace(hour=shift_start_t.hour, minute=shift_start_t.minute)
    now = now_wib()
    hours_before = (shift_start_dt - now).total_seconds() / 3600
    if hours_before < cfg["leave_min_hours_before_shift"]:
        raise HTTPException(
            status_code=400,
            detail=f"Cuti harus diajukan minimal {cfg['leave_min_hours_before_shift']} jam sebelum shift",
        )

    # Conflict: same position + same date
    conflict = await db.leave_requests.find_one(
        {
            "date": payload.date,
            "position": user.get("position"),
            "status": {"$in": ["pending", "approved"]},
        }
    )
    if conflict:
        raise HTTPException(status_code=400, detail="Sudah ada rekan sejawat (posisi sama) yang cuti pada tanggal ini")

    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "user_name": user["name"],
        "position": user.get("position"),
        "division": user.get("division"),
        "date": payload.date,
        "reason": payload.reason,
        "status": "approved",  # auto-approve per SOP (no explicit approval step)
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.leave_requests.insert_one(doc)
    await bump_user_stats(user["id"], month_wib_str(), leave_count=1)
    await notify_division(
        user.get("division"),
        f"{user['name']} mengajukan cuti pada {payload.date}",
        exclude_user_id=user["id"],
    )
    doc.pop("_id", None)
    return doc


@api.delete("/leave/{leave_id}")
async def cancel_leave(leave_id: str, user: Dict = Depends(get_current_user)):
    doc = await db.leave_requests.find_one({"id": leave_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Cuti tidak ditemukan")
    if doc["user_id"] != user["id"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Bukan cuti Anda")
    if doc["status"] == "cancelled":
        raise HTTPException(status_code=400, detail="Sudah dibatalkan")

    # Cancellation must be at H-1: at least 1 day before
    try:
        leave_date = datetime.strptime(doc["date"], "%Y-%m-%d").replace(tzinfo=WIB)
    except ValueError:
        raise HTTPException(status_code=400, detail="Format tanggal salah")
    hours_before = (leave_date - now_wib()).total_seconds() / 3600
    if hours_before < 24:
        raise HTTPException(status_code=400, detail="Pembatalan hanya bisa sebelum H-1")

    await db.leave_requests.update_one({"id": leave_id}, {"$set": {"status": "cancelled"}})
    await bump_user_stats(user["id"], month_wib_str(), leave_count=-1)
    await notify_division(
        doc.get("division"),
        f"Slot cuti {doc['date']} kosong kembali (dibatalkan oleh {doc['user_name']})",
        exclude_user_id=user["id"],
    )
    return {"ok": True}


@api.get("/leave/division")
async def division_leaves(user: Dict = Depends(get_current_user)):
    if not user.get("division"):
        return []
    cursor = db.leave_requests.find(
        {"division": user["division"], "status": {"$in": ["pending", "approved"]}},
        {"_id": 0},
    ).sort("date", 1)
    return [d async for d in cursor]


@api.get("/leave/me")
async def my_leaves(user: Dict = Depends(get_current_user)):
    cursor = db.leave_requests.find({"user_id": user["id"]}, {"_id": 0}).sort("date", -1)
    return [d async for d in cursor]


# ---------- Notifications ----------
@api.get("/notifications")
async def get_notifications(user: Dict = Depends(get_current_user)):
    cursor = db.notifications.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).limit(50)
    return [n async for n in cursor]


@api.post("/notifications/{nid}/read")
async def mark_read(nid: str, user: Dict = Depends(get_current_user)):
    await db.notifications.update_one({"id": nid, "user_id": user["id"]}, {"$set": {"read": True}})
    return {"ok": True}


# ---------- Health ----------
@api.get("/")
async def root():
    return {"app": "Absenlah", "status": "ok"}


# ---------- Wire up ----------
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
