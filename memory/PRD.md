# Absenlah — PRD

## Overview
Enterprise mobile attendance app for warehouses/logistics teams in Indonesia. Bilingual (ID default, EN toggleable). GPS/geofenced check-in, dynamic rule engine driving penalty/bonus/overtime, leave workflow with division visibility, and admin control panel.

## Users
- **Admin**: full control (users, warehouses, rules, regulations)
- **Supervisor**: can approve manual attendance for emergencies
- **User** (Karyawan): daily check-in/out, leave requests

## Features (MVP shipped)
- **Auth**: JWT + bcrypt. Default admin `administrator/admin123` with forced password change on first login.
- **Home / Check-in**: live clock, GPS+geofence validation vs assigned warehouse, big check-in / check-out CTA, today's status with bonus/penalty/overtime breakdown, monthly summary.
- **My History (Attendance tab)**: chips [Absensi | Terlambat | Pulang Cepat | Darurat]
  - *Absensi*: full daily history with bonus/penalty/overtime tier labels
  - *Terlambat*: lateness quota card (used_this_month / lateness_monthly_quota / remaining) + progress bar + late history
  - *Pulang Cepat*: early departure requests with status pill (pending/approved/rejected), reviewer, deduction if any
  - *Darurat*: emergency quota card (approved/limit/remaining in current rolling 6-month window) + history with proof viewer
- **Emergency Quota**: rolling `emergency_quota_period_months` window, `emergency_quota_limit` limit. Request requires photo/document proof (base64). Approval workflow. Blocked at creation if quota full.
- **Early Departure Approval**: check-out no longer auto-finalizes. It creates a `pending` request. Supervisor approves → `user_stats.early_departure_count` increments; if exceeding monthly limit, `on_time_bonus` deducted. Rejects → deduction applied but counter NOT incremented (unauthorized).
- **Leave**: request ≥2h before shift, conflict check by same position, division-only visibility, H-1 cancellation, auto in-app notifications on submit/cancel.
- **Reports**: daily / weekly / monthly rollups.
- **Admin Panel**: users CRUD (role/position/division/warehouse assignment, reset password), warehouses CRUD with **"Gunakan Lokasi Saat Ini"** button, Dynamic Rule Engine (all rules including new `lateness_monthly_quota`, `emergency_quota_period_months`, `emergency_quota_limit`), Regulations editor.
- **Supervisor**: **Kotak Persetujuan** (approvals inbox) with tabs Early Departure / Emergency (proof preview modal). Manual attendance for courier emergency (2h arrival limit).
- **i18n**: Bahasa Indonesia default, English toggleable.

## Dynamic Rule Engine
All rules stored in `config` collection (single `id: "global"` doc). Business logic reads config in real-time — no restart or code change needed. Changing e.g. `on_time_bonus` from Rp20.000 to Rp25.000 immediately affects the next check-in outcome.

## Data Model (Mongo collections)
- `users` — id, username, name, password_hash, role, position, division, warehouse_id, must_change_password, active
- `warehouses` — id, name, address, latitude, longitude, radius_m
- `config` — global rules doc (includes new: lateness_monthly_quota, emergency_quota_period_months, emergency_quota_limit)
- `attendance` — id, user_id, date, check_in_at, check_out_at, warehouse_id, coords, is_late, late_minutes, penalty_amount, late_tier, on_time_bonus, effective_shift_end, is_early_check_in, overtime_minutes, overtime_amount, **early_departure**, **early_departure_status** (pending/approved/rejected), **early_departure_request_id**, early_departure_deduction, manual, manual_reason, approved_by
- `early_departure_requests` — id, user_id, user_name, division, position, attendance_id, date, requested_check_out_at, status (pending/approved/rejected), reviewed_by, reviewed_by_name, reviewed_at, review_note, deduction_applied
- `emergency_requests` — id, user_id, user_name, division, position, date, reason, proof_base64, status, reviewed_by, reviewed_by_name, reviewed_at, review_note
- `leave_requests` — id, user_id, user_name, position, division, date, reason, status
- `user_stats` — user_id, month (YYYY-MM), leave_count, early_departure_count, **emergency_count**, total_bonus, total_penalty, total_overtime  *(counters only increment on approval)*
- `regulations` — global doc with markdown content
- `notifications` — id, user_id, division, message, read

## Phase 4 (Deployment)
See `/app/DEPLOYMENT.md` for self-hosted Pocketbase/Docker/Nginx tutorial and Google Play Store roadmap.

## Not shipped (deliberately deferred)
- Push notifications (in-app notifications feed instead)
- Offline mode
- Photo capture on check-in
- Multi-tenant/org support
