-- Create the gap-finding module's own database.
-- This runs once on first postgres container startup.
SELECT 'CREATE DATABASE gapfinding'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'gapfinding')\gexec
