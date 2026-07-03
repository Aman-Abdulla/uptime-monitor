import asyncio
import time
import logging
from datetime import datetime
import httpx
from sqlalchemy.orm import Session
from .database import URLModel, CheckModel, SessionLocal

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("uptime_worker")

async def ping_single_url(url: str) -> dict:
    """
    Performs the HTTP request for a single URL and returns the check metrics.
    No database operations are performed here.
    """
    start_time = time.perf_counter()
    status_code = None
    response_time_ms = None
    error_message = None
    
    headers = {
        "User-Agent": "UptimeMonitor/1.0 MVP"
    }

    try:
        # verify=False permits self-signed HTTPS certs, timeout is 10s
        async with httpx.AsyncClient(timeout=10.0, verify=False) as client:
            response = await client.get(url, headers=headers, follow_redirects=True)
            status_code = response.status_code
            elapsed = time.perf_counter() - start_time
            response_time_ms = round(elapsed * 1000, 2)
            
    except httpx.ConnectTimeout:
        error_message = "Connection timeout (10s)"
        elapsed = time.perf_counter() - start_time
        response_time_ms = round(elapsed * 1000, 2)
    except httpx.ConnectError:
        error_message = "Connection error / DNS resolution failed"
    except httpx.HTTPStatusError as e:
        status_code = e.response.status_code
        error_message = f"HTTP error: {str(e)}"
        elapsed = time.perf_counter() - start_time
        response_time_ms = round(elapsed * 1000, 2)
    except Exception as e:
        error_message = f"Unexpected error: {type(e).__name__} - {str(e)}"

    return {
        "status_code": status_code,
        "response_time_ms": response_time_ms,
        "error_message": error_message
    }

async def ping_url_instance(db: Session, url_instance: URLModel) -> CheckModel:
    """
    Pings a URL and commits the check using the provided DB session.
    Used for manual check and background tasks for newly registered URLs.
    """
    res = await ping_single_url(url_instance.url)
    
    check = CheckModel(
        url_id=url_instance.id,
        status_code=res["status_code"],
        response_time_ms=res["response_time_ms"],
        error_message=res["error_message"],
        timestamp=datetime.utcnow()
    )
    
    db.add(check)
    db.commit()
    db.refresh(check)
    return check

async def ping_and_save_new_url(url_id: int):
    """
    Pings a new URL by ID using an isolated database session.
    Safe for background tasks.
    """
    db = SessionLocal()
    try:
        url_instance = db.query(URLModel).filter(URLModel.id == url_id).first()
        if url_instance:
            await ping_url_instance(db, url_instance)
    except Exception as e:
        logger.error(f"Error in background new URL registration check: {str(e)}")
    finally:
        db.close()

async def ping_all_active_urls():
    """
    Fetches active URLs, performs HTTP requests concurrently,
    then saves checks in a single batch to avoid SQLite locking or session issues.
    """
    db = SessionLocal()
    try:
        active_urls = db.query(URLModel).filter(URLModel.is_active == True).all()
        if not active_urls:
            logger.info("No active URLs to monitor.")
            return

        logger.info(f"Starting periodic health check for {len(active_urls)} URLs.")
        
        # Step 1: Perform the pings concurrently
        tasks = [ping_single_url(url.url) for url in active_urls]
        ping_results = await asyncio.gather(*tasks)
        
        # Step 2: Write all checks in a single database session sequentially
        for url, res in zip(active_urls, ping_results):
            check = CheckModel(
                url_id=url.id,
                status_code=res["status_code"],
                response_time_ms=res["response_time_ms"],
                error_message=res["error_message"],
                timestamp=datetime.utcnow()
            )
            db.add(check)
            
        db.commit()
        logger.info(f"Finished saving health checks for {len(active_urls)} URLs.")
    except Exception as e:
        logger.error(f"Error in periodic pinger execution: {str(e)}")
    finally:
        db.close()

async def run_periodic_pinger(interval_seconds: int = 60):
    """
    Main loop for background worker, pings every interval_seconds.
    """
    logger.info(f"Starting periodic ping scheduler. Interval: {interval_seconds}s")
    while True:
        await ping_all_active_urls()
        await asyncio.sleep(interval_seconds)
