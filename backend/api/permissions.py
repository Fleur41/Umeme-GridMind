from django.conf import settings
from rest_framework.permissions import SAFE_METHODS, BasePermission


class DemoWriteToken(BasePermission):
    """Reads are open. Writes require `X-GridMind-Token` only when GRIDMIND_WRITE_TOKEN is configured."""

    message = "Write operations require a valid X-GridMind-Token header."

    def has_permission(self, request, view):
        token = settings.GRIDMIND_WRITE_TOKEN
        if request.method in SAFE_METHODS or not token:
            return True
        return request.headers.get("X-GridMind-Token") == token
