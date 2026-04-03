"""Hybrid guess matcher with Arabic normalization, aliases, fuzzy matching, and embeddings."""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Iterable

from rapidfuzz import fuzz
from sentence_transformers import SentenceTransformer, util


def normalize_arabic_text(text: str) -> str:
    """
    Normalize Arabic text for more robust matching.

    This removes diacritics, tatweel, extra spaces, and normalizes
    common Arabic letter variants.

    Args:
        text: Raw input text.

    Returns:
        Normalized text.
    """
    text = text.strip().lower()

    # Remove Arabic diacritics
    text = re.sub(r"[\u064B-\u065F\u0670]", "", text)

    # Remove tatweel
    text = text.replace("ـ", "")

    # Normalize Arabic letter variants
    text = (
        text.replace("أ", "ا")
        .replace("إ", "ا")
        .replace("آ", "ا")
        .replace("ى", "ي")
        .replace("ؤ", "و")
        .replace("ئ", "ي")
        .replace("ة", "ه")
    )

    # Remove punctuation-like separators that often vary in user input
    text = re.sub(r"[^\w\s]", " ", text)

    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()

    return text


@lru_cache(maxsize=1)
def get_embedding_model() -> SentenceTransformer:
    """
    Load and cache the multilingual sentence embedding model.

    Returns:
        Loaded SentenceTransformer model.
    """
    return SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")

def preload_embedding_model() -> None:
    """
    Force-load the embedding model at startup.

    This avoids the first-request delay when the matcher is used
    for the first time.
    """
    get_embedding_model()

def _best_fuzzy_score(guess: str, candidates: Iterable[str]) -> int:
    """
    Compute the best fuzzy ratio between the guess and candidate strings.

    Args:
        guess: Normalized guess string.
        candidates: Candidate strings.

    Returns:
        Best fuzzy score.
    """
    best_score = 0
    for candidate in candidates:
        score = fuzz.ratio(guess, candidate)
        if score > best_score:
            best_score = score
    return best_score


def _best_embedding_similarity(guess: str, candidates: list[str]) -> float:
    """
    Compute the highest cosine similarity between the guess and candidate strings.

    Args:
        guess: Normalized guess string.
        candidates: Candidate strings.

    Returns:
        Best cosine similarity score.
    """
    model = get_embedding_model()

    guess_embedding = model.encode(guess, convert_to_tensor=True)
    candidate_embeddings = model.encode(candidates, convert_to_tensor=True)

    similarities = util.cos_sim(guess_embedding, candidate_embeddings)[0]
    return float(similarities.max().item())


def is_correct_guess(
    guess: str,
    target_label: str,
    aliases: list[str] | None = None,
    fuzzy_threshold: int = 88,
    embedding_threshold: float = 0.82,
) -> bool:
    """
    Decide whether a player's guess should count as correct.

    Matching order:
    1. exact normalized match
    2. exact normalized alias match
    3. fuzzy match
    4. embedding similarity

    Args:
        guess: Raw player guess.
        target_label: Canonical identity label.
        aliases: Optional accepted aliases.
        fuzzy_threshold: Threshold for fuzzy ratio acceptance.
        embedding_threshold: Threshold for embedding cosine similarity acceptance.

    Returns:
        True if the guess is accepted, otherwise False.
    """
    aliases = aliases or []

    normalized_guess = normalize_arabic_text(guess)
    normalized_label = normalize_arabic_text(target_label)
    normalized_aliases = [normalize_arabic_text(alias) for alias in aliases]

    candidates = [normalized_label, *normalized_aliases]

    # Exact normalized match
    if normalized_guess in candidates:
        return True

    # Fuzzy match
    if _best_fuzzy_score(normalized_guess, candidates) >= fuzzy_threshold:
        return True

    # Embedding similarity fallback
    if _best_embedding_similarity(normalized_guess, candidates) >= embedding_threshold:
        return True

    return False