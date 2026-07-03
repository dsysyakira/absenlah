"""
Absenlah - Enterprise Attendance Backend
FastAPI + MongoDB + JWT (bcrypt)
All routes prefixed with /api
"""

from fastapi import FastAPI, APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import math
import uuid
import io
import csv
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
    username: Optional[str] = None
    email: Optional[str] = None
    password: str
    device_id: Optional[str] = None


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


class GoogleAuthIn(BaseModel):
    google_id: str
    email: str
    name: str
    device_id: Optional[str] = None


class UserProfileUpdateIn(BaseModel):
    name: Optional[str] = None
    profile_photo_base64: Optional[str] = None


class JobCreateIn(BaseModel):
    user_id: str
    title: str
    description: Optional[str] = ""


class JobUpdateIn(BaseModel):
    status: Literal["started", "completed"]
    proof_base64: str
    latitude: float
    longitude: float


class AnnouncementCreateIn(BaseModel):
    title: str
    content: str
    is_popup: bool = True
    send_push: bool = True


class UserCreate(BaseModel):
    username: str
    email: str
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
    lateness_monthly_quota: int = 3  # allowance before penalty deduction ramps
    emergency_quota_period_months: int = 6
    emergency_quota_limit: int = 2
    leave_day_bonus_amount: int = 100000
    monthly_discipline_bonus_amount: int = 800000
    monthly_leave_limit_for_bonus: int = 4
    monthly_leave_quota_standard: int = 4


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
    liveness_verified: bool = False
    selfie_base64: Optional[str] = None


class CheckOutIn(BaseModel):
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class ManualAttendanceIn(BaseModel):
    user_id: str
    check_in_iso: str  # ISO datetime of arrival
    reason: str


class ArrivalConfirmationIn(BaseModel):
    confirmed_arrival_at: str  # ISO datetime


class LatenessReviewIn(BaseModel):
    penalty_type: Literal["lateness_quota", "leave_day", "emergency_quota"]


class LeaveIn(BaseModel):
    date: str  # YYYY-MM-DD
    reason: str


class EarlyDepartureReviewIn(BaseModel):
    approve: bool
    review_note: Optional[str] = None


class EmergencyIn(BaseModel):
    date: str  # YYYY-MM-DD
    reason: str
    proof_base64: str  # data URL or raw base64 of the proof image


class EmergencyReviewIn(BaseModel):
    approve: bool
    review_note: Optional[str] = None


