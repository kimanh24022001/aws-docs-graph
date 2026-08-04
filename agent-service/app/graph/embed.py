"""Embedding endpoint using sentence-transformers (all-MiniLM-L6-v2, 384 dims)."""

from functools import lru_cache

from fastapi import APIRouter
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

router = APIRouter()


@lru_cache(maxsize=1)
def _model() -> SentenceTransformer:
    return SentenceTransformer("all-MiniLM-L6-v2")


class EmbedRequest(BaseModel):
    text: str


class EmbedResponse(BaseModel):
    embedding: list[float]
    dims: int


@router.post("/internal/embed", response_model=EmbedResponse)
async def embed(body: EmbedRequest) -> EmbedResponse:
    vec = _model().encode(body.text, normalize_embeddings=True).tolist()
    return EmbedResponse(embedding=vec, dims=len(vec))
