# Deploy Outline (full Docker)

## 1. Config

```bash
cp .env.sample .env.production
nano .env.production   # điền các giá trị [REQUIRED] + [AUTO] — xem comment đầu file
```

Copy file GCS service account JSON vào project root:

```bash
cp /path/to/your-gcs-key.json ./gcs-credentials.json
chmod 644 ./gcs-credentials.json
```

(Tuỳ chọn) Copy CLIProxyAPI config:

```bash
cp CLIProxyAPI/config.example.yaml CLIProxyAPI/config.yaml
# sửa secret-key + api-keys trong config.yaml cho khớp với CLIPROXY_* trong .env.production
```

## 2. Build + chạy

```bash
docker compose up -d --build
```

Lần đầu mất ~10–15 phút (Node build + .NET publish + Python deps). Các service sẽ khởi động theo health check. Check trạng thái:

```bash
docker compose ps
docker compose logs -f outline
```

Outline container tự chạy `sequelize db:migrate` trước khi start server — không cần migrate thủ công.

## 3. Reverse proxy (nginx + SSL)

```bash
sudo cp deploy/nginx.sample.conf /etc/nginx/sites-available/outline
sudo sed -i "s/YOUR_DOMAIN/your-domain.example.com/g" /etc/nginx/sites-available/outline
sudo ln -s /etc/nginx/sites-available/outline /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# SSL via Let's Encrypt
sudo certbot --nginx -d your-domain.example.com
```

## Commands

| Task | Command |
|------|---------|
| Start tất cả | `docker compose up -d` |
| Rebuild sau code change | `docker compose up -d --build` |
| Logs outline | `docker compose logs -f outline` |
| Logs filesplit | `docker compose logs -f filesplit` |
| Restart outline | `docker compose restart outline filesplit` |
| Stop tất cả | `docker compose down` |
| Xoá volume (MẤT DATA) | `docker compose down -v` |
| DB migrate manual | `docker compose exec outline ./node_modules/.bin/sequelize db:migrate` |
| Shell vào outline | `docker compose exec outline sh` |

## Ports (bind 127.0.0.1 — chỉ access qua nginx)

| Service | Port | Mô tả |
|---------|------|-------|
| outline | 3000 | Node.js web + worker + collab |
| filesplit | 5000 | .NET DOCX/PPTX splitter |
| backend | 8000 | Python FastAPI (RAG) |
| gapfinding | 8011 | Python webhook + Celery worker |
| postgres | 5432 | PostgreSQL 17 + pgvector |
| redis | 6379 | Cache + Bull queues |
| neo4j | 7474/7687 | Graph DB |
| queue | 5672/15672 | RabbitMQ |
| cliproxyapi | 8317 | Claude routing proxy |

## Backup / Restore

- `deploy/restore.sh` — restore từ `outline_dump.sql` + `neo4j.dump`

## Troubleshooting

- **outline container restart liên tục**: thường do DB chưa ready hoặc env thiếu. Check `docker compose logs outline`.
- **Frontend báo CORS khi gọi `/filesplit-api`**: thêm domain vào `FILE_SPLIT_API_ALLOWED_ORIGINS` trong `.env.production`, rebuild.
- **Port 3000/5000 đang bị chiếm**: nếu còn PM2 → `pm2 stop all && pm2 delete all`.
