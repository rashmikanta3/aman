import os
import io
import shutil
import calendar
from datetime import date, datetime
from typing import List, Optional
from pathlib import Path

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from sqlalchemy import extract, func
from pydantic import BaseModel
from xhtml2pdf import pisa
import models
from database import engine, get_db, SessionLocal, Base
import boto3
from botocore.config import Config
from dotenv import load_dotenv
# Load variables from .env file into environment
load_dotenv()

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Operations, Reporting & Document Portal")

BASE_DIR = Path(__file__).parent
ASSETS_DIR = BASE_DIR / "assets"
STATIC_DIR = BASE_DIR / "static"
ASSETS_DIR.mkdir(exist_ok=True)

templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
models.Base.metadata.create_all(bind=engine)

# --- Cloudflare R2 S3 Client Configuration ---
R2_ENDPOINT = os.getenv("R2_ENDPOINT")
R2_ACCESS_KEY = os.getenv("R2_ACCESS_KEY")
R2_SECRET_KEY = os.getenv("R2_SECRET_KEY")
R2_BUCKET = os.getenv("R2_BUCKET", "aman")
R2_PUBLIC_URL = os.getenv("R2_PUBLIC_URL") # e.g., https://pub-xxxxxx.r2.dev

s3_client = boto3.client(
    's3',
    endpoint_url=R2_ENDPOINT,
    aws_access_key_id=R2_ACCESS_KEY,
    aws_secret_access_key=R2_SECRET_KEY,
    region_name='auto',
    config=Config(signature_version='s3v4')
)


def render_html_to_pdf(html_content: str) -> bytes:
    buffer = io.BytesIO()
    pisa_status = pisa.CreatePDF(html_content, dest=buffer)
    if pisa_status.err:
        raise RuntimeError(f"PDF creation failed: {pisa_status.err}")
    return buffer.getvalue()

def seed_admin():
    db = SessionLocal()
    try:
        if not db.query(models.Admin).filter(models.Admin.username == "admin").first():
            db.add(models.Admin(username="admin", password="adminpassword", full_name="Operations Administrator"))
            db.commit()
    finally:
        db.close()

seed_admin()

class LoginReq(BaseModel):
    username: str
    password: str

class TeamCreate(BaseModel):
    team_name: str
    team_lead: str
    supervisor: str
    circle: str
    username: str
    password: str
    reporting_manager: str

class EmpCreate(BaseModel):
    emp_code: str
    name: str
    designation: str
    team_id: int

class StatusToggle(BaseModel):
    is_active: bool

class AttItem(BaseModel):
    employee_id: int
    status: str

class AttSubmitReq(BaseModel):
    date: date
    records: List[AttItem]
    lock: bool = False
    is_admin: bool = False

class VehicleLogCreate(BaseModel):
    team_id: int
    date: date
    vehicle_no: Optional[str] = ""
    supervisor: Optional[str] = ""
    start_time: Optional[str] = ""
    end_time: Optional[str] = ""
    journey_route: Optional[str] = ""
    start_km: Optional[int] = 0
    end_km: Optional[int] = 0
    total_km: Optional[int] = 0
    remarks: Optional[str] = ""
    lock: bool = False
    is_admin: bool = False

@app.post("/api/login")
def login(creds: LoginReq, db: Session = Depends(get_db)):
    admin = db.query(models.Admin).filter(models.Admin.username == creds.username, models.Admin.password == creds.password).first()
    if admin:
        return {"role": "admin", "id": admin.id, "display_name": admin.full_name, "circle": "All Circles"}

    team = db.query(models.Team).filter(models.Team.username == creds.username, models.Team.password == creds.password).first()
    if team:
        if not team.is_active:
            raise HTTPException(status_code=403, detail="Team account deactivated by administrator.")
        return {
            "role": "team",
            "id": team.id,
            "display_name": team.team_name,
            "team_lead": team.team_lead,
            "supervisor": team.supervisor,
            "circle": team.circle,
            "reporting_manager": team.reporting_manager
        }
    raise HTTPException(status_code=400, detail="Invalid username or password")

# Admin Team Management
@app.post("/api/admin/teams")
def create_team(t: TeamCreate, db: Session = Depends(get_db)):
    if db.query(models.Team).filter(models.Team.username == t.username).first():
        raise HTTPException(status_code=400, detail="Username already exists")
    if db.query(models.Team).filter(models.Team.team_name == t.team_name).first():
        raise HTTPException(status_code=400, detail="Team name already exists")
    db.add(models.Team(**t.dict()))
    db.commit()
    return {"message": "Team created successfully"}

