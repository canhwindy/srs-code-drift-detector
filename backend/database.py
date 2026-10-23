import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

# Load .env from the parent directory (outline/) to read NODE_ENV,
# then load .env.{NODE_ENV} (e.g. .env.local, .env.production) for all config.
# This matches the loading logic in rag_state.py.
_root_env = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_root_env, encoding='latin-1')

_node_env = os.getenv("NODE_ENV", "local")
_env_file = _root_env.parent / f".env.{_node_env}"
if _env_file.exists():
    load_dotenv(_env_file, encoding='latin-1', override=True)

_SYNC_DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://user:pass@localhost:5432/outline"
)

# asyncpg does not recognise sslmode / channel_binding — strip them from the URL
import re
_SYNC_DATABASE_URL = re.sub(r"[&?](sslmode|channel_binding)=[^&]*", "", _SYNC_DATABASE_URL)

ASYNC_DATABASE_URL = (
    _SYNC_DATABASE_URL
    .replace("postgresql://", "postgresql+asyncpg://")
    .replace("postgres://", "postgresql+asyncpg://")
)


# ─────────────────────────────────────────────────────────────
# ENGINE: Kết nối thực tế tới PostgreSQL
# ─────────────────────────────────────────────────────────────
# echo=False: Không in SQL query ra console (bật True để debug)
# pool_pre_ping=True: Kiểm tra kết nối còn sống trước mỗi query
#   → Tránh lỗi "connection closed" sau thời gian idle dài
# ─────────────────────────────────────────────────────────────
_connect_args = {}
if "sslmode=" in ASYNC_DATABASE_URL or "neon.tech" in ASYNC_DATABASE_URL:
    import ssl as _ssl
    _ctx = _ssl.create_default_context()
    _ctx.check_hostname = False
    _ctx.verify_mode = _ssl.CERT_NONE
    _connect_args["ssl"] = _ctx

engine = create_async_engine(
    ASYNC_DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    connect_args=_connect_args,
)


# ─────────────────────────────────────────────────────────────
# SESSION FACTORY: Tạo database session cho mỗi request
# ─────────────────────────────────────────────────────────────
# expire_on_commit=False: Sau khi commit, objects vẫn accessible
#   mà không cần query lại DB. Quan trọng với async vì không có
#   lazy loading — mọi access ngoài session phải được load trước.
# ─────────────────────────────────────────────────────────────
AsyncSessionLocal = async_sessionmaker(
    engine,
    expire_on_commit=False,
)


# ─────────────────────────────────────────────────────────────
# BASE CLASS: Lớp cha của tất cả ORM models
# ─────────────────────────────────────────────────────────────
# Tất cả model (Conversation, Message...) kế thừa từ Base.
# SQLAlchemy dùng Base.metadata để biết phải tạo những bảng nào.
# ─────────────────────────────────────────────────────────────
class Base(DeclarativeBase):
    pass


# ─────────────────────────────────────────────────────────────
# DEPENDENCY: Inject AsyncSession vào endpoint qua Depends(get_db)
# ─────────────────────────────────────────────────────────────
# FastAPI gọi hàm này cho mỗi request cần DB.
# "async with" đảm bảo session luôn được đóng sau khi request xong,
# dù có exception hay không — tránh connection leak.
# ─────────────────────────────────────────────────────────────
async def get_db():
    """
    FastAPI dependency: cung cấp AsyncSession cho mỗi request.

    Dùng trong endpoint:
        async def my_endpoint(db: AsyncSession = Depends(get_db)):
            result = await db.execute(...)
    """
    async with AsyncSessionLocal() as session:
        yield session