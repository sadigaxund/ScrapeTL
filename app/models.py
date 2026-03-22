from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base


class Scraper(Base):
    __tablename__ = "scrapers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    module_path = Column(String, nullable=False, unique=True)
    description = Column(Text, default="")
    homepage_url = Column(String, nullable=True)
    thumbnail_url = Column(String, nullable=True)
    local_thumbnail_path = Column(String, nullable=True)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    schedules = relationship("Schedule", back_populates="scraper", cascade="all, delete-orphan")
    logs = relationship("ScrapeLog", back_populates="scraper", cascade="all, delete-orphan")
    queue_tasks = relationship("TaskQueue", back_populates="scraper", cascade="all, delete-orphan")


class Schedule(Base):
    __tablename__ = "schedules"

    id = Column(Integer, primary_key=True, index=True)
    scraper_id = Column(Integer, ForeignKey("scrapers.id"), nullable=False)
    cron_expression = Column(String, nullable=False)   # e.g. "0 12 * * *"
    enabled = Column(Boolean, default=True)
    last_run = Column(DateTime, nullable=True)
    next_run = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    scraper = relationship("Scraper", back_populates="schedules")


class ScrapeLog(Base):
    __tablename__ = "scrape_logs"

    id = Column(Integer, primary_key=True, index=True)
    scraper_id = Column(Integer, ForeignKey("scrapers.id"), nullable=False)
    status = Column(String, nullable=False)        # "success" | "failure"
    title = Column(String, nullable=True)          # latest episode title found
    release_date = Column(String, nullable=True)   # latest episode release date
    website_url = Column(String, nullable=True)    # scraper source URL
    episode_count = Column(Integer, default=0)     # total episodes found this run
    error_msg = Column(Text, nullable=True)
    run_at = Column(DateTime, default=datetime.utcnow)
    triggered_by = Column(String, default="scheduler")  # "scheduler" | "manual" | "catchup"

    scraper = relationship("Scraper", back_populates="logs")


class TaskQueue(Base):
    __tablename__ = "task_queue"

    id = Column(Integer, primary_key=True, index=True)
    scraper_id = Column(Integer, ForeignKey("scrapers.id"), nullable=False)
    scheduled_for = Column(DateTime, nullable=False)   # when it *should* have run
    status = Column(String, default="pending")         # "pending" | "running" | "done" | "failed"
    created_at = Column(DateTime, default=datetime.utcnow)
    processed_at = Column(DateTime, nullable=True)

    scraper = relationship("Scraper", back_populates="queue_tasks")
