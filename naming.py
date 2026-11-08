"""Download file names: readable (keeps case and spaces) but safe on Windows/macOS/Linux and in HTTP headers."""
import re
import unicodedata


def safe_filename(value, fallback="file", max_len=120):
    """'H2 Health: North/South' -> 'H2 Health North South'. Strips characters invalid in file names."""
    text = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode("ascii")
    text = re.sub(r'[\\/:*?"<>|;\x00-\x1f]+', " ", text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    return text[:max_len].rstrip(" .") or fallback
