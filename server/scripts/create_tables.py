import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

import app.db.models  # noqa: F401
from sqlalchemy import text

from app.db.database import Base, engine


def main() -> None:
    if engine is None:
        raise RuntimeError("DATABASE_URL is not configured")

    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE fields ADD COLUMN IF NOT EXISTS chamber_products JSONB NOT NULL DEFAULT '{}'::jsonb"))
        conn.execute(text("ALTER TABLE spray_polygons ADD COLUMN IF NOT EXISTS selected_chambers JSONB NOT NULL DEFAULT '[]'::jsonb"))
        conn.execute(text("ALTER TABLE spray_polygons ADD COLUMN IF NOT EXISTS chamber_mode TEXT NOT NULL DEFAULT 'none'"))
        conn.execute(text("ALTER TABLE spray_polygons ADD COLUMN IF NOT EXISTS chamber_doses JSONB NOT NULL DEFAULT '{}'::jsonb"))
        conn.execute(text("ALTER TABLE spray_polygons DROP COLUMN IF EXISTS chamber"))
        conn.execute(text("ALTER TABLE spray_polygons ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'auto'"))
        conn.execute(text("ALTER TABLE spray_polygons ADD COLUMN IF NOT EXISTS origin_code TEXT"))
        conn.execute(text("ALTER TABLE field_imagery ADD COLUMN IF NOT EXISTS zone_origins JSONB"))
        conn.execute(text("ALTER TABLE target_detections ADD COLUMN IF NOT EXISTS disease_name TEXT"))
        # Backfill disease_name from the legacy `name` column, but only if that
        # column still exists (old schema). On a fresh DB `name` is absent, so a
        # bare UPDATE would fail with "column \"name\" does not exist"; guard it.
        conn.execute(text(
            "DO $$ BEGIN "
            "IF EXISTS (SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'target_detections' AND column_name = 'name') THEN "
            "UPDATE target_detections SET disease_name = name "
            "WHERE disease_name IS NULL AND name IS NOT NULL; "
            "END IF; END $$"
        ))
        conn.execute(text("ALTER TABLE target_detections ALTER COLUMN disease_name SET NOT NULL"))
        conn.execute(text("ALTER TABLE target_detections DROP COLUMN IF EXISTS name"))
        conn.execute(text("ALTER TABLE target_detections DROP COLUMN IF EXISTS category"))
        conn.execute(text("ALTER TABLE target_detections DROP COLUMN IF EXISTS group_name"))
        conn.execute(text("ALTER TABLE target_detections ADD COLUMN IF NOT EXISTS sample_lat DOUBLE PRECISION"))
        conn.execute(text("ALTER TABLE target_detections ADD COLUMN IF NOT EXISTS sample_lng DOUBLE PRECISION"))
        conn.execute(text("ALTER TABLE target_detections ADD COLUMN IF NOT EXISTS chamber TEXT"))
        # polygon_id is nullable: non-zone detections are logged here with a NULL polygon.
        conn.execute(text("ALTER TABLE target_detections ALTER COLUMN polygon_id DROP NOT NULL"))
        # live soil sensor snapshot captured with the detection.
        conn.execute(text("ALTER TABLE target_detections ADD COLUMN IF NOT EXISTS soil_snapshot JSONB"))
        conn.execute(text("ALTER TABLE disease_detections ADD COLUMN IF NOT EXISTS gps_source TEXT"))
        conn.execute(text("ALTER TABLE disease_detections ADD COLUMN IF NOT EXISTS ai_narrative TEXT"))
        conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS agent_case_id TEXT"))
        conn.execute(text("ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS meta JSONB"))
    print("Database tables are ready.")


if __name__ == "__main__":
    main()
