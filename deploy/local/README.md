# 로컬 infrastructure

Compose는 PostgreSQL과 MinIO만 실행한다. Application은 host에서 직접 실행한다.

```bash
docker compose -f deploy/local/compose.yaml up -d postgres minio minio-init
pnpm db:migrate
pnpm dev
curl -fsS http://localhost:3100/api/health
```

Application은 host의 `http://localhost:3100`, PostgreSQL은 `localhost:5433`, MinIO API와 console은 각각 `localhost:9010`, `localhost:9011`에서 열린다. 기본 credential은 로컬 전용이다.

데이터를 유지한 채 중지하려면 다음을 실행하라.

```bash
docker compose -f deploy/local/compose.yaml down
```

`down -v`는 PostgreSQL과 MinIO 데이터를 삭제하므로 대상과 백업을 확인하기 전에는 실행하지 마라.
