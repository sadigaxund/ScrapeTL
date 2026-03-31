import threading
from typing import Dict, Optional

# Global registry: {task_id: threading.Event}
_active_tasks: Dict[int, threading.Event] = {}
_lock = threading.Lock()

def register_task(task_id: int) -> threading.Event:
    """Register a new active task and return its stop signal."""
    print(f"[TaskRegistry] Registering task {task_id}")
    with _lock:
        event = threading.Event()
        _active_tasks[task_id] = event
        return event

def unregister_task(task_id: int):
    """Remove a task from the registry once it finishes."""
    with _lock:
        if task_id in _active_tasks:
            print(f"[TaskRegistry] Unregistering task {task_id}")
            del _active_tasks[task_id]

def request_stop(task_id: int) -> bool:
    """Signal a task to stop. Returns True if task was found."""
    with _lock:
        if task_id in _active_tasks:
            print(f"[TaskRegistry] 🛑 Stop requested for task {task_id}")
            _active_tasks[task_id].set()
            return True
    return False

def is_stop_requested(task_id: int) -> bool:
    """Check if a stop has been requested for a task."""
    with _lock:
        event = _active_tasks.get(task_id)
        return event.is_set() if event else False

def get_stop_event(task_id: int) -> Optional[threading.Event]:
    """Get the stop event for a task, if it exists."""
    with _lock:
        return _active_tasks.get(task_id)
