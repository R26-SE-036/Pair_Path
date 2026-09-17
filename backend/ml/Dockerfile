# L15: containerized ml-service
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY models ./models

ENV ML_WINDOW_SECONDS=180 \
    ML_CONFIDENCE_THRESHOLD=0.6

# ML_SERVICE_TOKEN is deliberately NOT baked in. Pass it at run time with
# the same value the API has. Without it this service answers anything that
# can reach the port, and says so at startup.

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
