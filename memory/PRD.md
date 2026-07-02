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
- **Attendance History**: chronological list with tier labels and Rupiah amounts.
- **Leave**: request (>=2h before shift, conflict check by same position on same date), cancel (H-1), Leave Information Center filtered by division, auto notification to division on submit/cancel.
- **Reports**: daily / weekly / monthly rollups (on-time, late, bonus, penalty, overtime).
- **Admin Panel**: users CRUD (role, position, division, warehouse assignment, reset password), warehouses CRUD (GPS + radius), Dynamic Rule Engine (shift times, lateness threshold, on-time bonus, late tiers, overtime tiers, step-after rules, early departure limit & threshold, leave min hours, manual arrival limit), Regulations editor.
- **Supervisor**: Manual attendance for courier emergency (2h arrival limit).
- **i18n**: Bahasa Indonesia default, English toggleable.

## Dynamic Rule Engine
All rules stored in `config` collection (single `id: "global"` doc). Business logic reads config in real-time — no restart or code change needed. Changing e.g. `on_time_bonus` from Rp20.000 to Rp25.000 immediately affects the next check-in outcome.

## Data Model (Mongo collections)
- `users` — id, username, name, password_hash, role, position, division, warehouse_id, must_change_password, active
- `warehouses` — id, name, address, latitude, longitude, radius_m
- `config` — global rules doc
- `attendance` — id, user_id, date, check_in_at, check_out_at, warehouse_id, coords, is_late, late_minutes, penalty_amount, late_tier, on_time_bonus, effective_shift_end, is_early_check_in, overtime_minutes, overtime_amount, early_departure, early_departure_deduction, manual, manual_reason, approved_by
- `leave_requests` — id, user_id, user_name, position, division, date, reason, status
- `user_stats` — user_id, month (YYYY-MM), leave_count, early_departure_count, total_bonus, total_penalty, total_overtime
- `regulations` — global doc with markdown content
- `notifications` — id, user_id, division, message, read

## Phase 4 (Deployment)
See `/app/DEPLOYMENT.md` for self-hosted Pocketbase/Docker/Nginx tutorial and Google Play Store roadmap.

## Not shipped (deliberately deferred)
- Push notifications (in-app notifications feed instead)
- Offline mode
- Photo capture on check-in
- Multi-tenant/org support
