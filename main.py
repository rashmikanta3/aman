import os
import io
import shutil
import calendar
from datetime import date, datetime
from typing import List, Optional
from pathlib import Path

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Response, status
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import extract, func
from pydantic import BaseModel

import boto3
from botocore.config import Config
from dotenv import load_dotenv

import models
from database import engine, get_db, SessionLocal, Base
import queries
import reports_pdf
# for lock the docs page
import secrets
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
import mailer
from datetime import timedelta

load_dotenv()

app = FastAPI(
    title="Operations, Reporting & Document Portal",
    docs_url=None,
    redoc_url=None,
    openapi_url=None
)

BASE_DIR = Path(__file__).parent
ASSETS_DIR = BASE_DIR / "assets"
STATIC_DIR = BASE_DIR / "static"
ASSETS_DIR.mkdir(exist_ok=True)

models.Base.metadata.create_all(bind=engine)

# Cloudflare R2 S3 Client Configuration
R2_ENDPOINT = os.getenv("R2_ENDPOINT")
R2_ACCESS_KEY = os.getenv("R2_ACCESS_KEY")
R2_SECRET_KEY = os.getenv("R2_SECRET_KEY")
R2_BUCKET = os.getenv("R2_BUCKET", "aman")
R2_PUBLIC_URL = os.getenv("R2_PUBLIC_URL")

s3_client = boto3.client(
    's3',
    endpoint_url=R2_ENDPOINT,
    aws_access_key_id=R2_ACCESS_KEY,
    aws_secret_access_key=R2_SECRET_KEY,
    region_name='auto',
    config=Config(signature_version='s3v4')
)

def seed_admin():
    db = SessionLocal()
    try:
        if not db.query(models.Admin).filter(models.Admin.username == "admin").first():
            db.add(models.Admin(username="admin", password="adminpassword", full_name="Operations Administrator"))
            db.commit()
    finally:
        db.close()

seed_admin()

class ManualEmailRequest(BaseModel):
    circle: str = "ALL"               # "ALL" or specific circle: "JEYPORE", "RAYAGADA", etc.
    target_date: Optional[date] = None

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
    load_booked: Optional[float] = 0.0
    amount_collected: Optional[float] = 0.0
    number_of_dc: Optional[int] = 0
    team_leader_present: Optional[bool] = True
    operation_mode: Optional[str] = "Operated Independently"
    merged_with_team: Optional[str] = ""
    lock: bool = False
    is_admin: bool = False

security = HTTPBasic()

def get_current_admin(credentials: HTTPBasicCredentials = Depends(security), db: Session = Depends(get_db)):
    admin = db.query(models.Admin).filter(models.Admin.username == credentials.username).first()
    # Check if admin exists and password matches
    if not (admin and secrets.compare_digest(admin.password, credentials.password)):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Basic"},
        )
    return admin

@app.get("/docs", include_in_schema=False)
def get_documentation(admin: models.Admin = Depends(get_current_admin)):
    return get_swagger_ui_html(
        openapi_url="/api/openapi.json",
        title=f"{app.title} - Swagger UI"
    )

@app.get("/api/openapi.json", include_in_schema=False)
def get_open_api_endpoint(admin: models.Admin = Depends(get_current_admin)):
    return JSONResponse(
        get_openapi(
            title=app.title,
            version="1.0.0",
            routes=app.routes,
        )
    )

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
        q = q.filter(models.Team.circle.ilike(circle.strip()))
    return q.order_by(models.Team.circle, models.Team.team_name).all()

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
    # Perform an explicit join between Employee and Team
    q = db.query(models.Employee, models.Team).join(
        models.Team, models.Employee.team_id == models.Team.id
    )
    
    if circle and circle != "All Circles":
        q = q.filter(models.Team.circle.ilike(circle.strip()))
        
    results = q.order_by(models.Team.circle, models.Team.team_name, models.Employee.name).all()

    return [
        {
            "id": emp.id,
            "emp_code": emp.emp_code,
            "name": emp.name,
            "designation": emp.designation,
            "is_active": getattr(emp, "is_active", True),
            "circle": team.circle,
            "team_name": team.team_name or getattr(team, "name", "-"),
            "team_id": emp.team_id,
        }
        for emp, team in results
    ]

