from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, ForeignKey, Table, LargeBinary
from sqlalchemy.orm import relationship
from app.database import Base

# ── Association tables ────────────────────────────────────────────────────────

scraper_tags = Table(
    "scraper_tags",
    Base.metadata,
    Column("scraper_id", Integer, ForeignKey("scrapers.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id",     Integer, ForeignKey("tags.id",     ondelete="CASCADE"), primary_key=True),
)

scraper_integrations = Table(
    "scraper_integrations",
    Base.metadata,
    Column("scraper_id",     Integer, ForeignKey("scrapers.id",     ondelete="CASCADE"), primary_key=True),
    Column("integration_id", Integer, ForeignKey("integrations.id", ondelete="CASCADE"), primary_key=True),
)

schedule_tags = Table(
    "schedule_tags",
    Base.metadata,
    Column("schedule_id", Integer, ForeignKey("schedules.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id",      Integer, ForeignKey("tags.id",      ondelete="CASCADE"), primary_key=True),
)


class Scraper(Base):
    __tablename__ = "scrapers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    module_path = Column(String, nullable=True, unique=True)
    description = Column(Text, default="")
    homepage_url = Column(String, nullable=True)
    thumbnail_url = Column(String, nullable=True)
    local_thumbnail_path = Column(String, nullable=True)
    thumbnail_data = Column(LargeBinary, nullable=True)
    enabled = Column(Boolean, default=True)
    health = Column(String, default="untested")  # "untested" | "ok" | "failing"
    scraper_type = Column(String, default="python")  # "python" | "builder"
    flow_data = Column(Text, nullable=True)         # JSON encoded graph (nodes, edges)
    position = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    schedules     = relationship("Schedule",       back_populates="scraper", cascade="all, delete-orphan")
    logs          = relationship("ScrapeLog",      back_populates="scraper", cascade="all, delete-orphan")
    queue_tasks   = relationship("TaskQueue",      back_populates="scraper", cascade="all, delete-orphan")
    versions      = relationship("ScraperVersion", back_populates="scraper", cascade="all, delete-orphan", order_by="desc(ScraperVersion.created_at)")
    tags          = relationship("Tag",            secondary="scraper_tags",         back_populates="scrapers")
    integrations  = relationship("Integration",    secondary="scraper_integrations", back_populates="scrapers")


class Schedule(Base):
    __tablename__ = "schedules"

    id = Column(Integer, primary_key=True, index=True)
    scraper_id = Column(Integer, ForeignKey("scrapers.id"), nullable=False)
    cron_expression = Column(String, nullable=False)   # e.g. "0 12 * * *"
    enabled = Column(Boolean, default=True)
    last_run = Column(DateTime, nullable=True)
    next_run = Column(DateTime, nullable=True)
    position = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    input_values = Column(Text, nullable=True)         # JSON: runtime input params
    label = Column(String, nullable=True)              # optional custom name
    thumbnail_url = Column(String, nullable=True)      # optional custom thumbnail override
    local_thumbnail_path = Column(String, nullable=True)
    thumbnail_data = Column(LargeBinary, nullable=True)

    scraper = relationship("Scraper", back_populates="schedules")
    tags    = relationship("Tag",     secondary="schedule_tags", back_populates="schedules")


class ScrapeLog(Base):
    __tablename__ = "scrape_logs"

    id            = Column(Integer, primary_key=True, index=True)
    scraper_id    = Column(Integer, ForeignKey("scrapers.id"), nullable=False)
    schedule_id   = Column(Integer, ForeignKey("schedules.id"), nullable=True)
    status        = Column(String, nullable=False)   # "success" | "failure"
    payload       = Column(Text,   nullable=True)    # JSON: full latest episode dict
    episode_count = Column(Integer, default=0)       # total episodes found this run
    error_msg     = Column(Text,   nullable=True)
    run_at        = Column(DateTime, default=datetime.utcnow)
    triggered_by  = Column(String, default="scheduler")  # "scheduler" | "manual" | "catchup"
    retry_count   = Column(Integer, default=0)       # how many retries were attempted
    integration_details = Column(Text, nullable=True) # JSON with integration results

    scraper = relationship("Scraper", back_populates="logs")
    schedule = relationship("Schedule")


class TaskQueue(Base):
    __tablename__ = "task_queue"

    id = Column(Integer, primary_key=True, index=True)
    scraper_id = Column(Integer, ForeignKey("scrapers.id"), nullable=False)
    scheduled_for = Column(DateTime, nullable=False)   # when it *should* have run
    status = Column(String, default="pending")         # "pending" | "running" | "done" | "failed"
    input_values = Column(Text, nullable=True)         # JSON inputs for one-time tasks
    note = Column(Text, nullable=True)                 # Label/note for one-time tasks
    created_at = Column(DateTime, default=datetime.utcnow)
    processed_at = Column(DateTime, nullable=True)

    scraper = relationship("Scraper", back_populates="queue_tasks")


# ── ScraperVersion ───────────────────────────────────────────────────────────

class ScraperVersion(Base):
    __tablename__ = "scraper_versions"

    id             = Column(Integer, primary_key=True, index=True)
    scraper_id     = Column(Integer, ForeignKey("scrapers.id"), nullable=False)
    version_label  = Column(String, nullable=True)    # e.g. "1.0.0"
    commit_message = Column(Text,   nullable=True)    # short description of change
    code           = Column(Text,   nullable=False)   # full .py source
    created_at     = Column(DateTime, default=datetime.utcnow)

    scraper = relationship("Scraper", back_populates="versions")


# ── Tag ───────────────────────────────────────────────────────────────────────

class Tag(Base):
    __tablename__ = "tags"

    id         = Column(Integer, primary_key=True, index=True)
    name       = Column(String, nullable=False, unique=True)
    color      = Column(String, default="#6366f1")   # CSS hex colour
    created_at = Column(DateTime, default=datetime.utcnow)

    scrapers  = relationship("Scraper",  secondary="scraper_tags",  back_populates="tags")
    schedules = relationship("Schedule", secondary="schedule_tags", back_populates="tags")


# ── Integration ───────────────────────────────────────────────────────────────

class Integration(Base):
    __tablename__ = "integrations"

    id         = Column(Integer, primary_key=True, index=True)
    name       = Column(String, nullable=False)
    type       = Column(String, nullable=False)   # e.g. "discord_webhook"
    config     = Column(Text,   nullable=False)   # JSON config blob
    thumbnail_data = Column(LargeBinary, nullable=True)
    position   = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    scrapers = relationship("Scraper", secondary="scraper_integrations", back_populates="integrations")


# ── AppSetting ────────────────────────────────────────────────────────────────

class AppSetting(Base):
    __tablename__ = "app_settings"

    key        = Column(String, primary_key=True)
    value      = Column(Text,   nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ── GlobalVariable ─────────────────────────────────────────────────────────────

class GlobalVariable(Base):
    __tablename__ = "global_variables"

    id          = Column(Integer, primary_key=True, index=True)
    key         = Column(String,  unique=True, nullable=False)
    value       = Column(Text,    nullable=True)
    value_type  = Column(String,  default="string")  # "string" | "number" | "boolean" | "json"
    description = Column(Text,    nullable=True)
    is_secret   = Column(Boolean, default=False)
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    doc_md      = Column(Text, nullable=True)   # Markdown documentation


# ── UserFunction ──────────────────────────────────────────────────────────────

class UserFunction(Base):
    __tablename__ = "user_functions"

    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String,  unique=True, nullable=False) # Function slug (e.g. calculate_date)
    description = Column(Text,    nullable=True)
    code        = Column(Text,    nullable=True)  # The Python source code
    doc_md      = Column(Text,    nullable=True)  # Markdown handbook/docs
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
