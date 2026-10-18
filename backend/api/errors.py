import logging

from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_handler

log = logging.getLogger(__name__)


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "bad_request"):
        super().__init__(message)
        self.message, self.status, self.code = message, status, code


def exception_handler(exc, context):
    """Uniform error body: {"error": {"code", "message", "details"?}}. Never leaks tracebacks."""
    if isinstance(exc, ApiError):
        return Response({"error": {"code": exc.code, "message": exc.message}}, status=exc.status)
    response = drf_handler(exc, context)
    if response is not None:
        detail = response.data
        message = detail.get("detail", "Invalid request") if isinstance(detail, dict) else "Invalid request"
        body = {"code": getattr(exc, "default_code", "error"), "message": str(message)}
        if isinstance(detail, (dict, list)) and not (isinstance(detail, dict) and set(detail) == {"detail"}):
            body["details"] = detail
        response.data = {"error": body}
        return response
    log.exception("Unhandled API error")
    return Response({"error": {"code": "server_error", "message": "Internal server error"}}, status=500)