@app.get("/api/attendance/day")
def get_daily_attendance(date_str: str, circle: Optional[str] = None, team_id: Optional[int] = None, db: Session = Depends(get_db)):
    target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    q = db.query(models.Employee).join(models.Team).filter(
        models.Employee.is_active == True,
        models.Team.is_active == True
    )
    if circle and circle != "All Circles":
        q = q.filter(models.Team.circle.ilike(circle.strip()))
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
            "load_booked": getattr(log, 'load_booked', 0.0),
            "amount_collected": getattr(log, 'amount_collected', 0.0),
            "number_of_dc": getattr(log, 'number_of_dc', 0),
            "team_leader_present": getattr(log, 'team_leader_present', True),
            "operation_mode": getattr(log, 'operation_mode', 'Operated Independently'),
            "merged_with_team": getattr(log, 'merged_with_team', ''),
            "is_locked": log.is_locked
        }
    return {
        "team_id": team_id,
        "date": target_date,
        "supervisor": default_super,
        "load_booked": 0.0,
        "amount_collected": 0.0,
        "number_of_dc": 0,
        "team_leader_present": True,
        "operation_mode": "Operated Independently",
        "merged_with_team": "",
        "is_locked": False
    }

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

# --- PDF Reports ---

@app.get("/api/reports/download-circle-log-pdf")
def download_circle_log_pdf(
    circle: str,
    year: int,
    month: int,
    db: Session = Depends(get_db)
):
    rows, total_km = queries.fetch_circle_log_summary(db, circle, year, month)
    pdf_bytes = reports_pdf.build_circle_log_pdf(circle, year, month, rows, total_km)
    
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=Circle_Summary_{circle}_{month}_{year}.pdf"}
    )

@app.get("/api/reports/download-attendance-pdf")
def download_attendance_pdf(
    circle: str,
    year: int,
    month: int,
    team_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    team_lead = None
    team_name = None

    if team_id:
        team = db.query(models.Team).filter(models.Team.id == team_id).first()
        if team:
            team_lead = team.team_lead or team.team_leader
            team_name = team.team_name

    employees, attendance_map = queries.fetch_attendance_data(db, circle, year, month, team_id)

    pdf_bytes = reports_pdf.build_form_d_pdf(
        circle_name=circle,
        year=year,
        month=month,
        employees=employees,
        attendance_map=attendance_map,
        team_lead=team_lead,
        team_name=team_name
    )

    filename_prefix = f"Form_D_Attendance_{team_name}" if team_name else f"Form_D_Attendance_{circle}"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename={filename_prefix}_{month}_{year}.pdf"}
    )

@app.get("/api/reports/download-team-log-pdf")
def download_team_log_pdf(
    team_id: int,
    year: int,
    month: int,
    db: Session = Depends(get_db)
):
    team = db.query(models.Team).filter(models.Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    daily_logs = queries.fetch_team_daily_logs(db, team.id, year, month)
    pdf_bytes = reports_pdf.build_team_log_pdf(
        team_name=team.team_name,
        circle=team.circle,
        team_lead=team.team_lead,
        year=year,
        month=month,
        daily_logs=daily_logs
    )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=Daily_Log_{team.team_name}_{month}_{year}.pdf"}
    )

@app.get("/api/reports/download-performance-pdf")
def download_performance_pdf(
    circle: str,
    year: int,
    month: int,
    team_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    perf_rows = queries.fetch_team_performance_data(db, circle, year, month, team_id)
    pdf_bytes = reports_pdf.build_team_performance_pdf(circle, year, month, perf_rows)

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=Team_Performance_{circle}_{month}_{year}.pdf"}
    )

# --- Assets ---

@app.get("/api/assets")
def list_assets(db: Session = Depends(get_db)):
    return db.query(models.AssetFile).order_by(models.AssetFile.uploaded_at.desc()).all()

@app.post("/api/admin/assets/upload")
async def upload_asset(
    title: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
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
    asset = db.query(models.AssetFile).filter(models.AssetFile.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Document not found")

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

@app.post("/api/admin/reports/send-email")
def trigger_manual_email(payload: ManualEmailRequest, db: Session = Depends(get_db)):
    target_date = payload.target_date or (date.today() - timedelta(days=1))
    
    try:
        success = mailer.send_report_email(db, target_date, scope=payload.circle)
        if not success:
            raise HTTPException(status_code=400, detail=f"No recipients configured for {payload.circle}")
        return {"message": f"Daily report for {payload.circle} ({target_date}) successfully sent!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Email dispatch error: {str(e)}")