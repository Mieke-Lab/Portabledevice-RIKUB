from fastapi import APIRouter

from app.db.database import check_database_connection

router = APIRouter()


@router.get("/health")
async def database_health():
    return check_database_connection()
