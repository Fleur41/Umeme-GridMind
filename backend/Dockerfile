# Build context: repository root (needs both backend/ and metta/).
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 GRIDMIND_METTA_DIR=/app/metta/rules
WORKDIR /app/backend

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY metta /app/metta
COPY backend /app/backend

RUN useradd --create-home gridmind && chown -R gridmind /app
USER gridmind

EXPOSE 8000
# Adaptation rounds take ~15-30 s, so the worker timeout is generous.
CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py seed_gridmind && gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 2 --timeout 180"]