@app.put("/api/admin/teams/{team_id}/toggle-active")
def toggle_team_active(team_id: int, payload: StatusToggle, db: Session = Depends(get_db)):
    team = db.query(models.Team).filter(models.Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    team.is_active = payload.is_active
    db.commit()
    return {"message": f"Team marked as {'Active' if payload.is_active else 'Inactive'}"}

@app.get("/api/teams")
def list_teams(circle: Optional[str] = None, all_status: bool = False, db: Session = Depends(get_db)):
    q = db.query(models.Team)
    if not all_status:
        q = q.filter(models.Team.is_active == True)
    if circle and circle != "All Circles":
        q = q.filter(models.Team.circle == circle)
    return q.order_by(models.Team.circle, models.Team.team_name).all()

# Admin Employee Management
@app.post("/api/admin/employees")
def create_employee(emp: EmpCreate, db: Session = Depends(get_db)):
    if db.query(models.Employee).filter(models.Employee.emp_code == emp.emp_code).first():
        raise HTTPException(status_code=400, detail="Employee code already registered")
    db.add(models.Employee(**emp.dict()))
    db.commit()
    return {"message": "Employee registered successfully"}

@app.put("/api/admin/employees/{emp_id}/toggle-active")
def toggle_employee_active(emp_id: int, payload: StatusToggle, db: Session = Depends(get_db)):
    e = db.query(models.Employee).filter(models.Employee.id == emp_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="Employee not found")
    e.is_active = payload.is_active
    db.commit()
    return {"message": f"Employee marked as {'Active' if payload.is_active else 'Inactive'}"}

@app.get("/api/admin/employees/all")
def list_all_employees(circle: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(models.Employee).join(models.Team)
    if circle and circle != "All Circles":
        q = q.filter(models.Team.circle == circle)
    return q.order_by(models.Team.circle, models.Team.team_name, models.Employee.name).all()

# Attendance Entry
@app.get("/api/attendance/day")
def get_daily_attendance(date_str: str, circle: Optional[str] = None, team_id: Optional[int] = None, db: Session = Depends(get_db)):
    target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    q = db.query(models.Employee).join(models.Team).filter(
        models.Employee.is_active == True,
        models.Team.is_active == True
    )
    if circle and circle != "All Circles":
        q = q.filter(models.Team.circle == circle)
    if team_id:
        q = q.filter(models.Employee.team_id == team_id)
    employees = q.order_by(models.Team.circle, models.Team.team_name, models.Employee.id).all()

    emp_ids = [e.id for e in employees]
    records = db.query(models.Attendance).filter(
        models.Attendance.date == target_date,
        models.Attendance.employee_id.in_(emp_ids)
    ).all() if emp_ids else []

    status_map = {r.employee_id: (r.status, r.is_locked) for r in records}
    is_any_locked = any(r.is_locked for r in records)

    return {
        "is_locked": is_any_locked,
        "rows": [{
            "employee_id": e.id,
            "emp_code": e.emp_code,
            "name": e.name,
            "designation": e.designation,
            "team_name": e.team.team_name,
            "status": status_map.get(e.id, ("P", False))[0],
            "is_locked": status_map.get(e.id, ("P", False))[1]
        } for e in employees]
    }

@app.post("/api/attendance/submit")
def submit_attendance(payload: AttSubmitReq, db: Session = Depends(get_db)):
    for r in payload.records:
        existing = db.query(models.Attendance).filter(
            models.Attendance.employee_id == r.employee_id,
            models.Attendance.date == payload.date
        ).first()

        if existing and existing.is_locked and not payload.is_admin:
            raise HTTPException(status_code=403, detail="Attendance records are locked.")

        if existing:
            existing.status = r.status
            existing.is_locked = payload.lock
        else:
            db.add(models.Attendance(employee_id=r.employee_id, date=payload.date, status=r.status, is_locked=payload.lock))
    db.commit()
    return {"message": "Attendance saved successfully"}

# Vehicle Log Entry
@app.get("/api/vehicle-log/day")
def get_vehicle_log_day(date_str: str, team_id: int, db: Session = Depends(get_db)):
    target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    log = db.query(models.VehicleLog).filter(
        models.VehicleLog.date == target_date,
        models.VehicleLog.team_id == team_id
    ).first()

    team = db.query(models.Team).filter(models.Team.id == team_id).first()
    default_super = team.supervisor if team else ""

    if log:
        return {
            "id": log.id,
            "team_id": log.team_id,
            "date": log.date,
            "vehicle_no": log.vehicle_no,
            "supervisor": log.supervisor or default_super,
            "start_time": log.start_time,
            "end_time": log.end_time,
            "journey_route": log.journey_route,
            "start_km": log.start_km,
            "end_km": log.end_km,
            "total_km": log.total_km,
            "remarks": log.remarks,
            "is_locked": log.is_locked
        }
    return {"team_id": team_id, "date": target_date, "supervisor": default_super, "is_locked": False}

@app.post("/api/vehicle-log/submit")
def submit_vehicle_log(payload: VehicleLogCreate, db: Session = Depends(get_db)):
    existing = db.query(models.VehicleLog).filter(
        models.VehicleLog.date == payload.date,
        models.VehicleLog.team_id == payload.team_id
    ).first()

    if existing and existing.is_locked and not payload.is_admin:
        raise HTTPException(status_code=403, detail="Vehicle log is locked.")

    data_dict = payload.dict()
    is_lock = data_dict.pop("lock")
    data_dict.pop("is_admin")

    if existing:
        for k, v in data_dict.items():
            setattr(existing, k, v)
        existing.is_locked = is_lock
    else:
        db.add(models.VehicleLog(**data_dict, is_locked=is_lock))
    db.commit()
    return {"message": "Vehicle log saved successfully"}

# Form D Attendance PDF Download
# In main.py: inside download_attendance_pdf(...)

@app.get("/api/reports/download-attendance-pdf")
def download_attendance_pdf(year: int, month: int, circle: str, team_id: Optional[int] = None, db: Session = Depends(get_db)):
    _, num_days = calendar.monthrange(year, month)
    emp_query = db.query(models.Employee).join(models.Team).filter(
        models.Employee.is_active == True,
        models.Team.is_active == True
    )
    if circle != "All Circles":
        emp_query = emp_query.filter(models.Team.circle == circle)

    if team_id:
        team = db.query(models.Team).filter(models.Team.id == team_id).first()
        emp_query = emp_query.filter(models.Employee.team_id == team_id)
        team_name = team.team_name if team else "Team"
        sign_role = "Team Leader"
        sign_dept = f"Enforcement Cell, TPSODL, {circle} Circle"
        sign_person = team.team_lead if team else ""
    else:
        team_name = "All Teams (Full Circle)"
        sign_role = "Executive Engineer (Elect.)"
        sign_dept = f"Vigilance & Enforcement Cell, TPSODL, {circle} Circle"
        sign_person = ""

    employees = emp_query.order_by(models.Team.circle, models.Team.team_name, models.Employee.id).all()
    emp_ids = [e.id for e in employees]

    records = db.query(models.Attendance).filter(
        extract('year', models.Attendance.date) == year,
        extract('month', models.Attendance.date) == month,
        models.Attendance.employee_id.in_(emp_ids)
    ).all() if emp_ids else []

    att_map = {(r.employee_id, r.date.day): r.status for r in records}
    
    rows = []
    # Initialize daily totals
    daily_present_totals = {d: 0 for d in range(1, num_days + 1)}
    grand_p = grand_l = grand_a = grand_wo = 0

    for emp in employees:
        days_data = {}
        p_c = a_c = l_c = wo_c = 0
        for d in range(1, num_days + 1):
            st = att_map.get((emp.id, d), "")
            days_data[d] = st
            if st == "P": 
                p_c += 1
                daily_present_totals[d] += 1
            elif st == "A": 
                a_c += 1
            elif st == "L": 
                l_c += 1
            elif st == "WO": 
                wo_c += 1

        grand_p += p_c
        grand_l += l_c
        grand_a += a_c
        grand_wo += wo_c

        rows.append({
            "name": emp.name,
            "designation": emp.designation,
            "team_name": emp.team.team_name,
            "days": days_data,
            "summary": {"P": p_c, "L": l_c, "A": a_c, "WO": wo_c}
        })

    # Total Row Data Object
    col_totals = {
        "daily_present": daily_present_totals,
        "grand_p": grand_p,
        "grand_l": grand_l,
        "grand_a": grand_a,
        "grand_wo": grand_wo
    }

    html_out = templates.get_template("form_d_landscape.html").render({
        "circle": circle,
        "team_name": team_name,
        "year": year,
        "month": month,
        "total_days": num_days,
        "rows": rows,
        "col_totals": col_totals,
        "sign_role": sign_role,
        "sign_dept": sign_dept,
        "sign_person": sign_person
    })

    pdf_bytes = render_html_to_pdf(html_out)
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=Form_D_{circle}_{month}_{year}.pdf"}
    )
    
# Vehicle Log Book PDF Download (Auto-Switches Between Portrait and Landscape)
@app.get("/api/reports/download-circle-log-pdf")
@app.get("/api/reports/download-logbook-pdf")
def download_logbook_pdf(year: int, month: int, circle: str, team_id: Optional[int] = None, db: Session = Depends(get_db)):
    month_names = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"]
    month_name = month_names[month - 1]

    # CASE 1: SPECIFIC TEAM -> A4 PORTRAIT DAY-BY-DAY
    if team_id is not None and team_id > 0:
        team = db.query(models.Team).filter(models.Team.id == team_id).first()
        if not team:
            raise HTTPException(status_code=404, detail="Team not found")

        logs = db.query(models.VehicleLog).filter(
            models.VehicleLog.team_id == team_id,
            extract('year', models.VehicleLog.date) == year,
            extract('month', models.VehicleLog.date) == month
        ).order_by(models.VehicleLog.date.asc()).all()

        total_km = sum(l.total_km or 0 for l in logs)

        html_out = templates.get_template("team_log_portrait.html").render({
            "circle": team.circle,
            "team_name": team.team_name,
            "team_lead": team.team_lead or "-",
            "supervisor": team.supervisor or "-",
            "year": year,
            "month_name": month_name,
            "logs": logs,
            "total_km": total_km
        })
        pdf_bytes = render_html_to_pdf(html_out)
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=Daily_Log_{team.team_name}_{month_name}_{year}.pdf"}
        )

    # CASE 2: ALL TEAMS / FULL CIRCLE -> A4 LANDSCAPE CIRCLE SUMMARY
    teams = db.query(models.Team).filter(
        models.Team.circle == circle,
        models.Team.is_active == True
    ).order_by(models.Team.id).all()

    vehicle_summary = []
    grand_total_km = 0
    for idx, t in enumerate(teams, start=1):
        km_sum = db.query(func.sum(models.VehicleLog.total_km)).filter(
            models.VehicleLog.team_id == t.id,
            extract('year', models.VehicleLog.date) == year,
            extract('month', models.VehicleLog.date) == month
        ).scalar() or 0

        latest_log = db.query(models.VehicleLog).filter(
            models.VehicleLog.team_id == t.id,
            extract('year', models.VehicleLog.date) == year,
            extract('month', models.VehicleLog.date) == month
        ).order_by(models.VehicleLog.date.desc()).first()

        vehicle_summary.append({
            "sl_no": idx,
            "area": t.team_name,
            "team_lead": t.team_lead or "-",
            "supervisor": t.supervisor or "-",
            "vehicle_no": latest_log.vehicle_no if (latest_log and latest_log.vehicle_no) else "N/A",
            "total_monthly_km": km_sum
        })
        grand_total_km += km_sum

    html_out = templates.get_template("circle_log_landscape.html").render({
        "circle": circle,
        "year": year,
        "month_name": month_name,
        "vehicle_summary": vehicle_summary,
        "grand_total_km": grand_total_km
    })
    pdf_bytes = render_html_to_pdf(html_out)
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=Circle_Summary_{circle}_{month_name}_{year}.pdf"}
    )

