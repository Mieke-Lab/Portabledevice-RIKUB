import uuid

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.db.database import Base


class Field(Base):
    __tablename__ = "fields"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False)
    # Product loaded into each physical spray chamber for this field/mission, e.g.
    # {"fungisida": "kontaf-50-sc", "insektisida": "starner-20-wp"}. Drives the
    # default per-chamber dose (see server/app/routes/fields.py → PRODUCT_DOSES and
    # web/src/lib/gcs/product-doses.js). A missing chamber means "no product set".
    chamber_products = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime, server_default=func.now())

    imagery = relationship(
        "FieldImagery",
        back_populates="field",
        cascade="all, delete-orphan",
    )


class FieldImagery(Base):
    __tablename__ = "field_imagery"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    field_id = Column(
        UUID(as_uuid=True),
        ForeignKey("fields.id", ondelete="CASCADE"),
        nullable=False,
    )

    capture_at = Column(DateTime)

    rgb_tif_path = Column(Text, nullable=False)
    ndvi_tif_path = Column(Text, nullable=False)
    rgb_png_path = Column(Text)
    ndvi_png_path = Column(Text)

    top_left = Column(JSONB)
    top_right = Column(JSONB)
    bottom_left = Column(JSONB)
    bottom_right = Column(JSONB)
    ndvi_stats = Column(JSONB)
    # Unclipped shapes of the automatic (NDVI) zones from the last Approve Zones:
    # [{"code": "Z05", "sequence_no": 5, "geometry": {...}, "settings": {...}}, ...].
    # Spray zone rows are derived from these minus the manual zones (app/zones.py), so an
    # automatic zone that a manual zone fully covers can still come back later.
    zone_origins = Column(JSONB)

    created_at = Column(DateTime, server_default=func.now())

    field = relationship("Field", back_populates="imagery")


class SprayPolygon(Base):
    __tablename__ = "spray_polygons"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    field_id = Column(
        UUID(as_uuid=True),
        ForeignKey("fields.id", ondelete="CASCADE"),
        nullable=False,
    )
    field_imagery_id = Column(
        UUID(as_uuid=True),
        ForeignKey("field_imagery.id", ondelete="CASCADE"),
        nullable=False,
    )

    zone_code = Column(Text, nullable=False)
    sequence_no = Column(Integer, nullable=False)
    geometry = Column(JSONB, nullable=False)
    area_m2 = Column(Float, nullable=False)
    mean_ndvi = Column(Float)
    settings = Column(JSONB, nullable=False)
    selected_chambers = Column(JSONB, nullable=False, default=list)
    chamber_mode = Column(Text, nullable=False, default="none")
    # Per-chamber application rate (dose) in L/ha, e.g. {"fungisida": 40, "insektisida": 60}.
    # Set by the user in manual mode; empty means "use the default rate" downstream.
    chamber_doses = Column(JSONB, nullable=False, default=dict)
    # 'auto' = NDVI zone (Approve Zones), 'manual' = drawn by the user on the map.
    # Manual zones win: auto zones are clipped wherever a manual zone covers them.
    source = Column(Text, nullable=False, default="auto")
    # Auto zones only: the NDVI zone this row came from ("Z05"), a key into
    # FieldImagery.zone_origins. One origin can yield several rows ("Z05a", "Z05b")
    # when a manual zone splits it.
    origin_code = Column(Text)
    created_at = Column(DateTime, server_default=func.now())

    detections = relationship(
        "TargetDetection",
        back_populates="polygon",
        cascade="all, delete-orphan",
    )


class TargetDetection(Base):
    __tablename__ = "target_detections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Nullable: a spray-zone detection sets this; a plain (non-zone) detection is still logged
    # here with polygon_id NULL (it just isn't attached to any GIS zone).
    polygon_id = Column(
        UUID(as_uuid=True),
        ForeignKey("spray_polygons.id", ondelete="CASCADE"),
        nullable=True,
    )

    disease_name = Column(Text, nullable=False)
    confidence = Column(Float)
    sample_lat = Column(Float)
    sample_lng = Column(Float)
    chamber = Column(Text)
    image_path = Column(Text)
    soil_snapshot = Column(JSONB)   # {temp,moisture,ec,ph,n,p,k} live sensor reading at capture, or None
    created_at = Column(DateTime, server_default=func.now())

    polygon = relationship("SprayPolygon", back_populates="detections")


class DiseaseDetection(Base):
    """A standalone leaf-scan diagnosis from the /detection kiosk (camera or upload).

    Distinct from TargetDetection, which is coupled to the drone-spray/GIS workflow
    (requires a polygon, single-label). This is a multi-label diagnosis log: it keeps
    the image, timestamp, geotag, every disease above threshold, and the live soil
    snapshot used for the fusion — written on EVERY detection, both capture modes.
    """
    __tablename__ = "disease_detections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_at = Column(DateTime, server_default=func.now())

    source = Column(Text)          # 'camera' | 'upload'
    image_path = Column(Text)      # stored filename under storage/detections, served at /detections/<name>
    original_name = Column(Text)   # the uploaded file's own name (None/"blob" for a live capture)

    sample_lat = Column(Float)     # final geotag (device browser GPS or ESP32 sensor GPS)
    sample_lng = Column(Float)
    gps_source = Column(Text)      # 'device' | 'sensor' | None — provenance of the coordinate

    top_disease = Column(Text)     # highest-probability class
    top_confidence = Column(Float)
    present = Column(JSONB)         # MULTI-LABEL: every class with p_final >= tau
    n_detections = Column(Integer)  # regions the YOLO-seg detector localized

    used_soil = Column(Boolean, nullable=False, default=False)
    soil_snapshot = Column(JSONB)   # {temp,moisture,ec,ph,n,p,k} at capture time, or None if sensor was down
    ai_narrative = Column(Text)     # optional Gemma "Perdalam via AI" follow-up (added on demand)


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(Text, nullable=False, default="Percakapan baru")
    # The Jetson agent case this conversation is currently about (vault note id, e.g.
    # "20260923-194301-ec78dd"): follow-up questions are sent against it. None = the
    # next message starts a new diagnosis.
    agent_case_id = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    messages = relationship(
        "ChatMessage",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="ChatMessage.created_at",
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("chat_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )

    sender = Column(Text, nullable=False)  # 'user' | 'bot'
    text = Column(Text, nullable=False)
    is_error = Column(Boolean, nullable=False, default=False)
    # Structured payload for rich rendering, e.g. {"kind": "diagnosis", "hama": ...} or
    # {"kind": "followup", "pengetahuan": [...]}. `text` stays the plain-text fallback.
    meta = Column(JSONB)
    created_at = Column(DateTime, server_default=func.now())

    session = relationship("ChatSession", back_populates="messages")
