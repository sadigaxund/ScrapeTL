import os
import sys
import datetime
import threading
from typing import Optional
from sqlalchemy.orm import Session
from scrapetl.models import AppSetting

class TeeStream:
    """A stream that writes to both an original stream and a file, with optional timestamping."""
    def __init__(self, original_stream, log_file, add_timestamps=True):
        self.original_stream = original_stream
        self.log_file = log_file
        self.add_timestamps = add_timestamps
        self._new_line = True
        self._lock = threading.Lock()

    def write(self, data):
        if not data:
            return
            
        with self._lock:
            # 1. Write to original terminal (raw)
            self.original_stream.write(data)
            self.original_stream.flush()

            # 2. Write to log file (with timestamps)
            if self.log_file:
                if self.add_timestamps:
                    parts = data.split('\n')
                    timestamp = datetime.datetime.now().strftime("[%Y-%m-%d %H:%M:%S] ")
                    
                    processed_data = ""
                    for i, part in enumerate(parts):
                        if self._new_line and (i < len(parts) - 1 or part):
                            processed_data += timestamp
                        processed_data += part
                        if i < len(parts) - 1:
                            processed_data += '\n'
                            self._new_line = True
                        else:
                            self._new_line = (part == "") # If last part is empty, it ended with \n
                    
                    self.log_file.write(processed_data)
                else:
                    self.log_file.write(data)
                self.log_file.flush()

    def flush(self):
        self.original_stream.flush()
        if self.log_file:
            self.log_file.flush()

    def isatty(self):
        return self.original_stream.isatty()

# Global tracker for live streaming
ACTIVE_LOG_PATHS = {}

class ScraperLogger:
    """Context manager to capture stdout for a specific scraper run."""
    def __init__(self, db: Session, scraper_name: str, run_id: int):
        self.db = db
        self.scraper_name = self._sanitize_name(scraper_name)
        self.run_id = run_id
        self.log_file = None
        self.original_stdout = sys.stdout
        self.tee_stream = None
        self.full_path = None

    def _sanitize_name(self, name: str) -> str:
        return "".join([c if c.isalnum() or c in (' ', '-', '_') else '_' for c in name]).strip().replace(' ', '_')

    def _get_log_dir(self) -> str:
        try:
            setting = self.db.query(AppSetting).filter(AppSetting.key == "log_directory").first()
            base_dir = setting.value if setting else "./logs"
        except:
            base_dir = "./logs"
        
        target_dir = os.path.join(base_dir, self.scraper_name)
        if not os.path.exists(target_dir):
            os.makedirs(target_dir, exist_ok=True)
        return target_dir

    def __enter__(self):
        try:
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"run_{self.run_id}_{timestamp}.log"
            log_dir = self._get_log_dir()
            self.full_path = os.path.join(log_dir, filename)
            
            # Register in active paths for live streaming
            ACTIVE_LOG_PATHS[self.run_id] = self.full_path
            
            # Open file in append mode (though it should be new)
            self.log_file = open(self.full_path, "a", encoding="utf-8")
            
            # Create TeeStream
            self.tee_stream = TeeStream(self.original_stdout, self.log_file, add_timestamps=True)
            
            # Redirect global stdout
            sys.stdout = self.tee_stream
            
            return self.full_path
        except Exception as e:
            print(f"[Logger] Failed to initialize: {e}")
            return None

    def __exit__(self, exc_type, exc_val, exc_tb):
        # Restore stdout
        sys.stdout = self.original_stdout
        
        # Unregister
        if self.run_id in ACTIVE_LOG_PATHS:
            del ACTIVE_LOG_PATHS[self.run_id]
        
        # Close file
        if self.log_file:
            try:
                self.log_file.close()
            except:
                pass

def get_scraper_logger(db: Session, scraper_name: str, run_id: int):
    return ScraperLogger(db, scraper_name, run_id)
