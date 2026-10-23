#!/bin/bash
set -e

echo "=== Outline Database Deploy Script ==="
echo ""

# Check dump files exist
if [ ! -f "outline_dump.sql" ]; then
    echo "ERROR: outline_dump.sql not found in current directory"
    exit 1
fi
if [ ! -f "neo4j.dump" ]; then
    echo "ERROR: neo4j.dump not found in current directory"
    exit 1
fi

# Step 1: Start containers
echo "[1/4] Starting containers..."
docker compose up -d postgres redis
echo "Waiting for PostgreSQL to be ready..."
sleep 5
until docker exec outline-postgres pg_isready -U user -d outline > /dev/null 2>&1; do
    echo "  Waiting..."
    sleep 2
done
echo "PostgreSQL is ready."

# Step 2: Restore PostgreSQL
echo "[2/4] Restoring PostgreSQL database..."
docker exec -i outline-postgres psql -U user -d outline < outline_dump.sql
echo "PostgreSQL restore complete."

# Step 3: Start Neo4j (stopped mode), restore, then restart
echo "[3/4] Restoring Neo4j database..."
docker compose up -d neo4j
echo "Waiting for Neo4j to start..."
sleep 10

# Stop neo4j inside container, load dump, restart
docker exec outline-neo4j neo4j stop
sleep 5
docker cp neo4j.dump outline-neo4j:/data/neo4j.dump
docker exec outline-neo4j neo4j-admin database load neo4j --from-path=/data --overwrite-destination=true
docker restart outline-neo4j

echo "Waiting for Neo4j to be ready..."
sleep 10
until docker exec outline-neo4j cypher-shell -u neo4j -p neo4jpass "RETURN 1" > /dev/null 2>&1; do
    echo "  Waiting..."
    sleep 3
done
echo "Neo4j restore complete."

# Step 4: Verify
echo "[4/4] Verifying..."
PG_TABLES=$(docker exec outline-postgres psql -U user -d outline -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
NEO4J_NODES=$(docker exec outline-neo4j cypher-shell -u neo4j -p neo4jpass "MATCH (n) RETURN count(n) AS total" 2>/dev/null | tail -1)

echo ""
echo "=== Deploy Complete ==="
echo "PostgreSQL: ${PG_TABLES} tables"
echo "Neo4j: ${NEO4J_NODES} nodes"
echo ""
echo "Connection info:"
echo "  PostgreSQL: localhost:5432 (user/pass, db: outline)"
echo "  Neo4j HTTP: localhost:7474 (neo4j/neo4jpass)"
echo "  Neo4j Bolt: localhost:7687 (neo4j/neo4jpass)"
echo "  Redis:      localhost:6379"
