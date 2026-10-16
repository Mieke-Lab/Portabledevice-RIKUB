from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import ChatMessage, ChatSession

router = APIRouter(prefix="/api/chat/sessions", tags=["chat-history"])


class MessageCreate(BaseModel):
    sender: str  # 'user' | 'bot'
    text: str
    is_error: bool = False
    meta: dict[str, Any] | None = None


class SessionUpdate(BaseModel):
    agent_case_id: str | None = None  # null/"" = no active case (next message = new diagnosis)


def session_to_dict(session: ChatSession, include_messages: bool = False) -> dict:
    data = {
        "id": str(session.id),
        "title": session.title,
        "agent_case_id": session.agent_case_id,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
    }
    if include_messages:
        data["messages"] = [message_to_dict(m) for m in session.messages]
    return data


def message_to_dict(message: ChatMessage) -> dict:
    return {
        "id": str(message.id),
        "sender": message.sender,
        "text": message.text,
        "is_error": message.is_error,
        "meta": message.meta,
        "created_at": message.created_at,
    }


@router.get("")
def list_sessions(include_messages: bool = False, db: Session = Depends(get_db)) -> list[dict]:
    sessions = db.query(ChatSession).order_by(desc(ChatSession.updated_at)).all()
    return [session_to_dict(s, include_messages=include_messages) for s in sessions]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_session(db: Session = Depends(get_db)) -> dict:
    session = ChatSession(title="Percakapan baru")
    db.add(session)
    db.commit()
    db.refresh(session)
    return session_to_dict(session, include_messages=True)


@router.get("/{session_id}")
def get_session(session_id: UUID, db: Session = Depends(get_db)) -> dict:
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session_to_dict(session, include_messages=True)


@router.post("/{session_id}/messages", status_code=status.HTTP_201_CREATED)
def add_message(session_id: UUID, payload: MessageCreate, db: Session = Depends(get_db)) -> dict:
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    message = ChatMessage(
        session_id=session.id,
        sender=payload.sender,
        text=payload.text,
        is_error=payload.is_error,
        meta=payload.meta,
    )
    db.add(message)

    # First user message in the session becomes its title, mirroring the
    # sidebar preview - keeps the title correct even set from another device.
    if payload.sender == "user" and session.title == "Percakapan baru":
        session.title = payload.text.strip()[:36] or "Percakapan baru"

    # `onupdate` only fires when SQLAlchemy detects a changed column on this
    # row; a bot-only message otherwise leaves `session` untouched and
    # `updated_at` frozen at whenever the title last changed. Touch it
    # explicitly so "most recently active" sort order stays correct.
    session.updated_at = func.now()

    db.commit()
    db.refresh(message)
    return message_to_dict(message)


@router.patch("/{session_id}")
def update_session(session_id: UUID, payload: SessionUpdate, db: Session = Depends(get_db)) -> dict:
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    session.agent_case_id = (payload.agent_case_id or "").strip() or None
    db.commit()
    db.refresh(session)
    return session_to_dict(session)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: UUID, db: Session = Depends(get_db)) -> None:
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    db.delete(session)
    db.commit()
