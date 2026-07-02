"""Absenlah backend test suite iteration 2 — Early Departure + Emergency approval workflow + Lateness history + Config new fields.

Uses direct DB seeding via backend endpoints where possible. Some tests use motor via MONGO_URL
to seed deterministic docs (bypasses time-of-day dependency of check-out flow).
"""
import os
import sys
import uuid
import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

# Load backend .env for MONGO_URL
load_dotenv(Path("/app/backend/.env"))

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://absenlah-attendance.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
WIB = timezone(timedelta(hours=7))

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ.get("DB_NAME", "test_database")

STATE = {"admin_token": None, "supervisor_token": None, "budi_token": None, "budi_id": None}


def _login(u, p):
    return requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=15)


def _auth(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module", autouse=True)
def bootstrap():
    # Login admin (try common creds)
    for pwd in ("admin123", "admin1234"):
        r = _login("administrator", pwd)
        if r.status_code == 200:
            STATE["admin_token"] = r.json()["access_token"]
            break
    assert STATE["admin_token"], "Admin login failed"
    r = _login("siti", "siti123")
    assert r.status_code == 200, r.text
    STATE["supervisor_token"] = r.json()["access_token"]
    r = _login("budi", "budi123")
    assert r.status_code == 200, r.text
    STATE["budi_token"] = r.json()["access_token"]
    STATE["budi_id"] = r.json()["user"]["id"]
    yield


# ---------- Async db helper ----------
def run_async(coro):
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            raise RuntimeError()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


async def _db():
    return AsyncIOMotorClient(MONGO_URL)[DB_NAME]


# ---------- Config ----------
class TestConfigNewFields:
    def test_get_config_has_new_fields(self):
        r = requests.get(f"{API}/config", headers=_auth(STATE["admin_token"]), timeout=10)
        assert r.status_code == 200
        cfg = r.json()
        assert cfg.get("lateness_monthly_quota") == 3
        assert cfg.get("emergency_quota_period_months") == 6
        assert cfg.get("emergency_quota_limit") == 2

    def test_put_config_persists_new_fields(self):
        r = requests.get(f"{API}/config", headers=_auth(STATE["admin_token"]), timeout=10)
        cfg = r.json()
        cfg.pop("updated_at", None); cfg.pop("id", None)
        cfg["lateness_monthly_quota"] = 5
        cfg["emergency_quota_period_months"] = 12
        cfg["emergency_quota_limit"] = 4
        r2 = requests.put(f"{API}/config", headers=_auth(STATE["admin_token"]), json=cfg, timeout=10)
        assert r2.status_code == 200, r2.text
        got = r2.json()
        assert got["lateness_monthly_quota"] == 5
        assert got["emergency_quota_period_months"] == 12
        assert got["emergency_quota_limit"] == 4
        # revert
        cfg["lateness_monthly_quota"] = 3
        cfg["emergency_quota_period_months"] = 6
        cfg["emergency_quota_limit"] = 2
        r3 = requests.put(f"{API}/config", headers=_auth(STATE["admin_token"]), json=cfg, timeout=10)
        assert r3.status_code == 200


# ---------- Early Departure Approval workflow ----------
class TestEarlyDepartureApproval:
    """Uses direct DB inserts to deterministically test approval endpoints."""

    def setup_method(self, _):
        self.req_id = str(uuid.uuid4())
        self.att_id = str(uuid.uuid4())
        today = datetime.now(WIB).strftime("%Y-%m-%d")
        self.today = today
        async def seed():
            db = await _db()
            # Clean prior test docs for budi (any early_departure_requests, any month)
            await db.early_departure_requests.delete_many({"user_id": STATE["budi_id"]})
            await db.attendance.delete_many({"id": self.att_id})
            # Reset user_stats for this month for deterministic counters
            await db.user_stats.delete_one({"user_id": STATE["budi_id"], "month": today[:7]})
            await db.attendance.insert_one({
                "id": self.att_id, "user_id": STATE["budi_id"], "date": today,
                "is_early_check_in": False, "early_departure": True,
                "early_departure_status": "pending", "penalty_amount": 0, "on_time_bonus": 20000,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            await db.early_departure_requests.insert_one({
                "id": self.req_id, "user_id": STATE["budi_id"], "user_name": "Budi Santoso",
                "division": "Logistik", "position": "Kurir", "attendance_id": self.att_id,
                "date": today, "requested_check_out_at": datetime.now(WIB).replace(hour=18, minute=0).isoformat(),
                "reason": "TEST_ED", "status": "pending", "reviewed_by": None,
                "reviewed_at": None, "deduction_applied": 0,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        run_async(seed())

    def test_get_me_returns_pending(self):
        r = requests.get(f"{API}/early-departure/me", headers=_auth(STATE["budi_token"]), timeout=10)
        assert r.status_code == 200
        arr = r.json()
        assert any(d["id"] == self.req_id and d["status"] == "pending" for d in arr)

    def test_pending_forbidden_for_user(self):
        r = requests.get(f"{API}/early-departure/pending", headers=_auth(STATE["budi_token"]), timeout=10)
        assert r.status_code == 403

    def test_pending_visible_to_supervisor(self):
        r = requests.get(f"{API}/early-departure/pending", headers=_auth(STATE["supervisor_token"]), timeout=10)
        assert r.status_code == 200
        assert any(d["id"] == self.req_id for d in r.json())

    def test_approve_increments_counter_no_deduction(self):
        # Snapshot user stats before
        month = self.today[:7]
        async def get_stats():
            db = await _db()
            return await db.user_stats.find_one({"user_id": STATE["budi_id"], "month": month}) or {}
        before = run_async(get_stats())
        before_count = before.get("early_departure_count", 0)
        before_penalty = before.get("total_penalty", 0)

        r = requests.post(
            f"{API}/early-departure/{self.req_id}/review",
            headers=_auth(STATE["supervisor_token"]),
            json={"approve": True, "review_note": "OK"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "approved"

        after = run_async(get_stats())
        assert after.get("early_departure_count", 0) == before_count + 1
        # 18:00 is after earliest 17:00 and within 3/month limit → no deduction
        assert body.get("deduction_applied", 0) == 0
        assert after.get("total_penalty", 0) == before_penalty

        # Attendance updated
        async def get_att():
            db = await _db()
            return await db.attendance.find_one({"id": self.att_id})
        att = run_async(get_att())
        assert att["early_departure_status"] == "approved"

        # Notification created
        async def get_notifs():
            db = await _db()
            return [n async for n in db.notifications.find({"user_id": STATE["budi_id"]}).sort("created_at", -1).limit(3)]
        notifs = run_async(get_notifs())
        assert any("APPROVED" in n["message"] for n in notifs)

    def test_reject_applies_deduction_no_counter_and_double_review(self):
        month = self.today[:7]
        async def get_stats():
            db = await _db()
            return await db.user_stats.find_one({"user_id": STATE["budi_id"], "month": month}) or {}
        before = run_async(get_stats())
        r = requests.post(
            f"{API}/early-departure/{self.req_id}/review",
            headers=_auth(STATE["supervisor_token"]),
            json={"approve": False, "review_note": "no"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "rejected"
        assert body.get("deduction_applied", 0) == 20000  # on_time_bonus default
        after = run_async(get_stats())
        assert after.get("early_departure_count", 0) == before.get("early_departure_count", 0)
        assert after.get("total_penalty", 0) - before.get("total_penalty", 0) == 20000
        assert after.get("total_bonus", 0) - before.get("total_bonus", 0) == -20000

        # Double review of same request should 400
        r2 = requests.post(
            f"{API}/early-departure/{self.req_id}/review",
            headers=_auth(STATE["supervisor_token"]),
            json={"approve": True},
            timeout=10,
        )
        assert r2.status_code == 400


class TestEarlyDepartureOverLimit:
    """Approving 4th in same month with limit=3 must apply deduction."""

    def test_fourth_approval_applies_deduction(self):
        month = datetime.now(WIB).strftime("%Y-%m")
        today = datetime.now(WIB).strftime("%Y-%m-%d")
        req_ids = [str(uuid.uuid4()) for _ in range(4)]
        att_ids = [str(uuid.uuid4()) for _ in range(4)]

        async def seed():
            db = await _db()
            # Clean any TEST_ED_LIMIT prior AND any approved edr for budi this month so count starts at 0
            await db.early_departure_requests.delete_many({"user_id": STATE["budi_id"]})
            await db.user_stats.delete_one({"user_id": STATE["budi_id"], "month": month})
            for i in range(4):
                await db.attendance.insert_one({
                    "id": att_ids[i], "user_id": STATE["budi_id"], "date": today,
                    "is_early_check_in": False, "early_departure": True,
                    "early_departure_status": "pending", "penalty_amount": 0, "on_time_bonus": 20000,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
                await db.early_departure_requests.insert_one({
                    "id": req_ids[i], "user_id": STATE["budi_id"], "user_name": "Budi",
                    "division": "Logistik", "position": "Kurir", "attendance_id": att_ids[i],
                    "date": today,
                    "requested_check_out_at": datetime.now(WIB).replace(hour=18, minute=0).isoformat(),
                    "reason": "TEST_ED_LIMIT", "status": "pending",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
        run_async(seed())

        # Approve first 3 → no deduction
        for i in range(3):
            r = requests.post(f"{API}/early-departure/{req_ids[i]}/review",
                              headers=_auth(STATE["supervisor_token"]),
                              json={"approve": True}, timeout=10)
            assert r.status_code == 200, r.text
            assert r.json()["deduction_applied"] == 0

        # 4th approval → deduction applies
        r = requests.post(f"{API}/early-departure/{req_ids[3]}/review",
                          headers=_auth(STATE["supervisor_token"]),
                          json={"approve": True}, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "approved"
        assert body["deduction_applied"] == 20000

        # Cleanup
        async def cleanup():
            db = await _db()
            await db.early_departure_requests.delete_many({"reason": "TEST_ED_LIMIT"})
            await db.attendance.delete_many({"id": {"$in": att_ids}})
            await db.user_stats.delete_one({"user_id": STATE["budi_id"], "month": month})
        run_async(cleanup())


# ---------- Emergency Quota workflow ----------
class TestEmergency:
    VALID_PROOF = "data:image/png;base64," + ("A" * 200)

    def setup_method(self, _):
        # Clean existing budi emergency docs
        async def clean():
            db = await _db()
            await db.emergency_requests.delete_many({"user_id": STATE["budi_id"]})
        run_async(clean())

    def test_reject_empty_proof(self):
        r = requests.post(f"{API}/emergency", headers=_auth(STATE["budi_token"]),
                          json={"date": datetime.now(WIB).strftime("%Y-%m-%d"),
                                "reason": "TEST", "proof_base64": ""}, timeout=10)
        assert r.status_code == 400
        assert "bukti" in r.json().get("detail", "").lower() or "wajib" in r.json().get("detail", "").lower()

    def test_create_and_me_and_quota(self):
        today = datetime.now(WIB).strftime("%Y-%m-%d")
        r = requests.post(f"{API}/emergency", headers=_auth(STATE["budi_token"]),
                          json={"date": today, "reason": "TEST darurat",
                                "proof_base64": self.VALID_PROOF}, timeout=10)
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["status"] == "pending"

        r2 = requests.get(f"{API}/emergency/me", headers=_auth(STATE["budi_token"]), timeout=10)
        assert r2.status_code == 200
        assert any(d["id"] == created["id"] for d in r2.json())

        r3 = requests.get(f"{API}/emergency/quota", headers=_auth(STATE["budi_token"]), timeout=10)
        assert r3.status_code == 200
        q = r3.json()
        assert q["limit"] == 2
        assert q["approved"] == 0
        assert q["pending"] == 1
        assert q["remaining"] == 1

    def test_quota_full_rejects_new(self):
        today = datetime.now(WIB).strftime("%Y-%m-%d")
        # First create 2 emergencies to fill quota
        for i in range(2):
            r = requests.post(f"{API}/emergency", headers=_auth(STATE["budi_token"]),
                              json={"date": today, "reason": f"TEST {i}",
                                    "proof_base64": self.VALID_PROOF}, timeout=10)
            assert r.status_code == 200, r.text
        # 3rd should be rejected
        r = requests.post(f"{API}/emergency", headers=_auth(STATE["budi_token"]),
                          json={"date": today, "reason": "TEST over",
                                "proof_base64": self.VALID_PROOF}, timeout=10)
        assert r.status_code == 400
        assert "kuota" in r.json().get("detail", "").lower()

    def test_pending_forbidden_for_user_accessible_supervisor(self):
        today = datetime.now(WIB).strftime("%Y-%m-%d")
        requests.post(f"{API}/emergency", headers=_auth(STATE["budi_token"]),
                      json={"date": today, "reason": "TEST", "proof_base64": self.VALID_PROOF}, timeout=10)

        r = requests.get(f"{API}/emergency/pending", headers=_auth(STATE["budi_token"]), timeout=10)
        assert r.status_code == 403

        r2 = requests.get(f"{API}/emergency/pending", headers=_auth(STATE["supervisor_token"]), timeout=10)
        assert r2.status_code == 200
        assert isinstance(r2.json(), list)

    def test_review_approve_and_reject(self):
        today = datetime.now(WIB).strftime("%Y-%m-%d")
        r = requests.post(f"{API}/emergency", headers=_auth(STATE["budi_token"]),
                          json={"date": today, "reason": "TEST approve",
                                "proof_base64": self.VALID_PROOF}, timeout=10)
        assert r.status_code == 200
        rid_a = r.json()["id"]
        # Second one for reject
        r2 = requests.post(f"{API}/emergency", headers=_auth(STATE["budi_token"]),
                           json={"date": today, "reason": "TEST reject",
                                 "proof_base64": self.VALID_PROOF}, timeout=10)
        assert r2.status_code == 200
        rid_r = r2.json()["id"]

        month = today[:7]
        async def get_stats():
            db = await _db()
            return await db.user_stats.find_one({"user_id": STATE["budi_id"], "month": month}) or {}
        before = run_async(get_stats())
        before_e = before.get("emergency_count", 0)

        r3 = requests.post(f"{API}/emergency/{rid_a}/review",
                           headers=_auth(STATE["supervisor_token"]),
                           json={"approve": True}, timeout=10)
        assert r3.status_code == 200, r3.text
        assert r3.json()["status"] == "approved"
        after = run_async(get_stats())
        assert after.get("emergency_count", 0) == before_e + 1

        r4 = requests.post(f"{API}/emergency/{rid_r}/review",
                           headers=_auth(STATE["supervisor_token"]),
                           json={"approve": False, "review_note": "no proof"},
                           timeout=10)
        assert r4.status_code == 200
        assert r4.json()["status"] == "rejected"
        after2 = run_async(get_stats())
        # No further increment on reject
        assert after2.get("emergency_count", 0) == after.get("emergency_count", 0)


# ---------- Lateness ----------
class TestLatenessMe:
    def test_returns_quota_and_history(self):
        r = requests.get(f"{API}/lateness/me", headers=_auth(STATE["budi_token"]), timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body["quota"] == 3
        assert "used_this_month" in body
        assert "remaining_this_month" in body
        assert isinstance(body.get("history"), list)
        assert body["remaining_this_month"] == max(0, 3 - body["used_this_month"])
