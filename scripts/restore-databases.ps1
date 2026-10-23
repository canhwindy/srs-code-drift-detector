# Restore script for PostgreSQL and Neo4j databases in Docker
# Usage: .\restore-databases.ps1 -PostgresFile "postgres_backup_20260310_180130.dump" -Neo4jFile "neo4j_data_backup_20260310_180624.tar.gz"

param(
    [Parameter(Mandatory=$false)]
    [string]$PostgresFile,
    
    [Parameter(Mandatory=$false)]
    [string]$Neo4jFile,
    
    [Parameter(Mandatory=$false)]
    [string]$BackupDir = "backups"
)

Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "Database Restore Script" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan

# List available backups if no files specified
if (-not $PostgresFile -and -not $Neo4jFile) {
    Write-Host "`nAvailable backups:" -ForegroundColor Yellow
    Write-Host "`nPostgreSQL dumps:" -ForegroundColor Yellow
    Get-ChildItem $BackupDir -Filter "postgres_backup_*.dump" | 
        Select-Object Name, @{Name="Size(MB)";Expression={[math]::Round($_.Length/1MB, 2)}}, LastWriteTime |
        Format-Table -AutoSize
    
    Write-Host "Neo4j backups:" -ForegroundColor Yellow
    Get-ChildItem $BackupDir -Filter "neo4j_data_backup_*.tar.gz" | 
        Select-Object Name, @{Name="Size(MB)";Expression={[math]::Round($_.Length/1MB, 2)}}, LastWriteTime |
        Format-Table -AutoSize
    
    Write-Host "Usage: .\restore-databases.ps1 -PostgresFile '<filename>' -Neo4jFile '<filename>'" -ForegroundColor Cyan
    exit
}

# Restore PostgreSQL
if ($PostgresFile) {
    Write-Host "`n[1/2] Restoring PostgreSQL from $PostgresFile..." -ForegroundColor Yellow
    
    $pgPath = Join-Path $BackupDir $PostgresFile
    
    if (!(Test-Path $pgPath)) {
        Write-Host "✗ PostgreSQL backup file not found: $pgPath" -ForegroundColor Red
    }
    else {
        try {
            # Copy dump to container
            docker cp $pgPath outline-postgres:/tmp/restore.dump
            
            # Drop and recreate database (be careful!)
            Write-Host "  Dropping existing database..." -ForegroundColor Yellow
            docker exec outline-postgres psql -U user -d postgres -c "DROP DATABASE IF EXISTS outline;"
            docker exec outline-postgres psql -U user -d postgres -c "CREATE DATABASE outline;"
            
            # Restore database
            Write-Host "  Restoring database..." -ForegroundColor Yellow
            docker exec outline-postgres pg_restore -U user -d outline /tmp/restore.dump
            
            Write-Host "✓ PostgreSQL restore completed" -ForegroundColor Green
        }
        catch {
            Write-Host "✗ PostgreSQL restore failed: $_" -ForegroundColor Red
        }
    }
}

# Restore Neo4j
if ($Neo4jFile) {
    Write-Host "`n[2/2] Restoring Neo4j from $Neo4jFile..." -ForegroundColor Yellow
    
    $neoPath = Join-Path $BackupDir $Neo4jFile
    
    if (!(Test-Path $neoPath)) {
        Write-Host "✗ Neo4j backup file not found: $neoPath" -ForegroundColor Red
    }
    else {
        try {
            # Stop Neo4j container
            Write-Host "  Stopping Neo4j container..." -ForegroundColor Yellow
            docker-compose stop neo4j
            
            Start-Sleep -Seconds 5
            
            # Restore Neo4j data volume
            Write-Host "  Restoring Neo4j data..." -ForegroundColor Yellow
            docker run --rm -v outline-neo4j-data:/data -v "${PWD}/${BackupDir}:/backup" busybox sh -c "rm -rf /data/* && tar xzf /backup/$Neo4jFile -C /data"
            
            # Start Neo4j container
            Write-Host "  Starting Neo4j container..." -ForegroundColor Yellow
            docker-compose start neo4j
            
            Start-Sleep -Seconds 10
            
            Write-Host "✓ Neo4j restore completed" -ForegroundColor Green
        }
        catch {
            Write-Host "✗ Neo4j restore failed: $_" -ForegroundColor Red
            Write-Host "  Attempting to restart Neo4j..." -ForegroundColor Yellow
            docker-compose start neo4j
        }
    }
}

Write-Host "`n===============================================" -ForegroundColor Cyan
Write-Host "Restore process completed!" -ForegroundColor Green
Write-Host "===============================================`n" -ForegroundColor Cyan
