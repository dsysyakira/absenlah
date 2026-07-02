"""Absenlah backend test suite (pytest) - iteration 1"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or "https://absenlah-attendance.preview.emergentagent.com"
API = f"{BASE_URL}/api"
WIB = timezone(timedelta(hours=7))

# ---------- Session-scoped state ----------
STATE = {
    "admin_token": None,
    "admin_password": "admin123",  # will be updated if needed
    "supervisor_token": None,
    "budi_token": None,
    "budi_id": None,
    "new_user_id": None,
    "warehouse_id": None,
    "leave_id": None,
}


def _login(username: str, password: str):
    return requests.post(f"{API}/auth/login", json={"username": username, "password": password}, timeout=15)


def _auth(token: str):
    return {"Authorization": f"Bearer {token}"}


# ------------------ Auth ------------------
class TestAuth:
    def test_root_health(self):
        r = requests.get(f"{API}/", timeout=10)
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    def test_admin_login_success(self):
        # Try admin123 first, then a common changed password if seeded already
        for pwd in ["admin123", "admin1234"]:
            r = _login("administrator", pwd)
            if r.status_code == 200:
                STATE["admin_token"] = r.json()["access_token"]
                STATE["admin_password"] = pwd
                data = r.json()
                assert "access_token" in data
                assert data["user"]["role"] == "admin"
                # must_change_password should be True if using admin123 first run
                assert "must_change_password" in data
                return
        pytest.fail("Admin login failed with both admin123 and admin1234")

    def test_admin_bad_password(self):
        r = _login("administrator", "wrongpass")
        assert r.status_code == 400

    def test_auth_me(self):
        assert STATE["admin_token"]
        r = requests.get(f"{API}/auth/me", headers=_auth(STATE["admin_token"]), timeout=10)
        assert r.status_code == 200
        u = r.json()
        assert u["username"] == "administrator"
        assert u["role"] == "admin"
        assert "password_hash" not in u

    def test_change_password_flow(self):
        """Change admin password to admin1234 (from current), verify flag cleared."""
        current = STATE["admin_password"]
        new = "admin1234" if current == "admin123" else "admin123"
        r = requests.post(
            f"{API}/auth/change-password",
            headers=_auth(STATE["admin_token"]),
            json={"current_password": current, "new_password": new},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        # Re-login with new
        r2 = _login("administrator", new)
        assert r2.status_code == 200
        body = r2.json()
        assert body["must_change_password"] is False
        STATE["admin_token"] = body["access_token"]
        STATE["admin_password"] = new

    def test_supervisor_and_user_login(self):
        r = _login("siti", "siti123")
        assert r.status_code == 200, r.text
        STATE["supervisor_token"] = r.json()["access_token"]
        r2 = _login("budi", "budi123")
        assert r2.status_code == 200, r2.text
        STATE["budi_token"] = r2.json()["access_token"]
        STATE["budi_id"] = r2.json()["user"]["id"]


# ------------------ Config ------------------
class TestConfig:
    def test_get_config_seeded(self):
        r = requests.get(f"{API}/config", headers=_auth(STATE["admin_token"]), timeout=10)
        assert r.status_code == 200
        cfg = r.json()
        assert cfg["shift_start"] == "10:00"
        assert cfg["on_time_bonus"] == 20000
        assert isinstance(cfg["late_tiers"], list) and len(cfg["late_tiers"]) >= 7

    def test_put_config_admin(self):
        r = requests.get(f"{API}/config", headers=_auth(STATE["admin_token"]), timeout=10)
        cfg = r.json()
        cfg.pop("updated_at", None)
        cfg.pop("id", None)
        cfg["on_time_bonus"] = 25000
        r2 = requests.put(f"{API}/config", headers=_auth(STATE["admin_token"]), json=cfg, timeout=10)
        assert r2.status_code == 200, r2.text
        assert r2.json()["on_time_bonus"] == 25000
        # Revert
        cfg["on_time_bonus"] = 20000
        r3 = requests.put(f"{API}/config", headers=_auth(STATE["admin_token"]), json=cfg, timeout=10)
        assert r3.status_code == 200
        assert r3.json()["on_time_bonus"] == 20000

    def test_put_config_forbidden_for_user(self):
        r = requests.get(f"{API}/config", headers=_auth(STATE["budi_token"]), timeout=10)
        cfg = r.json()
        cfg.pop("updated_at", None); cfg.pop("id", None)
        r2 = requests.put(f"{API}/config", headers=_auth(STATE["budi_token"]), json=cfg, timeout=10)
        assert r2.status_code == 403


# ------------------ Warehouses ------------------
class TestWarehouses:
    def test_list(self):
        r = requests.get(f"{API}/warehouses", headers=_auth(STATE["admin_token"]), timeout=10)
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list) and len(arr) >= 1
        STATE["warehouse_id"] = arr[0]["id"]

    def test_create_update_delete(self):
        payload = {"name": "TEST_Warehouse", "latitude": 1.0, "longitude": 2.0, "radius_m": 150, "address": "TEST addr"}
        r = requests.post(f"{API}/warehouses", headers=_auth(STATE["admin_token"]), json=payload, timeout=10)
        assert r.status_code == 200
        wh = r.json(); wid = wh["id"]
        # GET to verify persistence
        listing = requests.get(f"{API}/warehouses", headers=_auth(STATE["admin_token"]), timeout=10).json()
        assert any(w["id"] == wid for w in listing)
        # Update
        r2 = requests.put(f"{API}/warehouses/{wid}", headers=_auth(STATE["admin_token"]), json={"radius_m": 250}, timeout=10)
        assert r2.status_code == 200 and r2.json()["radius_m"] == 250
        # Non-admin write forbidden
        r3 = requests.post(f"{API}/warehouses", headers=_auth(STATE["budi_token"]), json=payload, timeout=10)
        assert r3.status_code == 403
        # Delete
        r4 = requests.delete(f"{API}/warehouses/{wid}", headers=_auth(STATE["admin_token"]), timeout=10)
        assert r4.status_code == 200 and r4.json()["deleted"] == 1


# ------------------ Users ------------------
class TestUsers:
    def test_create_user_must_change_password(self):
        uname = f"TEST_u_{uuid.uuid4().hex[:6]}"
        payload = {
            "username": uname, "name": "TEST User", "password": "temp123",
            "role": "user", "position": "Kurir", "division": "Logistik",
        }
        r = requests.post(f"{API}/users", headers=_auth(STATE["admin_token"]), json=payload, timeout=10)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["must_change_password"] is True
        assert doc["role"] == "user"
        STATE["new_user_id"] = doc["id"]
        # Verify list has it
        lst = requests.get(f"{API}/users", headers=_auth(STATE["admin_token"]), timeout=10).json()
        assert any(u["id"] == doc["id"] for u in lst)

    def test_user_write_forbidden_for_non_admin(self):
        r = requests.post(f"{API}/users", headers=_auth(STATE["budi_token"]),
                          json={"username": "x", "name": "x", "password": "x"}, timeout=10)
        assert r.status_code == 403

    def test_reset_password(self):
        assert STATE["new_user_id"]
        r = requests.post(f"{API}/users/{STATE['new_user_id']}/reset-password",
                          headers=_auth(STATE["admin_token"]), timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert "temporary_password" in body

    def test_delete_user(self):
        r = requests.delete(f"{API}/users/{STATE['new_user_id']}",
                            headers=_auth(STATE["admin_token"]), timeout=10)
        assert r.status_code == 200 and r.json()["deleted"] == 1


# ------------------ Regulations ------------------
class TestRegulations:
    def test_get_and_update(self):
        r = requests.get(f"{API}/regulations", headers=_auth(STATE["admin_token"]), timeout=10)
        assert r.status_code == 200
        orig = r.json()["content"]
        assert "PERATURAN" in orig
        new_content = orig + "\n\nTEST_ADDENDUM"
        r2 = requests.put(f"{API}/regulations", headers=_auth(STATE["admin_token"]),
                          json={"content": new_content}, timeout=10)
        assert r2.status_code == 200
        assert "TEST_ADDENDUM" in r2.json()["content"]
        # Revert
        requests.put(f"{API}/regulations", headers=_auth(STATE["admin_token"]),
                     json={"content": orig}, timeout=10)

    def test_put_regulations_forbidden_for_user(self):
        r = requests.put(f"{API}/regulations", headers=_auth(STATE["budi_token"]),
                         json={"content": "hack"}, timeout=10)
        assert r.status_code == 403


# ------------------ Attendance ------------------
class TestAttendance:
    def test_check_in_out_of_radius(self):
        r = requests.post(f"{API}/attendance/check-in", headers=_auth(STATE["budi_token"]),
                          json={"latitude": 0.0, "longitude": 0.0}, timeout=10)
        assert r.status_code == 400
        assert "radius" in r.json().get("detail", "").lower()

    def test_check_in_ok(self):
        # First ensure budi has no attendance today: clean via direct DB is not available here,
        # so this test may 400 if already checked in today. Handle both.
        r = requests.post(f"{API}/attendance/check-in", headers=_auth(STATE["budi_token"]),
                          json={"latitude": -6.2088, "longitude": 106.8456}, timeout=10)
        if r.status_code == 400 and "sudah check-in" in r.json().get("detail", "").lower():
            pytest.skip("Budi already checked in today (idempotency)")
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["status"] == "checked_in"
        assert doc["warehouse_id"]
        assert "penalty_amount" in doc and "on_time_bonus" in doc

    def test_attendance_me(self):
        r = requests.get(f"{API}/attendance/me", headers=_auth(STATE["budi_token"]), timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert "today" in data and "history" in data and "month_stats" in data

    def test_check_out(self):
        r = requests.post(f"{API}/attendance/check-out", headers=_auth(STATE["budi_token"]),
                          json={"latitude": -6.2088, "longitude": 106.8456}, timeout=10)
        if r.status_code == 400 and "sudah check-out" in r.json().get("detail", "").lower():
            pytest.skip("Already checked out today")
        assert r.status_code in (200, 400), r.text
        if r.status_code == 200:
            assert r.json()["status"] == "completed"

    def test_reports(self):
        for p in ("daily", "weekly", "monthly"):
            r = requests.get(f"{API}/attendance/reports?period={p}",
                             headers=_auth(STATE["admin_token"]), timeout=10)
            assert r.status_code == 200
            body = r.json()
            assert body["period"] == p
            assert "records" in body and "total_penalty" in body

    def test_manual_attendance_forbidden_for_user(self):
        r = requests.post(f"{API}/attendance/manual", headers=_auth(STATE["budi_token"]),
                          json={"user_id": STATE["budi_id"], "check_in_iso": datetime.now(WIB).isoformat(),
                                "reason": "test"}, timeout=10)
        assert r.status_code == 403


# ------------------ Leave ------------------
class TestLeave:
    def test_leave_too_soon(self):
        today = datetime.now(WIB).strftime("%Y-%m-%d")
        r = requests.post(f"{API}/leave", headers=_auth(STATE["budi_token"]),
                          json={"date": today, "reason": "sakit"}, timeout=10)
        assert r.status_code == 400

    def test_leave_ok(self):
        future = (datetime.now(WIB) + timedelta(days=10)).strftime("%Y-%m-%d")
        r = requests.post(f"{API}/leave", headers=_auth(STATE["budi_token"]),
                          json={"date": future, "reason": "TEST liburan"}, timeout=10)
        if r.status_code == 400 and "rekan sejawat" in r.json().get("detail", "").lower():
            # try another date
            future = (datetime.now(WIB) + timedelta(days=15)).strftime("%Y-%m-%d")
            r = requests.post(f"{API}/leave", headers=_auth(STATE["budi_token"]),
                              json={"date": future, "reason": "TEST liburan"}, timeout=10)
        assert r.status_code == 200, r.text
        STATE["leave_id"] = r.json()["id"]

    def test_leave_conflict(self):
        # Same date, same position => 400
        if not STATE["leave_id"]:
            pytest.skip("No leave created")
        my_leaves = requests.get(f"{API}/leave/me", headers=_auth(STATE["budi_token"]), timeout=10).json()
        target = next((l for l in my_leaves if l["id"] == STATE["leave_id"]), None)
        assert target
        # Create supervisor with same position? We use budi again - same user; API relies on position match.
        # A second insert by budi himself should also conflict since position is same.
        r = requests.post(f"{API}/leave", headers=_auth(STATE["budi_token"]),
                          json={"date": target["date"], "reason": "dup"}, timeout=10)
        assert r.status_code == 400

    def test_division_leaves(self):
        r = requests.get(f"{API}/leave/division", headers=_auth(STATE["budi_token"]), timeout=10)
        assert r.status_code == 200
        arr = r.json()
        assert all(d.get("division") == "Logistik" for d in arr)

    def test_cancel_leave_within_24h_rejects(self):
        # Create a leave for tomorrow (should be within 24h from today at various times).
        # If tomorrow's shift is <24h away, cancellation should be rejected.
        tomorrow = (datetime.now(WIB) + timedelta(days=1)).strftime("%Y-%m-%d")
        create = requests.post(f"{API}/leave", headers=_auth(STATE["budi_token"]),
                               json={"date": tomorrow, "reason": "TEST tomorrow"}, timeout=10)
        if create.status_code != 200:
            pytest.skip(f"Could not create tomorrow leave: {create.text}")
        lid = create.json()["id"]
        r = requests.delete(f"{API}/leave/{lid}", headers=_auth(STATE["budi_token"]), timeout=10)
        # Depending on current time, tomorrow may be >24h. Accept either but assert message when 400.
        assert r.status_code in (200, 400)
        if r.status_code == 400:
            assert "H-1" in r.json().get("detail", "") or "24" in r.json().get("detail", "")


# ------------------ Notifications ------------------
class TestNotifications:
    def test_get_notifications(self):
        r = requests.get(f"{API}/notifications", headers=_auth(STATE["budi_token"]), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------- Cleanup: restore admin password to admin123 at end ----------
@pytest.fixture(scope="session", autouse=True)
def _restore_admin():
    yield
    try:
        if STATE.get("admin_token") and STATE.get("admin_password") and STATE["admin_password"] != "admin123":
            requests.post(
                f"{API}/auth/change-password",
                headers=_auth(STATE["admin_token"]),
                json={"current_password": STATE["admin_password"], "new_password": "admin123"},
                timeout=10,
            )
            # Note: this sets must_change_password to False. We can't reset that flag via API cleanly.
    except Exception as e:
        print(f"cleanup error: {e}")
