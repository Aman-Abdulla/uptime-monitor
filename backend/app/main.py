import asyncio
import logging
from urllib.parse import urlparse
from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel, HttpUrl
from typing import List, Optional

from .database import init_db, get_db, URLModel, CheckModel
from .worker import ping_url_instance, run_periodic_pinger, ping_and_save_new_url

logger = logging.getLogger("uptime_api")

app = FastAPI(title="Uptime Monitor API", version="1.0")

# Enable CORS for frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For MVP. In production, restrict to frontend domain.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Start background pinger on app startup
@app.on_event("startup")
async def startup_event():
    init_db()
    # Run the pinger in the background every 60 seconds
    asyncio.create_task(run_periodic_pinger(60))
    logger.info("Database initialized and periodic ping worker started.")

# Request/Response schemas
class URLCreate(BaseModel):
    url: str
    name: Optional[str] = None

class CheckResponse(BaseModel):
    id: int
    status_code: Optional[int]
    response_time_ms: Optional[float]
    error_message: Optional[str]
    timestamp: str

    class Config:
        from_attributes = True

class URLResponse(BaseModel):
    id: int
    url: str
    name: Optional[str]
    is_active: bool
    created_at: str
    latest_check: Optional[CheckResponse] = None
    history: List[CheckResponse] = []

    class Config:
        from_attributes = True

def clean_and_validate_url(url_str: str):
    url_str = url_str.strip()
    if not url_str:
        raise HTTPException(status_code=400, detail="URL cannot be empty")
    
    # If no scheme is provided, prefix with https://
    if not (url_str.startswith("http://") or url_str.startswith("https://")):
        url_str = "https://" + url_str

    try:
        parsed = urlparse(url_str)
        if not parsed.netloc or "." not in parsed.netloc:
            raise ValueError("Invalid hostname structure")
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid URL: {url_str}")
        
    return url_str, parsed.netloc

@app.post("/api/urls", response_model=URLResponse)
async def register_url(payload: URLCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    cleaned_url, hostname = clean_and_validate_url(payload.url)
    
    # Check if URL is already registered
    existing = db.query(URLModel).filter(URLModel.url == cleaned_url).first()
    if existing:
        raise HTTPException(status_code=400, detail="URL is already registered")

    name = payload.name.strip() if payload.name else hostname

    new_url = URLModel(
        url=cleaned_url,
        name=name,
        is_active=True
    )
    db.add(new_url)
    db.commit()
    db.refresh(new_url)

    # Trigger an immediate ping in the background so that status is available immediately
    background_tasks.add_task(ping_and_save_new_url, new_url.id)

    # Prepare response format
    return URLResponse(
        id=new_url.id,
        url=new_url.url,
        name=new_url.name,
        is_active=new_url.is_active,
        created_at=new_url.created_at.isoformat(),
        latest_check=None,
        history=[]
    )

@app.get("/api/urls", response_model=List[URLResponse])
async def list_urls(db: Session = Depends(get_db)):
    urls = db.query(URLModel).all()
    results = []
    
    for url in urls:
        # Get the latest check
        latest_check_model = db.query(CheckModel)\
            .filter(CheckModel.url_id == url.id)\
            .order_by(CheckModel.timestamp.desc())\
            .first()
            
        latest_check = None
        if latest_check_model:
            latest_check = CheckResponse(
                id=latest_check_model.id,
                status_code=latest_check_model.status_code,
                response_time_ms=latest_check_model.response_time_ms,
                error_message=latest_check_model.error_message,
                timestamp=latest_check_model.timestamp.isoformat()
            )

        # Get history of last 10 checks (ordered oldest to newest for visual sequence)
        history_models = db.query(CheckModel)\
            .filter(CheckModel.url_id == url.id)\
            .order_by(CheckModel.timestamp.desc())\
            .limit(10)\
            .all()
            
        # Reverse history to be in ascending chronological order for chart display
        history = [
            CheckResponse(
                id=c.id,
                status_code=c.status_code,
                response_time_ms=c.response_time_ms,
                error_message=c.error_message,
                timestamp=c.timestamp.isoformat()
            )
            for c in reversed(history_models)
        ]

        results.append(URLResponse(
            id=url.id,
            url=url.url,
            name=url.name,
            is_active=url.is_active,
            created_at=url.created_at.isoformat(),
            latest_check=latest_check,
            history=history
        ))
        
    return results

@app.delete("/api/urls/{url_id}")
async def delete_url(url_id: int, db: Session = Depends(get_db)):
    url = db.query(URLModel).filter(URLModel.id == url_id).first()
    if not url:
        raise HTTPException(status_code=404, detail="URL not found")
        
    db.delete(url)
    db.commit()
    return {"message": f"Successfully deleted URL monitoring for {url.url}"}

@app.post("/api/urls/{url_id}/check", response_model=CheckResponse)
async def trigger_manual_check(url_id: int, db: Session = Depends(get_db)):
    url = db.query(URLModel).filter(URLModel.id == url_id).first()
    if not url:
        raise HTTPException(status_code=404, detail="URL not found")
        
    check = await ping_url_instance(db, url)
    return CheckResponse(
        id=check.id,
        status_code=check.status_code,
        response_time_ms=check.response_time_ms,
        error_message=check.error_message,
        timestamp=check.timestamp.isoformat()
    )

@app.get("/api/urls/{url_id}/history", response_model=List[CheckResponse])
async def get_url_history(url_id: int, db: Session = Depends(get_db)):
    # Check if URL exists
    url = db.query(URLModel).filter(URLModel.id == url_id).first()
    if not url:
        raise HTTPException(status_code=404, detail="URL not found")
        
    checks = db.query(CheckModel)\
        .filter(CheckModel.url_id == url_id)\
        .order_by(CheckModel.timestamp.desc())\
        .limit(100)\
        .all()
        
    return [
        CheckResponse(
            id=c.id,
            status_code=c.status_code,
            response_time_ms=c.response_time_ms,
            error_message=c.error_message,
            timestamp=c.timestamp.isoformat()
        )
        for c in checks
    ]