# Document Assets Manage

@app.get("/api/assets")
def list_assets(db: Session = Depends(get_db)):
    """Fetch all uploaded asset files from the database."""
    return db.query(models.AssetFile).order_by(models.AssetFile.uploaded_at.desc()).all()


@app.post("/api/admin/assets/upload")
async def upload_asset(
    title: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Streams file directly to Cloudflare R2 without saving to server disk."""
    # Prefix timestamp to avoid filename collisions
    safe_filename = f"{datetime.now().strftime('%Y%m%d%H%M%S')}_{file.filename.replace(' ', '_')}"
    file_bytes = await file.read()

    try:
        s3_client.put_object(
            Bucket=R2_BUCKET,
            Key=safe_filename,
            Body=file_bytes,
            ContentType=file.content_type or "application/octet-stream"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cloudflare R2 Upload Failed: {str(e)}")

    # Construct public download link
    public_file_url = f"{R2_PUBLIC_URL.rstrip('/')}/{safe_filename}"

    asset = models.AssetFile(
        title=title,
        filename=file.filename,
        file_url=public_file_url
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)

    return {"message": "Document uploaded successfully to Cloudflare R2!", "file_url": public_file_url}


@app.delete("/api/admin/assets/{asset_id}")
def delete_asset(asset_id: int, db: Session = Depends(get_db)):
    """Deletes the document from Cloudflare R2 and removes the database record."""
    asset = db.query(models.AssetFile).filter(models.AssetFile.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Document not found")

    # Extract the R2 object key from the stored URL
    object_key = asset.file_url.split("/")[-1]
    try:
        s3_client.delete_object(Bucket=R2_BUCKET, Key=object_key)
    except Exception as e:
        print(f"R2 deletion warning: {e}")

    db.delete(asset)
    db.commit()
    return {"message": "Document deleted successfully"}

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/")
def serve_index():
    return FileResponse(STATIC_DIR / "index.html")