class ActivityLogIn(BaseModel):
    content: str


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
    "lateness_monthly_quota": 3,
    "emergency_quota_period_months": 6,
    "emergency_quota_limit": 2,
    "leave_day_bonus_amount": 100000,
    "monthly_discipline_bonus_amount": 800000,
    "monthly_leave_limit_for_bonus": 4,
    "monthly_leave_quota_standard": 4,
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

    # Seed announcements
    ann = await db.announcements.find_one()
    if not ann:
        await db.announcements.insert_one(
            {
                "id": str(uuid.uuid4()),
                "title": "Selamat Datang di Absenlah v3.0",
                "content": "Gunakan aplikasi ini untuk absensi harian dan pengajuan cuti.",
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
    merged = {**DEFAULT_CONFIG, **(cfg or {})}
    # If any new keys are missing on the persisted doc, fill them from defaults
    for k, v in DEFAULT_CONFIG.items():
        if merged.get(k) is None:
            merged[k] = v
    return merged


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
@api.post("/auth/google-login")
async def google_login(payload: GoogleAuthIn):
    user = await db.users.find_one({"$or": [{"google_id": payload.google_id}, {"email": payload.email}]})
    if not user:
        # Auto-register Google user
        user_id = str(uuid.uuid4())
        user = {
            "id": user_id,
            "username": payload.email.split("@")[0],
            "email": payload.email,
            "name": payload.name,
            "google_id": payload.google_id,
            "role": "user",
            "active": True,
            "device_id": payload.device_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.users.insert_one(user)
    else:
        if not user.get("google_id"):
            await db.users.update_one({"id": user["id"]}, {"$set": {"google_id": payload.google_id}})

        # Device Binding check for Google Login
        if payload.device_id:
            if not user.get("device_id"):
                await db.users.update_one({"id": user["id"]}, {"$set": {"device_id": payload.device_id}})
            elif user["device_id"] != payload.device_id:
                raise HTTPException(status_code=403, detail="Device mismatch")

    token = create_token(user["id"], user["username"], user["role"])
    return {"access_token": token, "token_type": "bearer", "user": user}


@api.post("/auth/login")
async def login(payload: LoginIn):
    query = {}
    if payload.username:
        query["username"] = payload.username
    elif payload.email:
        query["email"] = payload.email
    else:
        raise HTTPException(status_code=400, detail="Username atau Email wajib diisi")

    user = await db.users.find_one(query)
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Username/Email atau password salah")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Akun dinonaktifkan")

    # Device ID Binding
    if payload.device_id:
        if not user.get("device_id"):
            # First login with device_id, bind it
            await db.users.update_one({"id": user["id"]}, {"$set": {"device_id": payload.device_id}})
            user["device_id"] = payload.device_id
        elif user["device_id"] != payload.device_id:
            raise HTTPException(
                status_code=403,
                detail="Akun ini terikat pada perangkat lain. Silakan hubungi admin.",
            )

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


@api.post("/auth/profile")
async def update_profile(payload: UserProfileUpdateIn, user: Dict = Depends(get_current_user)):
    updates = {}
    if payload.name:
        updates["name"] = payload.name
    if payload.profile_photo_base64:
        updates["profile_photo"] = payload.profile_photo_base64
    if not updates:
        return user
    await db.users.update_one({"id": user["id"]}, {"$set": updates})
    return await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})


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
    exists = await db.users.find_one({"$or": [{"username": payload.username}, {"email": payload.email}]})
    if exists:
        raise HTTPException(status_code=400, detail="Username atau Email sudah dipakai")
    doc = {
        "id": str(uuid.uuid4()),
        "username": payload.username,
        "email": payload.email,
        "name": payload.name,
        "password_hash": hash_password(payload.password),
        "role": payload.role,
        "position": payload.position,
        "division": payload.division,
        "warehouse_id": payload.warehouse_id,
        "must_change_password": True,
        "active": True,
        "device_id": None,
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


@api.post("/users/{user_id}/release-device")
async def release_device(user_id: str, _: Dict = Depends(require_admin)):
    r = await db.users.update_one({"id": user_id}, {"$set": {"device_id": None}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    return {"ok": True}


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
    if not payload.liveness_verified:
        raise HTTPException(status_code=400, detail="Verifikasi liveness wajib dilakukan")

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
    penalty_amount = late_result["fine"]
    leave_deduction = 0

    if late_result["is_late"]:
        # 3rd Lateness Rule
        month = month_wib_str()
        late_count_this_month = await db.attendance.count_documents(
            {"user_id": user["id"], "is_late": True, "date": {"$regex": f"^{month}"}}
        )
        if late_count_this_month == 2:  # This is the 3rd lateness
            # Check if user has leave quota? SOP says "if leave quota exists".
            # For now we assume quota exists or we just deduct it anyway and it can go negative.
            # SOP: "The 3rd lateness in a month converts into a leave day deduction instead of a cash fine"
            penalty_amount = 0
            leave_deduction = 1

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
        "penalty_amount": penalty_amount,
        "leave_deduction": leave_deduction,
        "late_tier": late_result["tier"],
        "on_time_bonus": on_time_bonus,
        "overtime_minutes": 0,
        "overtime_amount": 0,
        "liveness_verified": payload.liveness_verified,
        "selfie_base64": payload.selfie_base64,
        "device_id": user.get("device_id"),
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
        total_penalty=penalty_amount,
        total_bonus=on_time_bonus,
        leave_count=leave_deduction,
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

    # Early departure detection — final approval deferred to supervisor workflow.
    early_departure = False
    early_departure_deduction = 0
    if not att.get("is_early_check_in"):
        shift_end_t = parse_hhmm(cfg["shift_end"])
        shift_end_dt = now.replace(hour=shift_end_t.hour, minute=shift_end_t.minute, second=0, microsecond=0)
        if now < shift_end_dt:
            early_departure = True

    # Overtime: minutes after effective_shift_end
    ot_min = max(0, minutes_between(effective_end, now))
    ot = compute_overtime(ot_min, cfg)

    # If early departure — DO NOT increment counter or apply deduction here.
    # Instead create a pending early_departure_request that supervisor must approve.
    month = month_wib_str()
    early_departure_deduction = 0
    early_departure_status = None
    early_departure_request_id = None
    if early_departure:
        early_departure_status = "pending"
        early_departure_request_id = str(uuid.uuid4())
        await db.early_departure_requests.insert_one(
            {
                "id": early_departure_request_id,
                "user_id": user["id"],
                "user_name": user["name"],
                "division": user.get("division"),
                "position": user.get("position"),
                "attendance_id": att["id"],
                "date": today,
                "requested_check_out_at": now.isoformat(),
                "reason": None,
                "status": "pending",
                "reviewed_by": None,
                "reviewed_at": None,
                "deduction_applied": 0,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )

    updates = {
        "check_out_at": now.isoformat(),
        "check_out_lat": payload.latitude,
        "check_out_lng": payload.longitude,
        "overtime_minutes": ot["overtime_minutes"],
        "overtime_amount": ot["amount"],
        "early_departure": early_departure,
        "early_departure_status": early_departure_status,
        "early_departure_request_id": early_departure_request_id,
        "early_departure_deduction": early_departure_deduction,
        "status": "completed",
    }
    await db.attendance.update_one({"id": att["id"]}, {"$set": updates})

    # Update stats — overtime always counts; early departure count/deduction defer to approval.
    if ot["amount"]:
        await bump_user_stats(user["id"], month, total_overtime=ot["amount"])

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
    penalty_amount = late_result["fine"]
    leave_deduction = 0

    if late_result["is_late"]:
        # 3rd Lateness Rule
        month = date_str[:7]
        late_count_this_month = await db.attendance.count_documents(
            {"user_id": payload.user_id, "is_late": True, "date": {"$regex": f"^{month}"}}
        )
        if late_count_this_month == 2:
            penalty_amount = 0
            leave_deduction = 1

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
        "penalty_amount": penalty_amount,
        "leave_deduction": leave_deduction,
        "late_tier": late_result["tier"],
        "on_time_bonus": on_time_bonus,
        "overtime_minutes": 0,
        "overtime_amount": 0,
        "check_out_at": None,
        "early_departure": False,
        "status": "checked_in",
        "manual": True,
        "manual_reason": payload.reason,
        "arrival_limit_at": (check_in_dt + timedelta(hours=2)).isoformat(),
        "arrival_confirmed_at": None,
        "arrival_status": "pending",
        "approved_by": actor["id"],
        "approved_by_name": actor["name"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.attendance.insert_one(doc)
    await bump_user_stats(
        payload.user_id,
        month_wib_str(),
        total_penalty=penalty_amount,
        total_bonus=on_time_bonus,
        leave_count=leave_deduction,
    )
    doc.pop("_id", None)
    return doc


@api.post("/attendance/{att_id}/review-lateness")
async def review_lateness(att_id: str, payload: LatenessReviewIn, actor: Dict = Depends(require_supervisor_or_admin)):
    att = await db.attendance.find_one({"id": att_id})
    if not att or not att.get("is_late"):
        raise HTTPException(status_code=404, detail="Late attendance record not found")

    cfg = await get_config()
    month = att["date"][:7]
    stats_inc = {}

    if payload.penalty_type == "lateness_quota":
        # Already handled by default logic in check_in (increments penalty if past quota)
        # But here we can explicitly track it if needed.
        pass
    elif payload.penalty_type == "leave_day":
        # Deduct leave instead of money
        await db.attendance.update_one({"id": att_id}, {"$set": {"penalty_amount": 0, "leave_deduction": 1}})
        stats_inc = {"total_penalty": -att.get("penalty_amount", 0), "leave_count": 1}
    elif payload.penalty_type == "emergency_quota":
        # Use emergency quota instead of money/leave
        # Verify emergency quota first?
        quota = await emergency_quota(await db.users.find_one({"id": att["user_id"]}))
        if quota["remaining"] <= 0:
            raise HTTPException(status_code=400, detail="Jatah darurat sudah habis")

        await db.attendance.update_one({"id": att_id}, {"$set": {"penalty_amount": 0, "emergency_used": True}})
        stats_inc = {"total_penalty": -att.get("penalty_amount", 0), "emergency_count": 1}

    if stats_inc:
        await bump_user_stats(att["user_id"], month, **stats_inc)

    return {"ok": True, "applied": payload.penalty_type}


@api.post("/attendance/{att_id}/confirm-arrival")
async def confirm_arrival(att_id: str, payload: ArrivalConfirmationIn, actor: Dict = Depends(require_supervisor_or_admin)):
    att = await db.attendance.find_one({"id": att_id})
    if not att or not att.get("manual"):
        raise HTTPException(status_code=404, detail="Manual attendance record not found")

    cfg = await get_config()
    arrival_dt = datetime.fromisoformat(payload.confirmed_arrival_at).replace(tzinfo=WIB)
    check_in_dt = datetime.fromisoformat(att["check_in_at"]).replace(tzinfo=WIB)

    hours_diff = (arrival_dt - check_in_dt).total_seconds() / 3600
    arrival_status = "on_time"
    penalty = 0
    leave_deduction = 0

    if hours_diff > 2:
        # Check if arrived after 14:00
        cutoff_14 = arrival_dt.replace(hour=14, minute=0, second=0, microsecond=0)
        if arrival_dt > cutoff_14:
            arrival_status = "late_penalty"
            penalty = cfg.get("on_time_bonus", 20000)
            leave_deduction = 1
        else:
            arrival_status = "late_no_penalty"  # Within 14:00 but > 2h (requires supervisor discretion)

    await db.attendance.update_one(
        {"id": att_id},
        {
            "$set": {
                "arrival_confirmed_at": arrival_dt.isoformat(),
                "arrival_status": arrival_status,
                "penalty_amount": att.get("penalty_amount", 0) + penalty,
                "leave_deduction": att.get("leave_deduction", 0) + leave_deduction,
            }
        },
    )
    if penalty or leave_deduction:
        await bump_user_stats(att["user_id"], att["date"][:7], total_penalty=penalty, leave_count=leave_deduction)

    return {"status": arrival_status, "penalty": penalty, "leave_deduction": leave_deduction}


@api.get("/attendance/me")
async def my_attendance(limit: int = 30, user: Dict = Depends(get_current_user)):
    today = today_wib_str()
    today_doc = await db.attendance.find_one({"user_id": user["id"], "date": today}, {"_id": 0})
    cursor = db.attendance.find({"user_id": user["id"]}, {"_id": 0}).sort("date", -1).limit(limit)
    history = [d async for d in cursor]
    stats = await db.user_stats.find_one({"user_id": user["id"], "month": month_wib_str()}, {"_id": 0})
    return {"today": today_doc, "history": history, "month_stats": stats or {}}


@api.get("/attendance/reports/export-excel")
async def export_payroll_excel(
    month: Optional[str] = None,
    user: Dict = Depends(require_supervisor_or_admin),
):
    import pandas as pd
    if not month:
        month = month_wib_str()

    query = {"date": {"$regex": f"^{month}"}}
    cursor = db.attendance.find(query).sort("date", 1)
    records = [r async for r in cursor]

    user_ids = list(set(r["user_id"] for r in records))
    users_cursor = db.users.find({"id": {"$in": user_ids}}, {"id": 1, "name": 1, "position": 1})
    user_map = {u["id"]: u async for u in users_cursor}

    df_data = []
    for r in records:
        u = user_map.get(r["user_id"], {})
        df_data.append({
            "Date": r["date"],
            "Name": u.get("name"),
            "Position": u.get("position"),
            "Check In": formatTime(r["check_in_at"]),
            "Check Out": formatTime(r.get("check_out_at")),
            "Late (min)": r.get("late_minutes", 0),
            "Penalty (Rp)": r.get("penalty_amount", 0),
            "OT (min)": r.get("overtime_minutes", 0),
            "Bonus (Rp)": r.get("on_time_bonus", 0),
        })

    df = pd.DataFrame(df_data)
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Payroll")

    output.seek(0)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=payroll_{month}.xlsx"},
    )


@api.get("/attendance/reports/export")
async def export_payroll(
    month: Optional[str] = None,  # YYYY-MM
    access_token: Optional[str] = None,
    user: Dict = Depends(get_current_user),
):
    # Allow token in query param for easier file downloads from frontend
    if access_token:
        try:
            payload = jwt.decode(access_token, JWT_SECRET, algorithms=[JWT_ALG])
            user_id = payload.get("sub")
            user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
        except JWTError:
            raise HTTPException(status_code=401, detail="Invalid token")

    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    if not month:
        month = month_wib_str()

    query = {"date": {"$regex": f"^{month}"}}
    cursor = db.attendance.find(query).sort("date", 1)
    records = [r async for r in cursor]

    # Map user IDs to names/positions
    user_ids = list(set(r["user_id"] for r in records))
    users_cursor = db.users.find({"id": {"$in": user_ids}}, {"id": 1, "name": 1, "position": 1, "division": 1})
    user_map = {u["id"]: u async for u in users_cursor}

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "Date",
            "Name",
            "Position",
            "Division",
            "Check In",
            "Check Out",
            "Status",
            "Late (min)",
            "Penalty (Rp)",
            "Leave Deduct",
            "OT (min)",
            "OT Bonus (Rp)",
            "On-Time Bonus (Rp)",
            "Manual",
            "Verified",
        ]
    )

    for r in records:
        u = user_map.get(r["user_id"], {})
        status_str = "Late" if r.get("is_late") else "On-Time"
        if r.get("early_departure"):
            status_str += " + Early Dep"

        writer.writerow(
            [
                r["date"],
                u.get("name", "Unknown"),
                u.get("position", "-"),
                u.get("division", "-"),
                formatTime(r["check_in_at"]),
                formatTime(r.get("check_out_at")),
                status_str,
                r.get("late_minutes", 0),
                r.get("penalty_amount", 0) + r.get("early_departure_deduction", 0),
                r.get("leave_deduction", 0),
                r.get("overtime_minutes", 0),
                r.get("overtime_amount", 0),
                r.get("on_time_bonus", 0),
                "Yes" if r.get("manual") else "No",
                "Yes" if r.get("liveness_verified") else "No",
            ]
        )

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=payroll_{month}.csv"},
    )


def formatTime(iso_str: Optional[str]) -> str:
    if not iso_str:
        return "-"
    try:
        dt = datetime.fromisoformat(iso_str)
        return dt.strftime("%H:%M")
    except Exception:
        return "-"


@api.get("/attendance/reports")
async def reports(
    period: Optional[Literal["daily", "weekly", "monthly"]] = None,
    is_late: Optional[bool] = None,
    manual: Optional[bool] = None,
    arrival_status: Optional[str] = None,
    user: Dict = Depends(get_current_user),
):
    now = now_wib()
    query = {}
    if period:
        if period == "daily":
            start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        elif period == "weekly":
            start = now - timedelta(days=7)
        else:
            start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        query["created_at"] = {"$gte": start.astimezone(timezone.utc).isoformat()}

    if is_late is not None:
        query["is_late"] = is_late
    if manual is not None:
        query["manual"] = manual
    if arrival_status is not None:
        query["arrival_status"] = arrival_status

    if user["role"] not in ("admin", "supervisor"):
        query["user_id"] = user["id"]

    cursor = db.attendance.find(query, {"_id": 0})
    records = [r async for r in cursor]
    total_penalty = sum(r.get("penalty_amount", 0) + r.get("early_departure_deduction", 0) for r in records)
    total_bonus = sum(r.get("on_time_bonus", 0) for r in records)
    total_ot = sum(r.get("overtime_amount", 0) for r in records)
    late_count = sum(1 for r in records if r.get("is_late"))
    on_time_count = sum(1 for r in records if not r.get("is_late"))

    # Performance Bonuses (Monthly only)
    perf_bonuses = {"remaining_leave_bonus": 0, "monthly_discipline_bonus": 0, "total": 0}
    if period == "monthly":
        cfg = await get_config()
        # Assume 1 user in query if not admin/supervisor, or if user_id in query
        user_id_filt = query.get("user_id")
        if user_id_filt:
            stats = await db.user_stats.find_one({"user_id": user_id_filt, "month": month_wib_str()})
            if stats:
                leave_used = stats.get("leave_count", 0)
                # 1. Remaining Leave Bonus
                quota = cfg.get("monthly_leave_quota_standard", 4)
                remaining = max(0, quota - leave_used)
                perf_bonuses["remaining_leave_bonus"] = remaining * cfg.get("leave_day_bonus_amount", 100000)

                # 2. Monthly Discipline Bonus
                # Condition: leave <= 4, late count within some limit (e.g. within quota), and no other violations
                is_disciplined = (
                    leave_used <= cfg.get("monthly_leave_limit_for_bonus", 4) and
                    late_count <= cfg.get("lateness_monthly_quota", 3)
                )
                if is_disciplined:
                    perf_bonuses["monthly_discipline_bonus"] = cfg.get("monthly_discipline_bonus_amount", 800000)

                perf_bonuses["total"] = perf_bonuses["remaining_leave_bonus"] + perf_bonuses["monthly_discipline_bonus"]

    return {
        "period": period,
        "count": len(records),
        "on_time_count": on_time_count,
        "late_count": late_count,
        "total_penalty": total_penalty,
        "total_bonus": total_bonus,
        "total_overtime": total_ot,
        "performance_bonuses": perf_bonuses,
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


# ---------- Early Departure Approval ----------
@api.get("/early-departure/me")
async def my_early_departures(user: Dict = Depends(get_current_user)):
    cursor = db.early_departure_requests.find({"user_id": user["id"]}, {"_id": 0}).sort("date", -1)
    return [d async for d in cursor]


@api.get("/early-departure/pending")
async def pending_early_departures(_: Dict = Depends(require_supervisor_or_admin)):
    cursor = (
        db.early_departure_requests.find({"status": "pending"}, {"_id": 0}).sort("created_at", 1)
    )
    return [d async for d in cursor]


@api.post("/early-departure/{req_id}/review")
async def review_early_departure(
    req_id: str, payload: EarlyDepartureReviewIn, actor: Dict = Depends(require_supervisor_or_admin)
):
    doc = await db.early_departure_requests.find_one({"id": req_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Permintaan tidak ditemukan")
    if doc["status"] != "pending":
        raise HTTPException(status_code=400, detail="Permintaan sudah direview")

    cfg = await get_config()
    month = doc["date"][:7]  # YYYY-MM
    new_status = "approved" if payload.approve else "rejected"
    deduction = 0
    stats_inc: Dict[str, int] = {}

    if payload.approve:
        # Count current approved early departures in same month for this user
        approved_this_month = await db.early_departure_requests.count_documents(
            {"user_id": doc["user_id"], "status": "approved", "date": {"$regex": f"^{month}"}}
        )
        will_exceed = (approved_this_month + 1) > cfg.get("early_departure_monthly_limit", 3)
        # Also: if requested check-out time was before earliest allowed early-departure time -> deduct
        requested_dt = datetime.fromisoformat(doc["requested_check_out_at"])
        if requested_dt.tzinfo is None:
            requested_dt = requested_dt.replace(tzinfo=WIB)
        earliest_t = parse_hhmm(cfg.get("early_departure_earliest", "17:00"))
        earliest_dt = requested_dt.replace(
            hour=earliest_t.hour, minute=earliest_t.minute, second=0, microsecond=0
        )
        too_early = requested_dt < earliest_dt
        if will_exceed or too_early:
            deduction = cfg.get("on_time_bonus", 0)
        stats_inc = {"early_departure_count": 1}
        if deduction:
            stats_inc["total_penalty"] = deduction
            stats_inc["total_bonus"] = -deduction
    else:
        # Rejected: treated as unauthorized early departure - apply deduction, do NOT increment counter
        deduction = cfg.get("on_time_bonus", 0)
        stats_inc = {"total_penalty": deduction, "total_bonus": -deduction}

    await db.early_departure_requests.update_one(
        {"id": req_id},
        {
            "$set": {
                "status": new_status,
                "reviewed_by": actor["id"],
                "reviewed_by_name": actor["name"],
                "reviewed_at": datetime.now(timezone.utc).isoformat(),
                "review_note": payload.review_note,
                "deduction_applied": deduction,
            }
        },
    )
    # Update attendance record so it reflects final decision
    await db.attendance.update_one(
        {"id": doc["attendance_id"]},
        {"$set": {"early_departure_status": new_status, "early_departure_deduction": deduction}},
    )
    await bump_user_stats(doc["user_id"], month, **stats_inc)

    # Notify the user
    await db.notifications.insert_one(
        {
            "id": str(uuid.uuid4()),
            "user_id": doc["user_id"],
            "division": doc.get("division"),
            "message": f"Pulang cepat {doc['date']} {new_status.upper()} oleh {actor['name']}",
            "read": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    updated = await db.early_departure_requests.find_one({"id": req_id}, {"_id": 0})
    return updated


# ---------- Emergency Quota ----------
def _emergency_period_bounds(cfg: Dict) -> tuple[str, str]:
    """Return (period_start_date, period_end_date) inclusive, based on rolling window ending today."""
    months = int(cfg.get("emergency_quota_period_months", 6))
    end = now_wib().date()
    start_month = end.replace(day=1)
    # Move back (months-1) months
    y = start_month.year
    m = start_month.month - (months - 1)
    while m <= 0:
        m += 12
        y -= 1
    start = start_month.replace(year=y, month=m)
    return start.isoformat(), end.isoformat()


@api.post("/emergency")
async def create_emergency(payload: EmergencyIn, user: Dict = Depends(get_current_user)):
    if not payload.proof_base64 or len(payload.proof_base64) < 50:
        raise HTTPException(status_code=400, detail="Bukti (foto/dokumen) wajib diunggah")
    cfg = await get_config()
    start, end = _emergency_period_bounds(cfg)
    approved_in_period = await db.emergency_requests.count_documents(
        {
            "user_id": user["id"],
            "status": "approved",
            "date": {"$gte": start, "$lte": end},
        }
    )
    pending_in_period = await db.emergency_requests.count_documents(
        {
            "user_id": user["id"],
            "status": "pending",
            "date": {"$gte": start, "$lte": end},
        }
    )
    limit = int(cfg.get("emergency_quota_limit", 2))
    if approved_in_period + pending_in_period >= limit:
        raise HTTPException(
            status_code=400,
            detail=f"Kuota darurat penuh: {approved_in_period} disetujui + {pending_in_period} tertunda (batas {limit}/{cfg.get('emergency_quota_period_months',6)} bulan)",
        )
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "user_name": user["name"],
        "division": user.get("division"),
        "position": user.get("position"),
        "date": payload.date,
        "reason": payload.reason,
        "proof_base64": payload.proof_base64,
        "status": "pending",
        "reviewed_by": None,
        "reviewed_at": None,
        "review_note": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.emergency_requests.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/emergency/me")
async def my_emergencies(user: Dict = Depends(get_current_user)):
    cursor = db.emergency_requests.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1)
    return [d async for d in cursor]


@api.get("/emergency/quota")
async def emergency_quota(user: Dict = Depends(get_current_user)):
    cfg = await get_config()
    start, end = _emergency_period_bounds(cfg)
    approved = await db.emergency_requests.count_documents(
        {"user_id": user["id"], "status": "approved", "date": {"$gte": start, "$lte": end}}
    )
    pending = await db.emergency_requests.count_documents(
        {"user_id": user["id"], "status": "pending", "date": {"$gte": start, "$lte": end}}
    )
    limit = int(cfg.get("emergency_quota_limit", 2))
    return {
        "period_start": start,
        "period_end": end,
        "limit": limit,
        "approved": approved,
        "pending": pending,
        "remaining": max(0, limit - approved - pending),
    }


@api.get("/emergency/pending")
async def pending_emergencies(_: Dict = Depends(require_supervisor_or_admin)):
    cursor = db.emergency_requests.find({"status": "pending"}, {"_id": 0}).sort("created_at", 1)
    return [d async for d in cursor]


@api.post("/emergency/{req_id}/review")
async def review_emergency(
    req_id: str, payload: EmergencyReviewIn, actor: Dict = Depends(require_supervisor_or_admin)
):
    doc = await db.emergency_requests.find_one({"id": req_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Permintaan tidak ditemukan")
    if doc["status"] != "pending":
        raise HTTPException(status_code=400, detail="Permintaan sudah direview")
    new_status = "approved" if payload.approve else "rejected"
    await db.emergency_requests.update_one(
        {"id": req_id},
        {
            "$set": {
                "status": new_status,
                "reviewed_by": actor["id"],
                "reviewed_by_name": actor["name"],
                "reviewed_at": datetime.now(timezone.utc).isoformat(),
                "review_note": payload.review_note,
            }
        },
    )
    if payload.approve:
        month = doc["date"][:7]
        await bump_user_stats(doc["user_id"], month, emergency_count=1)
    await db.notifications.insert_one(
        {
            "id": str(uuid.uuid4()),
            "user_id": doc["user_id"],
            "division": doc.get("division"),
            "message": f"Darurat {doc['date']} {new_status.upper()} oleh {actor['name']}",
            "read": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    return await db.emergency_requests.find_one({"id": req_id}, {"_id": 0})


# ---------- Lateness history ----------
@api.get("/lateness/me")
async def my_lateness(user: Dict = Depends(get_current_user)):
    cfg = await get_config()
    month = month_wib_str()
    cursor = db.attendance.find(
        {"user_id": user["id"], "is_late": True, "date": {"$regex": f"^{month}"}}, {"_id": 0}
    ).sort("date", -1)
    monthly_records = [d async for d in cursor]
    all_cursor = (
        db.attendance.find({"user_id": user["id"], "is_late": True}, {"_id": 0})
        .sort("date", -1)
        .limit(60)
    )
    history = [d async for d in all_cursor]
    quota = int(cfg.get("lateness_monthly_quota", 3))
    used = len(monthly_records)
    return {
        "quota": quota,
        "used_this_month": used,
        "remaining_this_month": max(0, quota - used),
        "history": history,
    }


# ---------- Notifications ----------
@api.get("/notifications")
async def get_notifications(user: Dict = Depends(get_current_user)):
    cursor = db.notifications.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).limit(50)
    return [n async for n in cursor]


@api.post("/activity-logs")
async def create_activity_log(payload: ActivityLogIn, user: Dict = Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "user_name": user["name"],
        "date": today_wib_str(),
        "content": payload.content,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.activity_logs.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/activity-logs/me")
async def my_activity_logs(user: Dict = Depends(get_current_user)):
    cursor = db.activity_logs.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1)
    return [d async for d in cursor]


@api.get("/announcements")
async def get_announcements(_: Dict = Depends(get_current_user)):
    cursor = db.announcements.find({}, {"_id": 0}).sort("created_at", -1).limit(10)
    return [d async for d in cursor]


@api.post("/announcements")
async def create_announcement(payload: AnnouncementCreateIn, _: Dict = Depends(require_supervisor_or_admin)):
    doc = {
        "id": str(uuid.uuid4()),
        "title": payload.title,
        "content": payload.content,
        "is_popup": payload.is_popup,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.announcements.insert_one(doc)
    if payload.send_push:
        # Simulate push notification to everyone
        await db.notifications.insert_many([
            {
                "id": str(uuid.uuid4()),
                "user_id": u["id"],
                "message": f"PENGUMUMAN: {payload.title}",
                "read": False,
                "created_at": datetime.now(timezone.utc).isoformat(),
            } async for u in db.users.find({"active": True}, {"id": 1})
        ])
    return doc


@api.get("/jobs/me")
async def my_jobs(user: Dict = Depends(get_current_user)):
    cursor = db.jobs.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1)
    return [d async for d in cursor]


@api.post("/jobs")
async def create_job(payload: JobCreateIn, _: Dict = Depends(require_supervisor_or_admin)):
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": payload.user_id,
        "title": payload.title,
        "description": payload.description,
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.jobs.insert_one(doc)
    await db.users.update_one({"id": payload.user_id}, {"$set": {"is_available": False}})
    return doc


@api.put("/jobs/{job_id}")
async def update_job(job_id: str, payload: JobUpdateIn, user: Dict = Depends(get_current_user)):
    job = await db.jobs.find_one({"id": job_id})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    updates = {"status": payload.status}
    if payload.status == "started":
        updates["started_at"] = datetime.now(timezone.utc).isoformat()
        updates["proof_start"] = payload.proof_base64
    elif payload.status == "completed":
        updates["completed_at"] = datetime.now(timezone.utc).isoformat()
        updates["proof_end"] = payload.proof_base64

        # Auto-set available if back at warehouse (simulation)
        # In real app we'd check distance to warehouse
        await db.users.update_one({"id": job["user_id"]}, {"$set": {"is_available": True}})

    await db.jobs.update_one({"id": job_id}, {"$set": updates})
    return {"ok": True}


@api.get("/monitoring/couriers")
async def monitoring_couriers(_: Dict = Depends(require_supervisor_or_admin)):
    cursor = db.users.find(
        {"role": "user", "position": {"$regex": "Kurir", "$options": "i"}},
        {"_id": 0, "password_hash": 0}
    )
    return [u async for u in cursor]


@api.post("/monitoring/couriers/{user_id}/status")
async def override_courier_status(user_id: str, payload: Dict[str, bool], _: Dict = Depends(require_supervisor_or_admin)):
    available = payload.get("is_available", True)
    await db.users.update_one({"id": user_id}, {"$set": {"is_available": available}})
    return {"ok": True}


@api.post("/users/me/location")
async def update_my_location(payload: Dict[str, float], user: Dict = Depends(get_current_user)):
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"last_lat": payload.get("latitude"), "last_lng": payload.get("longitude")}}
    )
    return {"ok": True}


@api.get("/documents/me")
async def my_documents(user: Dict = Depends(get_current_user)):
    # Simulation of payslips
    return [
        {
            "id": "payslip-01",
            "title": f"Slip Gaji {month_wib_str()}",
            "type": "payslip",
            "url": "https://example.com/payslip.pdf",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    ]


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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
