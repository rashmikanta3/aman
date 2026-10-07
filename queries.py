import calendar
from datetime import date
from typing import Optional, Tuple, List, Dict
from sqlalchemy.orm import Session
import models

def fetch_attendance_data(
    db: Session,
    circle: str,
    year: int,
    month: int,
    team_id: Optional[int] = None
) -> Tuple[List[dict], Dict[Tuple[int, str], str]]:
    emp_query = (
        db.query(models.Employee)
        .join(models.Team, models.Employee.team_id == models.Team.id)
        .filter(models.Employee.is_active == True)
    )

    if team_id:
        emp_query = emp_query.filter(models.Employee.team_id == team_id)
    elif circle and circle != "All Circles":
        emp_query = emp_query.filter(models.Team.circle == circle)

    employees = emp_query.order_by(models.Employee.team_id, models.Employee.id).all()
    emp_list = [{"id": e.id, "emp_code": e.emp_code, "name": e.name, "designation": e.designation} for e in employees]
    
    if not emp_list:
        return [], {}

    emp_ids = [e["id"] for e in emp_list]
    _, last_day = calendar.monthrange(year, month)
    
    # Must use date objects for Postgres date columns
    start_date = date(year, month, 1)
    end_date = date(year, month, last_day)

    records = (
        db.query(models.Attendance)
        .filter(
            models.Attendance.employee_id.in_(emp_ids),
            models.Attendance.date >= start_date,
            models.Attendance.date <= end_date
        )
        .all()
    )

    attendance_map = {}
    for r in records:
        date_str = r.date.strftime("%Y-%m-%d") if hasattr(r.date, "strftime") else str(r.date)[:10]
        attendance_map[(r.employee_id, date_str)] = r.status

    return emp_list, attendance_map


def fetch_circle_log_summary(db: Session, circle: str, year: int, month: int):
    team_query = db.query(models.Team).filter(models.Team.is_active == True)
    if circle and circle != "All Circles":
        team_query = team_query.filter(models.Team.circle == circle)
    teams = team_query.order_by(models.Team.id.asc()).all()

    _, last_day = calendar.monthrange(year, month)
    start_date = date(year, month, 1)
    end_date = date(year, month, last_day)

    rows = []
    total_circle_km = 0

    for t in teams:
        logs = (
            db.query(models.VehicleLog)
            .filter(
                models.VehicleLog.team_id == t.id,
                models.VehicleLog.date >= start_date,
                models.VehicleLog.date <= end_date
            )
            .all()
        )
        team_km = sum(l.total_km or 0 for l in logs)
        total_circle_km += team_km
        last_log = logs[-1] if logs else None

        rows.append({
            "team_name": t.team_name,
            "team_lead": t.team_lead,
            "supervisor": t.supervisor,
            "vehicle_no": last_log.vehicle_no if last_log and last_log.vehicle_no else "N/A",
            "total_km": team_km
        })

    return rows, total_circle_km


def fetch_team_daily_logs(db: Session, team_id: int, year: int, month: int):
    _, last_day = calendar.monthrange(year, month)
    start_date = date(year, month, 1)
    end_date = date(year, month, last_day)

    logs = (
        db.query(models.VehicleLog)
        .filter(
            models.VehicleLog.team_id == team_id,
            models.VehicleLog.date >= start_date,
            models.VehicleLog.date <= end_date
        )
        .order_by(models.VehicleLog.date.asc())
        .all()
    )

    return [
        {
            "date": l.date.strftime("%Y-%m-%d") if hasattr(l.date, "strftime") else str(l.date)[:10],
            "vehicle_no": l.vehicle_no,
            "supervisor": getattr(l, 'supervisor', ''),
            "driver_name": getattr(l, 'driver_name', ''),
            "journey_route": l.journey_route,
            "start_km": l.start_km,
            "end_km": l.end_km,
            "total_km": l.total_km,
            "remarks": getattr(l, 'remarks', '')
        }
        for l in logs
    ]