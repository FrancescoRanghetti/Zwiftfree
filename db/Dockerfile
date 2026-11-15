# PostgreSQL + PostGIS + pgRouting, built natively for the host architecture (amd64 and arm64).
# The upstream pgrouting/pgrouting images are amd64-only and run emulated (slowly) on Apple Silicon.
FROM postgres:17-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      postgresql-17-postgis-3 postgresql-17-postgis-3-scripts postgresql-17-pgrouting \
 && rm -rf /var/lib/apt/lists/*
