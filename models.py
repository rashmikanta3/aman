from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Date, Text,
    ForeignKey, Boolean, DateTime, UniqueConstraint
)
from sqlalchemy.orm import relationship
from database import Base

class Admin(Base):
    __tablename__ = "admins"
    __table_args__ = {'extend_existing': True}

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    password = Column(String(100), nullable=False)
    full_name = Column(String(100), default="Operations Administrator")

class Team(Base):
    __tablename__ = "teams"
    __table_args__ = {'extend_existing': True}

    id = Column(Integer, primary_key=True, index=True)
    team_name = Column(String(100), unique=True, nullable=False)
    # Supports either team_lead or team_leader in database
    team_lead = Column("team_lead", String(100), nullable=True, default="")
    supervisor = Column(String(100), nullable=True, default="")
    circle = Column(String(50), nullable=False)
    username = Column(String(50), unique=True, nullable=False)
    password = Column(String(100), nullable=False)
    reporting_manager = Column(String(150), nullable=False)
    is_active = Column(Boolean, default=True)

    employees = relationship("Employee", back_populates="team", cascade="all, delete-orphan")
    vehicle_logs = relationship("VehicleLog", back_populates="team", cascade="all, delete-orphan")

class Employee(Base):
    __tablename__ = "employees"
    __table_args__ = {'extend_existing': True}

    id = Column(Integer, primary_key=True, index=True)
    emp_code = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(100), nullable=False)
    designation = Column(String(100), nullable=False)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    is_active = Column(Boolean, default=True)

    team = relationship("Team", back_populates="employees")
    attendances = relationship("Attendance", back_populates="employee", cascade="all, delete-orphan")

class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = (
        UniqueConstraint('employee_id', 'date', name='uq_emp_date'),
        {'extend_existing': True}
    )

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    date = Column(Date, nullable=False, index=True)
    status = Column(String(10), nullable=False)
    is_locked = Column(Boolean, default=False)

    employee = relationship("Employee", back_populates="attendances")

class VehicleLog(Base):
    __tablename__ = "vehicle_logs"
    __table_args__ = (
        UniqueConstraint('team_id', 'date', name='uq_team_date'),
        {'extend_existing': True}
    )

    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    date = Column(Date, nullable=False, index=True)
    vehicle_no = Column(String(50), nullable=True)
    supervisor = Column(String(100), nullable=True)
    start_time = Column(String(20), nullable=True)
    end_time = Column(String(20), nullable=True)
    journey_route = Column(Text, nullable=True)
    start_km = Column(Integer, default=0)
    end_km = Column(Integer, default=0)
    total_km = Column(Integer, default=0)
    remarks = Column(Text, nullable=True)
    is_locked = Column(Boolean, default=False)

    team = relationship("Team", back_populates="vehicle_logs")

class AssetFile(Base):
    __tablename__ = "asset_files"
    __table_args__ = {'extend_existing': True}

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(150), nullable=False)
    filename = Column(String(255), nullable=False)
    file_url = Column(String(500), nullable=False)  # Stores public Cloudflare R2 link
    uploaded_at = Column(DateTime, default=datetime.utcnow)